"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";
import { useParticipantIdentity } from "@/app/components/ParticipantIdentity";

type VoiceSession = {
  id: string;
  summary: string | null;
  title: string | null;
  created_at: string;
  reminder_tags: string[];
  recall_label: string | null;
};

type VoiceStory = {
  id: string;
  title: string | null;
  summary: string | null;
  status: string;
  reminder_tags: string[];
  created_at: string;
};

type Moment = {
  id: string;
  title?: string | null;
  summary?: string | null;
  source?: string;
  created_at?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatSessionDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const day = d.getDate();
  const months = "Jan-Feb-Mar-Apr-May-Jun-Jul-Aug-Sep-Oct-Nov-Dec".split("-");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  const mins = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${day}-${month}-${year} ${hours}.${mins}${ampm}`;
}

function getRecallLabel(s: VoiceSession): string {
  if (s.recall_label?.trim()) return s.recall_label.trim();
  if (s.summary?.trim() && s.summary !== "Session recorded." && s.summary !== "Session recorded")
    return s.summary.trim();
  if (s.reminder_tags?.length) return s.reminder_tags.join(", ");
  return s.summary?.trim() || "No preview";
}

export default function MyMemoriesPage() {
  const { participantId, participantLabel, loading: identityLoading } = useParticipantIdentity();
  const [sessions, setSessions] = useState<VoiceSession[] | null>(null);
  const [stories, setStories] = useState<VoiceStory[] | null>(null);
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!participantId) {
      setSessions(null);
      setStories(null);
      setMoments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(participantId)}`).catch(() => []),
      apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(participantId)}`).catch(() => []),
      apiGet<Moment[]>(`/moments?visibility=private&participant_id=${encodeURIComponent(participantId)}`).catch(() => []),
    ])
      .then(([s, t, m]) => {
        setSessions(s);
        setStories(t);
        setMoments(m);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [participantId]);

  useEffect(() => {
    load();
  }, [load]);

  async function shareMoment(momentId: string) {
    setSharingId(momentId);
    try {
      await apiPost(`/moments/${encodeURIComponent(momentId)}/share`, {});
      load();
    } catch {
      // ignore
    } finally {
      setSharingId(null);
    }
  }

  async function shareStory(storyId: string) {
    setSharingId(storyId);
    try {
      await apiPost(
        `/voice/stories/${encodeURIComponent(storyId)}/share?participant_id=${encodeURIComponent(participantId!)}`,
        {}
      );
      load();
    } catch {
      // ignore
    } finally {
      setSharingId(null);
    }
  }

  if (identityLoading || !participantId) {
    return (
      <>
        <h1 className="page-title">My memories</h1>
        <p className="page-lead">
          Your private conversations, stories, and uploads. Share with family when you&rsquo;re ready.
        </p>
        {!identityLoading && !participantId && (
          <p style={{ color: "var(--ink-muted)" }}>
            Choose <strong>I&rsquo;m [Name]</strong> in the nav to see your private content.
          </p>
        )}
        <p style={{ marginTop: 32 }}>
          <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
        </p>
      </>
    );
  }

  const hasSessions = Array.isArray(sessions) && sessions.length > 0;
  const hasStories = Array.isArray(stories) && stories.length > 0;
  const hasMoments = moments.length > 0;
  const isEmpty = !hasSessions && !hasStories && !hasMoments;

  return (
    <>
      <h1 className="page-title">My memories</h1>
      <p className="page-lead">
        Private content for <strong>{participantLabel ?? "you"}</strong>. Share with family when you&rsquo;re ready.
      </p>

      {error && (
        <div className="card" style={{ marginBottom: 16, background: "var(--error-bg)", color: "var(--error)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--ink-muted)" }}>Loading…</p>
      ) : isEmpty ? (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ margin: 0, color: "var(--ink-muted)" }}>
            Nothing private yet. <Link href="/talk/session">Talk</Link> or <Link href="/create/upload">add a photo</Link> to get started.
          </p>
        </div>
      ) : (
        <>
          {hasSessions && (
            <section className="card" style={{ marginBottom: 24, padding: 16 }}>
              <h2 style={{ fontSize: "1rem", margin: "0 0 8px", fontWeight: 600 }}>Voice conversations</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-muted)" }}>
                Recent voice sessions. Open in Talk to save as a story or continue.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sessions!.map((s) => (
                  <li key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <Link
                      href={`/talk/session`}
                      style={{ display: "block", textDecoration: "none", color: "inherit" }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{formatSessionDateTime(s.created_at)}</span>
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-muted)" }}>{getRecallLabel(s)}</p>
                    </Link>
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={(e) => {
                          e.preventDefault();
                          shareMoment(s.id);
                        }}
                        disabled={!!sharingId}
                      >
                        {sharingId === s.id ? "Sharing…" : "Share with family"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasStories && (
            <section className="card" style={{ marginBottom: 24, padding: 16 }}>
              <h2 style={{ fontSize: "1rem", margin: "0 0 8px", fontWeight: 600 }}>Voice stories</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-muted)" }}>
                Refine in Talk or share with the family.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {stories!.map((s) => (
                  <li key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{formatSessionDateTime(s.created_at)}</span>
                    {(s.title?.trim() || s.summary?.trim()) && (
                      <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-muted)" }}>
                        {s.title?.trim() || (s.summary ?? "").slice(0, 60)}
                        {(s.summary ?? "").length > 60 ? "…" : ""}
                      </p>
                    )}
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <Link href="/talk/session" className="btn btn-ghost" style={{ fontSize: 12 }}>
                        Refine in Talk
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => shareStory(s.id)}
                        disabled={!!sharingId}
                      >
                        {sharingId === s.id ? "Sharing…" : "Share with family"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {hasMoments && (
            <section className="card" style={{ marginBottom: 24, padding: 16 }}>
              <h2 style={{ fontSize: "1rem", margin: "0 0 8px", fontWeight: 600 }}>Photos and uploads</h2>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-muted)" }}>
                Uploaded moments. Share with family to add them to Shared Memories.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
                {moments.map((m) => (
                  <li key={m.id}>
                    <div style={{ position: "relative" }}>
                      {m.thumbnail_url || m.image_url ? (
                        <img
                          src={m.thumbnail_url || m.image_url || ""}
                          alt=""
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            objectFit: "cover",
                            borderRadius: "var(--radius-sm)",
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            background: "var(--bg-muted)",
                            borderRadius: "var(--radius-sm)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 32,
                          }}
                        >
                          🎙️
                        </div>
                      )}
                      <div style={{ marginTop: 6 }}>
                        <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>{formatDate(m.created_at)}</span>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ display: "block", fontSize: 11, marginTop: 4 }}
                          onClick={() => shareMoment(m.id)}
                          disabled={!!sharingId}
                        >
                          {sharingId === m.id ? "Sharing…" : "Share with family"}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p style={{ marginTop: 32 }}>
        <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
