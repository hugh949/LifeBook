"use client";

import Link from "next/link";
import { useParticipantIdentity } from "./ParticipantIdentity";

export default function AppNav() {
  const { participantId, participantLabel, participants, setParticipantId, loading } = useParticipantIdentity();

  return (
    <nav className="app-nav">
      <Link href="/" className="brand">
        LifeBook
      </Link>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Link href="/talk/session">My Memories</Link>
        <Link href="/bank">Shared Memories</Link>
        {!loading && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <span style={{ color: "var(--ink-muted)" }}>I&rsquo;m</span>
            <select
              value={participantId ?? ""}
              onChange={(e) => setParticipantId(e.target.value || null)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--ink-muted)",
                background: "var(--bg)",
                color: "var(--ink)",
                fontSize: 14,
              }}
              aria-label="Who is using the app"
            >
              <option value="">New User</option>
              {(() => {
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
        )}
      </div>
    </nav>
  );
}
