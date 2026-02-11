"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParticipantIdentity } from "./ParticipantIdentity";
import { useVoiceAgent } from "./VoiceAgentContext";
import { APP_VERSION } from "../version";
import FeedbackModal from "./FeedbackModal";

export default function AppNav() {
  const { participantId, participants, setParticipantId, loading, listReady } = useParticipantIdentity();
  const { isListening } = useVoiceAgent();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <nav className="app-nav">
      <div className="app-nav-brand-row">
        <Image
          src="/xavor-logo.png"
          alt="Xavor"
          width={80}
          height={32}
          className="app-nav-logo"
        />
        <span className="app-nav-brand-version">
          <Link href="/" className="brand">
            LifeBook
          </Link>{" "}
          <span className="app-nav-version-tagline">
            <span className="app-nav-version">v{APP_VERSION}</span>
            <span className="app-nav-tagline">
              AI App by Xavor Venture Studios for Crafting and Sharing Intergenerational Family Stories
            </span>
          </span>
        </span>
      </div>
      <div className="app-nav-spacer" aria-hidden="true" />
      <div className="app-nav-links">
        <span
          role="status"
          aria-live="polite"
          aria-label={isListening ? "Voice agent is listening" : "Voice agent is not listening"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: isListening ? "var(--success, #22c55e)" : "var(--ink-muted)",
            marginRight: 8,
          }}
          title={isListening ? "Voice agent is listening" : "Voice agent is not listening"}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isListening ? "currentColor" : "var(--ink-muted)",
              opacity: isListening ? 1 : 0.5,
            }}
          />
          {isListening ? "Listening" : "Not listening"}
        </span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
          <span style={{ color: "var(--ink-muted)" }}>I&rsquo;m</span>
          <select
            value={loading ? "" : (participantId ?? "")}
            onChange={(e) => setParticipantId(e.target.value || null)}
            disabled={loading}
            style={{
              minHeight: 44,
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--ink-muted)",
              background: "var(--bg)",
              color: "var(--ink)",
              fontSize: 16,
              opacity: loading ? 0.8 : 1,
            }}
            aria-label="Who is using the app"
            aria-busy={loading}
          >
            <option value="">{loading ? "Loading…" : "New User"}</option>
            {!loading &&
              (() => {
                const seenLabels = new Set<string>();
                return participants
                  .filter((p) => {
                    if (!(p.label ?? "").trim()) return false;
                    const label = p.label!.trim();
                    if (label.toLowerCase() === "new user") return false;
                    if (seenLabels.has(label)) return false;
                    seenLabels.add(label);
                    return true;
                  })
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ));
              })()}
          </select>
        </label>
        <Link
          href="/talk/session"
          onClick={(e) => !listReady && e.preventDefault()}
          style={{
            pointerEvents: listReady ? undefined : "none",
            opacity: listReady ? undefined : 0.6,
            cursor: listReady ? undefined : "not-allowed",
          }}
          aria-disabled={!listReady}
        >
          My Memories
        </Link>
        <Link
          href="/bank"
          onClick={(e) => !listReady && e.preventDefault()}
          style={{
            pointerEvents: listReady ? undefined : "none",
            opacity: listReady ? undefined : 0.6,
            cursor: listReady ? undefined : "not-allowed",
          }}
          aria-disabled={!listReady}
        >
          Shared Memories
        </Link>
        <button
          type="button"
          className="app-nav-link-btn"
          onClick={() => listReady && setFeedbackOpen(true)}
          disabled={!listReady}
          style={{
            opacity: listReady ? undefined : 0.6,
            cursor: listReady ? undefined : "not-allowed",
          }}
          aria-disabled={!listReady}
        >
          App Feedback
        </button>
      </div>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </nav>
  );
}
