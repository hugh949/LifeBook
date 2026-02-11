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
      className="feedback-modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card feedback-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            paddingTop: "max(12px, env(safe-area-inset-top))",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 id="feedback-modal-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
            App Feedback
          </h2>
        </div>
        <div style={{ padding: "20px 16px", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
          <label style={{ display: "block", marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
            Feedback
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Share your feedback: use cases, feature ideas, or report a bug..."
            rows={5}
            className="input"
            style={{
              width: "100%",
              marginBottom: 16,
              resize: "vertical",
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
          <div className="action-row" style={{ justifyContent: "center" }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} style={{ minHeight: "var(--touch)" }}>
              Cancel
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleSend} style={{ minHeight: "var(--touch)" }}>
              Send feedback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
