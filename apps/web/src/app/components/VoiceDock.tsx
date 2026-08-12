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
          : "idle";

  const label =
    status === "connecting"
      ? "Cancel…"
      : status === "listening"
        ? "End talk"
        : status === "saving"
          ? "Saving…"
          : status === "error"
            ? "Try again"
            : `Talk with ${agentLabel}`;

  return (
    <div className="voice-dock">
      <div className="voice-dock-agent">{agentLabel}</div>
      <p className="voice-dock-hint text-muted">
        {status === "listening"
          ? "Listening — speak naturally. End when you’re ready."
          : status === "connecting"
            ? "Connecting — tap Cancel to stop."
            : coachHint}
      </p>
      <button
        type="button"
        className="talk-mic voice-dock-mic"
        data-state={micState}
        onClick={() => {
          if (active || isListening) onEnd();
          else if (!isBusy) onStart();
        }}
        disabled={status === "saving"}
        aria-label={label}
      >
        {label}
        {isListening && mmss ? (
          <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, opacity: 0.9 }}>{mmss}</div>
        ) : null}
      </button>
      {message ? (
        <div
          className={`msg ${status === "error" ? "msg-error" : status === "saved" ? "msg-success" : "msg-info"}`}
          role={status === "error" ? "alert" : "status"}
          style={{ width: "100%", marginTop: 10 }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
