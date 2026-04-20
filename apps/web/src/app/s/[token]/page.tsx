"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import Avatar from "@/app/components/Avatar";

type Meta = {
  token: string;
  target_type: "conversation" | "story";
  title: string | null;
  owner_display_name: string;
  requires_code: boolean;
  pencil_avatar_url: string | null;
  teaser: string | null;
};

type Playback = {
  token: string;
  target_type: "conversation" | "story";
  title: string | null;
  summary: string | null;
  body_text: string | null;
  narration_url: string;
  pencil_avatar_url: string | null;
  owner_display_name: string;
  created_at: string;
};

type Comment = {
  id: string;
  recipient_name: string;
  text: string;
  created_at: string;
};

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function narrationSrc(token: string, code: string | null): string {
  const base = `${API_BASE}/shares/${encodeURIComponent(token)}/narration`;
  return code ? `${base}?code=${encodeURIComponent(code)}` : base;
}

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [code, setCode] = useState<string>("");
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const [comments, setComments] = useState<Comment[]>([]);
  const [commenterName, setCommenterName] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiGet<Meta>(`/shares/${encodeURIComponent(token)}`)
      .then((m) => {
        setMeta(m);
        setMetaError(null);
      })
      .catch((e: Error) => setMetaError(e.message || "This link is no longer available."));
  }, [token]);

  const loadComments = useCallback(() => {
    if (!token) return;
    apiGet<Comment[]>(`/shares/${encodeURIComponent(token)}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [token]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // Auto-load playback for shares without a code.
  useEffect(() => {
    if (!meta || meta.requires_code || playback) return;
    apiGet<Playback>(`/shares/${encodeURIComponent(token)}/playback`)
      .then(setPlayback)
      .catch((e: Error) => setUnlockError(e.message));
  }, [meta, token, playback]);

  const submitUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!meta) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const pb = await apiPost<Playback>(`/shares/${encodeURIComponent(token)}/unlock`, { code });
      setPlayback(pb);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "That code doesn't match.");
    } finally {
      setUnlocking(false);
    }
  };

  const togglePlay = () => {
    const a = audioEl;
    if (!a) return;
    if (a.paused) {
      a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    setCommentError(null);
    const name = commenterName.trim();
    const text = commentText.trim();
    if (!name) { setCommentError("Please share your name."); return; }
    if (!text) { setCommentError("Please write a short message."); return; }
    setCommentSubmitting(true);
    try {
      const c = await apiPost<Comment>(`/shares/${encodeURIComponent(token)}/comments`, {
        recipient_name: name,
        text,
      });
      setComments((prev) => [c, ...prev]);
      setCommentText("");
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Couldn't send your comment. Try again.");
    } finally {
      setCommentSubmitting(false);
    }
  };

  if (metaError) {
    return (
      <div className="share-stage">
        <h1 className="page-title">This link isn&rsquo;t available</h1>
        <p className="text-muted">{metaError}</p>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="share-stage center">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  const lockedOrReady = playback != null;
  const srcForCode = meta.requires_code ? code : null;

  return (
    <div className="share-stage stack-12">
      <header className="stack-12 center">
        <Avatar
          imageUrl={playback?.pencil_avatar_url ?? meta.pencil_avatar_url ?? null}
          audio={audioEl}
          playing={playing}
          size={200}
          alt={`${meta.owner_display_name}'s pencil avatar`}
        />
        <div className="center">
          <div style={{ fontSize: 14, color: "var(--ink-muted)" }}>
            {meta.owner_display_name} shared a {meta.target_type === "story" ? "story" : "memory"}
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            {playback?.title || meta.title || (meta.target_type === "story" ? "A story" : "A memory")}
          </h1>
          {meta.teaser && !lockedOrReady ? (
            <p className="text-muted" style={{ marginTop: 6 }}>{meta.teaser}</p>
          ) : null}
        </div>
      </header>

      {!lockedOrReady && meta.requires_code ? (
        <form onSubmit={submitUnlock} className="card stack-12">
          <label style={{ display: "block" }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>
              Enter the 4-digit code {meta.owner_display_name} shared with you
            </div>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              style={{
                fontSize: 28,
                letterSpacing: 12,
                textAlign: "center",
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
              placeholder="••••"
            />
          </label>
          {unlockError ? <div className="msg msg-error" role="alert">{unlockError}</div> : null}
          <button className="btn btn-primary" disabled={unlocking || code.length !== 4} type="submit">
            {unlocking ? "Checking…" : "Unlock"}
          </button>
        </form>
      ) : null}

      {playback ? (
        <div className="card stack-12">
          <audio
            ref={setAudioEl}
            src={narrationSrc(token, srcForCode)}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setUnlockError("Narration couldn't load. Please try again in a moment.");
            }}
          />
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={togglePlay} aria-label={playing ? "Pause" : "Play narration"}>
              {playing ? "Pause" : "Play"}
            </button>
          </div>
          {playback.body_text ? (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-muted)" }}>Read along</summary>
              <div className="prose" style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>
                {playback.body_text}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      <section className="card stack-12">
        <h2 style={{ margin: 0, fontSize: 18 }}>Leave a note for {meta.owner_display_name}</h2>
        <form onSubmit={submitComment} className="stack-12">
          <label style={{ display: "block" }}>
            <div style={{ marginBottom: 4, fontSize: 14 }}>Your name</div>
            <input
              type="text"
              value={commenterName}
              onChange={(e) => setCommenterName(e.target.value)}
              required
              maxLength={120}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}
            />
          </label>
          <label style={{ display: "block" }}>
            <div style={{ marginBottom: 4, fontSize: 14 }}>Your message</div>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              required
              maxLength={2000}
              rows={4}
              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", resize: "vertical" }}
            />
          </label>
          {commentError ? <div className="msg msg-error" role="alert">{commentError}</div> : null}
          <button className="btn btn-primary" type="submit" disabled={commentSubmitting}>
            {commentSubmitting ? "Sending…" : "Send"}
          </button>
        </form>
      </section>

      {comments.length > 0 ? (
        <section className="stack-12">
          <h2 style={{ margin: 0, fontSize: 18 }}>Notes from others</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="stack-12">
            {comments.map((c) => (
              <li key={c.id} className="card">
                <div style={{ fontSize: 14, color: "var(--ink-muted)" }}>
                  {c.recipient_name} · {formatDate(c.created_at)}
                </div>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{c.text}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
