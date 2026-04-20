/**
 * Avatar animation provider interface.
 *
 * The default provider uses a WebAudio AnalyserNode on an <audio> element to
 * derive amplitude and map it to one of two mouth shapes (closed / open).
 * This lets us do "good-enough" pencil-sketch lip sync entirely in the
 * browser without a separate video pipeline.
 *
 * Later we can add a second provider that pre-renders true lip-synced video
 * server-side (e.g. via Replicate) and returns a URL instead. The
 * <Avatar /> component switches on provider kind.
 */

export type MouthShape = "closed" | "open";

export type ClientAvatarProvider = {
  kind: "client";
  /** Attach an analyser to an <audio> element so we can read its amplitude. */
  attach: (audio: HTMLAudioElement) => void;
  /** Detach analyser and release AudioContext when unmounting. */
  detach: () => void;
  /** Call on each animation frame to get the current mouth shape. */
  sample: () => { shape: MouthShape; level: number };
};

export type VideoAvatarProvider = {
  kind: "video";
  /** URL of a pre-rendered MP4 with lip-synced narration baked in. */
  videoUrl: string;
};

export type AvatarProvider = ClientAvatarProvider | VideoAvatarProvider;

/**
 * Create a client-side amplitude-driven avatar provider.
 *
 * Threshold picked to open mouth on sustained vowels but stay closed on
 * silence and room noise; tuned empirically against ElevenLabs TTS output.
 */
export function createClientAvatarProvider(options?: {
  openThreshold?: number;
}): ClientAvatarProvider {
  const openThreshold = options?.openThreshold ?? 0.08;

  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  // Typed as Uint8Array<ArrayBuffer> so AnalyserNode.getByteTimeDomainData accepts it
  // under "strict" lib.dom typings (TS 5.7+ narrowed the backing buffer type).
  let buf: Uint8Array<ArrayBuffer> | null = null;
  let currentShape: MouthShape = "closed";
  // Smooth the shape so we don't flicker on every frame.
  let holdFrames = 0;

  return {
    kind: "client",
    attach(audio) {
      if (ctx) return; // already attached
      const AC = (window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
      if (!AC) return;
      ctx = new AC();
      // Resume on user gesture if needed; caller should have started playback.
      if (ctx.state === "suspended") {
        void ctx.resume();
      }
      source = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      buf = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      source.connect(analyser);
      analyser.connect(ctx.destination);
    },
    detach() {
      try { source?.disconnect(); } catch { /* ignore */ }
      try { analyser?.disconnect(); } catch { /* ignore */ }
      try { ctx?.close(); } catch { /* ignore */ }
      source = null;
      analyser = null;
      ctx = null;
      buf = null;
      currentShape = "closed";
      holdFrames = 0;
    },
    sample() {
      if (!analyser || !buf) return { shape: "closed", level: 0 };
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 3);
      const wantOpen = level > openThreshold;
      if (wantOpen) {
        currentShape = "open";
        holdFrames = 3;
      } else if (holdFrames > 0) {
        holdFrames -= 1;
      } else {
        currentShape = "closed";
      }
      return { shape: currentShape, level };
    },
  };
}
