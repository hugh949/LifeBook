"use client";

import React, { useState, useRef, useEffect } from "react";

const TO_EMAIL = "hrashid@xavor.com";
const SUBJECT = "LifeBook App Feedback";

/** Web Speech API (not in all TS libs). Declare so build succeeds in Node/CI. */
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: { resultIndex: number; results: unknown }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export default function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechSupported =
    typeof window !== "undefined" &&
    (window.SpeechRecognition != null || window.webkitSpeechRecognition != null);

  useEffect(() => {
    if (!open) {
      setError(null);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
      setRecording(false);
    }
  }, [open]);

  function startRecording() {
    if (!speechSupported) return;
    const Klass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Klass) return;
    const rec = new Klass();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.onresult = (e: { resultIndex: number; results: unknown }) => {
      const results = e.results as { [i: number]: { isFinal: boolean; 0: { transcript: string } } };
      const last = e.resultIndex;
      const result = results[last];
      if (result?.isFinal) {
        const transcript = result[0]?.transcript ?? "";
        setText((prev) => (prev ? prev + " " + transcript : transcript));
      }
    };
    rec.onerror = () => setRecording(false);
    rec.onend = () => setRecording(false);
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  }

  function stopRecording() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setRecording(false);
  }

  function handleSend() {
    setError(null);
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError("Please enter your feedback.");
      return;
    }
    const mailtoUrl = `mailto:${TO_EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(trimmedText)}`;
    window.open(mailtoUrl, "_blank", "noopener,noreferrer");
    onClose();
    setText("");
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflow: "auto",
        background: "rgba(0,0,0,0.4)",
        padding: "max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card"
        style={{
          maxWidth: 480,
          width: "100%",
          minWidth: 0,
          margin: "0 auto 2rem",
          padding: 0,
          overflow: "hidden",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 id="feedback-modal-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            App Feedback
          </h2>
        </div>
        <div style={{ padding: "20px 16px" }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
            Feedback
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share your feedback: use cases, feature ideas, or report a bug..."
            rows={5}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontSize: 16,
              resize: "vertical",
              marginBottom: 16,
              boxSizing: "border-box",
              fontFamily: "inherit",
              minHeight: 120,
            }}
            aria-required
          />
          {speechSupported && (
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "center" }}>
              {!recording ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startRecording}
                  style={{ fontSize: 14 }}
                >
                  Record (speak to transcribe)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={stopRecording}
                  style={{ fontSize: 14 }}
                >
                  Stop recording
                </button>
              )}
            </div>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--error)", marginBottom: 12, fontSize: 14 }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleSend}>
              Send feedback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
