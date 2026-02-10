/**
 * WAV recording via Web Audio API: 16 kHz, 16-bit, mono.
 * Used for enrollment and identify so the server does not need ffmpeg to convert WebM.
 */

const WAV_SAMPLE_RATE = 16000;
const WAV_HEADER_LENGTH = 44;

/** Write 16-bit little-endian at offset. */
function writeU16Le(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
}

/** Write 32-bit little-endian at offset. */
function writeU32Le(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = value & 0xff;
  arr[offset + 1] = (value >> 8) & 0xff;
  arr[offset + 2] = (value >> 16) & 0xff;
  arr[offset + 3] = (value >> 24) & 0xff;
}

/** Build 44-byte WAV header for 16-bit mono at 16 kHz. Returns a Uint8Array so the header is always a copy. */
function buildWavHeader(numSamples: number): Uint8Array {
  const dataLen = numSamples * 2; // 16-bit = 2 bytes per sample
  const arr = new Uint8Array(WAV_HEADER_LENGTH);
  let o = 0;
  // RIFF header
  arr[o++] = 0x52; arr[o++] = 0x49; arr[o++] = 0x46; arr[o++] = 0x46; // "RIFF"
  writeU32Le(arr, o, 36 + dataLen); o += 4; // chunk size (file size - 8)
  arr[o++] = 0x57; arr[o++] = 0x41; arr[o++] = 0x56; arr[o++] = 0x45; // "WAVE"
  // fmt chunk
  arr[o++] = 0x66; arr[o++] = 0x6d; arr[o++] = 0x74; arr[o++] = 0x20; // "fmt "
  writeU32Le(arr, o, 16); o += 4;
  writeU16Le(arr, o, 1); o += 2;  // PCM
  writeU16Le(arr, o, 1); o += 2;  // mono
  writeU32Le(arr, o, WAV_SAMPLE_RATE); o += 4;
  writeU32Le(arr, o, WAV_SAMPLE_RATE * 2); o += 4; // byte rate
  writeU16Le(arr, o, 2); o += 2;  // block align
  writeU16Le(arr, o, 16); o += 2; // bits per sample
  // data chunk
  arr[o++] = 0x64; arr[o++] = 0x61; arr[o++] = 0x74; arr[o++] = 0x61; // "data"
  writeU32Le(arr, o, dataLen);
  return arr;
}

/** Convert float [-1,1] to Int16 and optionally resample to 16 kHz. */
function floatTo16kHzPcm(input: Float32Array, inputSampleRate: number): Int16Array {
  if (input.length === 0) return new Int16Array(0);
  const ratio = inputSampleRate / WAV_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const next = Math.min(idx + 1, input.length - 1);
    const sample = input[idx] * (1 - frac) + input[next] * frac;
    const s16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    out[i] = s16;
  }
  return out;
}

export type WavRecorderRolling = {
  stop: () => void;
  getWavBlob: () => Blob | null;
};

/** Keep last `durationSeconds` of audio at 16 kHz in a ring buffer; call getWavBlob() to get current buffer as WAV. */
export function createWavRecorderRolling(
  stream: MediaStream,
  durationSeconds: number = 60
): WavRecorderRolling {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const bufferLength = WAV_SAMPLE_RATE * durationSeconds; // samples
  const ring = new Int16Array(bufferLength);
  let writeIndex = 0;
  let totalWritten = 0;

  const processor = ctx.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const pcm = floatTo16kHzPcm(input, ctx.sampleRate);
    for (let i = 0; i < pcm.length; i++) {
      ring[writeIndex % bufferLength] = pcm[i];
      writeIndex++;
    }
    totalWritten += pcm.length;
  };

  // Connect to a silent destination so we don't play mic back to the user
  const dest = ctx.createMediaStreamDestination();
  source.connect(processor);
  processor.connect(dest);

  return {
    stop() {
      processor.disconnect();
      source.disconnect();
      try {
        ctx.close();
      } catch {
        // ignore
      }
    },
    getWavBlob() {
      const count = Math.min(totalWritten, bufferLength);
      if (count === 0) return null;
      const start = totalWritten <= bufferLength ? 0 : writeIndex % bufferLength;
      const header = buildWavHeader(count);
      const data = new Uint8Array(header.length + count * 2);
      data.set(header, 0);
      for (let i = 0; i < count; i++) {
        const v = ring[(start + i) % bufferLength];
        const off = header.length + i * 2;
        data[off] = v & 0xff;
        data[off + 1] = (v >> 8) & 0xff;
      }
      return new Blob([data], { type: "audio/wav" });
    },
  };
}

/** Record for a fixed duration, then return a WAV Blob. */
export function recordWavForDuration(stream: MediaStream, durationMs: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const chunks: Int16Array[] = [];
    let inputSampleRate = ctx.sampleRate;

    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(floatTo16kHzPcm(input, inputSampleRate));
    };

    const dest = ctx.createMediaStreamDestination();
    source.connect(processor);
    processor.connect(dest);

    const stop = () => {
      processor.disconnect();
      source.disconnect();
      try {
        ctx.close();
      } catch {
        // ignore
      }
      stream.getTracks().forEach((t) => t.stop());

      const totalSamples = chunks.reduce((n, c) => n + c.length, 0);
      if (totalSamples === 0) {
        reject(new Error("No audio captured"));
        return;
      }
      const header = buildWavHeader(totalSamples);
      const data = new Uint8Array(header.length + totalSamples * 2);
      data.set(header, 0);
      let offset = header.length;
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
          const v = chunk[i];
          data[offset++] = v & 0xff;
          data[offset++] = (v >> 8) & 0xff;
        }
      }
      resolve(new Blob([data], { type: "audio/wav" }));
    };

    setTimeout(stop, durationMs);
  });
}
