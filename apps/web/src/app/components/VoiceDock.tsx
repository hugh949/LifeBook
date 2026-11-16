"use client";

import type { SessionStatus } from "@/lib/useRealtimeSession";

type Props = {
  agentLabel: string;
  coachHint: string;
  status: SessionStatus;
  message?: string;
  mmss?: string;
  isBusy?: boolean;
  isListening?: boolean;
  onStart: () => void;
  onEnd: () => void;
};

export default function VoiceDock({
  agentLabel,
  coachHint,
  status,
  message,
  mmss,
  isBusy,
  isListening,
  onStart,
  onEnd,
}: Props) {
  const active = status === "listening" || status === "connecting";
  const micState =
    status === "listening"
      ? "listening"
      : status === "connecting"
        ? "connecting"
        : status === "saving"
          ? "saving"
          : status === "error"
            ? "error"
            : "idle";

  const statusLine =
    status === "listening"
      ? `Microphone is on${mmss ? ` · ${mmss}` : ""}`
      : status === "connecting"
        ? "Connecting the microphone…"
        : status === "saving"
          ? "Saving your talk…"
          : "Microphone is off";

  const hint =
    status === "listening"
      ? "Speak now. Tap finish when this part feels complete."
      : status === "connecting"
        ? "One moment. Tap cancel if you didn’t mean to start."
        : status === "saving"
          ? "Stay here. The next step opens on this screen."
          : status === "error"
            ? coachHint
            : "Tap the button, then speak. Nothing is heard until you do.";

  const label =
    status === "connecting"
      ? "Cancel"
      : status === "listening"
        ? "Tap to finish"
        : status === "saving"
          ? "Saving…"
          : status === "error"
            ? "Try again"
            : "Tap to talk";

  return (
    <div className={`talk-bar is-${micState}`} role="region" aria-label={`${agentLabel} microphone`}>
      <div className="talk-bar-status" aria-live="polite">
        <span className="talk-bar-dot" aria-hidden />
        <span>{statusLine}</span>
      </div>
      <p className="talk-bar-hint">{hint}</p>
      <button
        type="button"
        className="talk-bar-btn"
        aria-pressed={active}
        onClick={() => {
          if (active || isListening) onEnd();
          else if (!isBusy) onStart();
        }}
        disabled={status === "saving"}
      >
        {label}
      </button>
      {message ? (
        <div
          className={`msg ${status === "error" ? "msg-error" : status === "saved" ? "msg-success" : "msg-info"}`}
          role={status === "error" ? "alert" : "status"}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
