"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { getRealtimeToken, connectRealtimeWebRTC } from "@/lib/realtime";

type Status = "idle" | "connecting" | "connected" | "stubbed" | "error";

export default function SessionPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const endSession = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
      pcRef.current = null;
    }
    if (audioRef.current?.srcObject) {
      (audioRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      audioRef.current.srcObject = null;
    }
    setStatus("idle");
    setMessage("");
  }, []);

  async function handleStart() {
    setStatus("connecting");
    setMessage("");

    try {
      const data = await getRealtimeToken();
      if (data.stubbed) {
        setStatus("stubbed");
        setMessage(
          "Voice isn’t connected (no API key). Add OPENAI_API_KEY in the server .env to enable the voice companion."
        );
        return;
      }

      const ephemeralKey = data.value ?? data.client_secret;
      if (!ephemeralKey) {
        setStatus("error");
        setMessage("No token received from server.");
        return;
      }

      const audio = audioRef.current ?? document.createElement("audio");
      if (!audioRef.current) {
        audioRef.current = audio;
        audio.style.display = "none";
        document.body.appendChild(audio);
      }

      const { pc } = await connectRealtimeWebRTC(ephemeralKey, audio);
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          endSession();
        }
      };

      setStatus("connected");
      setMessage("You’re live. Speak naturally — one question at a time.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Connection failed");
    }
  }

  return (
    <>
      <h1 className="page-title">Voice session</h1>
      <p className="page-lead">
        Talk with a gentle companion. One question at a time — we’ll listen and remember.
      </p>

      <div style={{ maxWidth: 400 }}>
        {status === "idle" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleStart}
            style={{ width: "100%", fontSize: "1.1rem", padding: "16px" }}
          >
            Start talking
          </button>
        )}

        {status === "connecting" && (
          <p style={{ color: "var(--ink-muted)" }}>Connecting… (allow microphone if prompted)</p>
        )}

        {status === "connected" && (
          <>
            <div
              className="card"
              style={{
                background: "var(--success-bg)",
                color: "var(--success)",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: "1.25rem" }}>● Live</span>
              <p style={{ margin: "8px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
                {message}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={endSession}
              style={{ width: "100%" }}
            >
              End session
            </button>
          </>
        )}

        {(status === "stubbed" || status === "error") && message && (
          <div
            role="alert"
            className="card"
            style={{
              marginBottom: 16,
              background: status === "error" ? "var(--error-bg)" : "var(--success-bg)",
              color: status === "error" ? "var(--error)" : "var(--ink-muted)",
            }}
          >
            <p style={{ margin: 0 }}>{message}</p>
            {status === "error" && (
              <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.9 }}>
                Check browser console (F12) for full API response details.
              </p>
            )}
          </div>
        )}

        {(status === "stubbed" || status === "error") && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setStatus("idle"); setMessage(""); }}
            style={{ width: "100%" }}
          >
            Try again
          </button>
        )}
      </div>

      <p style={{ marginTop: 32 }}>
        <Link href="/older">Older Mode</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
