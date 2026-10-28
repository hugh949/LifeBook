"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiGet, apiPostBlob, apiPostFormData, API_BASE } from "@/lib/api";
import { createWavRecorderRolling, type WavRecorderRolling } from "@/lib/wavRecorder";

type VoiceStatus = {
  status: "none" | "recording" | "processing" | "ready" | "failed";
  voice_id: string | null;
  consent_at: string | null;
  error: string | null;
  min_bytes?: number;
};

const TARGET_SECONDS = 75; // encourage a little over the minimum 60s
const MIN_SECONDS = 60;

/** 20ms of 8 kHz silence. Played in the tap so this element stays unlocked on iOS. */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YUABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
    null
  );
}

function mountSampleAudio(audio: HTMLAudioElement) {
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  if (!audio.isConnected) {
    audio.style.display = "none";
    document.body.appendChild(audio);
  }
}

/** Play an MP3 blob through an AudioContext that was resumed during the tap. */
async function startMp3InContext(
  ctx: AudioContext,
  blob: Blob,
  stopRef: { current: (() => void) | null }
): Promise<void> {
  if (ctx.state === "suspended") await ctx.resume();
  const bytes = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(bytes.slice(0));
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  stopRef.current = () => {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
  };
  source.start(0);
}

export default function VoicePage() {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<WavRecorderRolling | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleCtxRef = useRef<AudioContext | null>(null);
  const sampleUrlRef = useRef<string | null>(null);
  const sampleStopRef = useRef<(() => void) | null>(null);
  const sampleGenRef = useRef(0);

  const refreshStatus = useCallback(() => {
    apiGet<VoiceStatus>("/me/voice")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* ignore */ }
      ctxRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    stopMeter();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recRef.current?.stop();
    recRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    setLevel(0);
  }, [stopMeter]);

  useEffect(() => () => teardown(), [teardown]);

  useEffect(() => () => {
    sampleGenRef.current += 1;
    sampleAudioRef.current?.pause();
    sampleAudioRef.current?.remove();
    sampleStopRef.current?.();
    if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    const ctx = sampleCtxRef.current;
    if (ctx) void ctx.close().catch(() => undefined);
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recRef.current = createWavRecorderRolling(stream, 120);

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser);
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 3));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
      }, 250);

      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Microphone permission was denied.");
      teardown();
    }
  };

  const submit = async () => {
    setProcessing(true);
    setError(null);
    try {
      const blob = recRef.current?.getWavBlob();
      teardown();
      if (!blob) throw new Error("No audio captured. Please try again.");
      const form = new FormData();
      form.append("audio", blob, "voice-clone.wav");
      const next = await apiPostFormData<VoiceStatus>("/me/voice/clone", form);
      setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create your voice clone.");
      refreshStatus();
    } finally {
      setProcessing(false);
    }
  };

  const cancel = () => {
    teardown();
    setElapsed(0);
  };

  const remove = async () => {
    if (!confirm("Delete your cloned voice? Narrations will fall back to the default voice.")) return;
    try {
      const res = await fetch(`${API_BASE}/me/voice`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      const next = (await res.json()) as VoiceStatus;
      setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete voice clone.");
    } finally {
      refreshStatus();
    }
  };

  const playSample = () => {
    if (sampleBusy) return;
    setError(null);
    setSampleBusy(true);
    const gen = ++sampleGenRef.current;

    // Sample is POST /me/voice/sample. <audio src> always GETs that URL (production
    // returned 405), so fetch the MP3 with the session cookie and play a blob URL.
    const audio = sampleAudioRef.current ?? new Audio();
    sampleAudioRef.current = audio;
    mountSampleAudio(audio);

    const Ctor = audioContextCtor();
    let ctx = sampleCtxRef.current;
    if (Ctor && (!ctx || ctx.state === "closed")) {
      ctx = new Ctor();
      sampleCtxRef.current = ctx;
    }
    // Resume inside the tap. iOS keeps this context running after the TTS await.
    const resumePromise = ctx?.resume() ?? Promise.resolve();

    sampleStopRef.current?.();
    sampleStopRef.current = null;
    audio.pause();
    audio.muted = true;
    audio.src = SILENT_WAV;
    const unlock = audio.play();

    void (async () => {
      try {
        await Promise.all([
          unlock.catch(() => undefined),
          resumePromise.catch(() => undefined),
        ]);
        if (gen !== sampleGenRef.current) return;

        const blob = await apiPostBlob("/me/voice/sample", {
          headers: { Accept: "audio/mpeg" },
        });
        if (gen !== sampleGenRef.current) return;

        const typed = blob.type.toLowerCase().includes("audio")
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: "audio/mpeg" });

        if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
        const url = URL.createObjectURL(typed);
        sampleUrlRef.current = url;

        audio.muted = false;
        audio.pause();
        audio.src = url;
        audio.load();
        try {
          await audio.play();
        } catch (playErr) {
          const name = playErr instanceof DOMException ? playErr.name : "";
          const canFallback = name === "NotAllowedError" || name === "NotSupportedError" || name === "AbortError";
          if (!canFallback) throw playErr;
          audio.pause();
          if (!ctx) throw new Error("Could not play sample. Try again.");
          await startMp3InContext(ctx, typed, sampleStopRef);
        }
      } catch (e) {
        if (gen !== sampleGenRef.current) return;
        audio.pause();
        setError(
          e instanceof DOMException
            ? "Could not play sample. Try again."
            : e instanceof Error && e.message
              ? e.message
              : "Could not play sample. Try again."
        );
      } finally {
        if (gen === sampleGenRef.current) setSampleBusy(false);
      }
    })();
  };

  const pct = Math.min(100, Math.round((elapsed / TARGET_SECONDS) * 100));
  const canSubmit = elapsed >= MIN_SECONDS && !processing;

  return (
    <>
      <p style={{ marginBottom: 10 }}><Link href="/me">← Me</Link></p>
      <h1 className="page-title">Your voice</h1>
      <p className="page-lead">
        Record about a minute of clear speech. We&rsquo;ll use it so you can listen to your own
        stories in your voice.
      </p>

      {error ? <div className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}

      {processing ? (
        <div className="card center stack-12">
          <div><span className="spinner" /> </div>
          <p style={{ margin: 0 }}>Creating your voice clone…</p>
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>This can take up to a minute.</p>
        </div>
      ) : recording ? (
        <div className="card stack-12">
          <div className="center">
            <div style={{ fontSize: 40, fontWeight: 700, fontFamily: "var(--font-display)" }}>
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")}
            </div>
            <div className="text-muted" style={{ fontSize: 14 }}>Keep speaking. Aim for {TARGET_SECONDS}s.</div>
          </div>
          <div aria-hidden="true" style={{ height: 12, background: "var(--accent-soft)", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--primary)",
                transition: "width 0.2s linear",
              }}
            />
          </div>
          <div aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: 2, justifyContent: "center", height: 40 }}>
            {Array.from({ length: 20 }).map((_, i) => {
              const t = i / 19;
              const active = level > t * 0.9;
              const h = 6 + Math.round(level * 34 * (0.5 + 0.5 * Math.sin(i / 2)));
              return (
                <div key={i} style={{
                  width: 4,
                  height: active ? h : 6,
                  background: active ? "var(--success)" : "var(--border)",
                  borderRadius: 2,
                  transition: "height 80ms linear, background 80ms linear",
                }} />
              );
            })}
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
              {elapsed < MIN_SECONDS ? `Keep going (${MIN_SECONDS - elapsed}s left)` : "I'm done — create clone"}
            </button>
            <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : status?.status === "ready" ? (
        <div className="card stack-12">
          <div className="msg msg-success">Your voice clone is ready.</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
            Your stories can be narrated in your voice when you listen privately or share.
          </p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={playSample} disabled={sampleBusy}>
              {sampleBusy ? "Preparing sample…" : "Play sample"}
            </button>
            <button className="btn btn-ghost" onClick={startRecording}>Re-record</button>
            <button className="btn btn-danger" onClick={remove}>Delete clone</button>
          </div>
        </div>
      ) : status?.status === "failed" ? (
        <div className="card stack-12">
          <div className="msg msg-error">
            {status.error || "Something went wrong creating your voice clone."}
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={startRecording}>Try again</button>
          </div>
        </div>
      ) : (
        <div className="card stack-12">
          <p style={{ margin: 0 }}>
            Find a quiet spot. Tap <strong>Start recording</strong>, then speak naturally for at
            least a minute &mdash; read a favorite paragraph or describe your day.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--ink-muted)", fontSize: 14 }}>
            <li>Use your normal phone mic at arm&rsquo;s length.</li>
            <li>No background music or TV.</li>
            <li>60+ seconds of clear speech.</li>
          </ul>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={startRecording}>Start recording</button>
          </div>
        </div>
      )}
    </>
  );
}
