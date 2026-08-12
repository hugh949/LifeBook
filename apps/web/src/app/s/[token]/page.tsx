"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { apiGet, apiPost, API_BASE } from "@/lib/api";
import Avatar from "@/app/components/Avatar";

type Meta = {
  token: string;
  target_type: "conversation" | "story";
  title: string | null;
  owner_display_name: string;
  requires_password?: boolean;
  requires_code?: boolean;
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
  bgm_track?: string;
  bgm_url?: string | null;
  pencil_avatar_url: string | null;
  owner_display_name: string;
  created_at: string;
  photo_url?: string | null;
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

function narrationSrc(token: string, password: string): string {
  const base = `${API_BASE}/shares/${encodeURIComponent(token)}/narration`;
  return `${base}?password=${encodeURIComponent(password)}`;
}

const BGM_VOLUME = 0.32;
const BGM_IDS = new Set(["neutral", "warm", "reflective", "nostalgic"]);
const BGM_CHOICES = new Set(["none", ...BGM_IDS]);

function normalizeBgmTrack(track: string | undefined | null): string {
  const id = (track || "neutral").trim().toLowerCase();
  return BGM_CHOICES.has(id) ? id : "neutral";
}

function bgmPublicSrc(track: string | undefined): string | undefined {
  const id = normalizeBgmTrack(track);
  if (id === "none") return undefined;
  return `/bgm/${id}.mp3?v=3`;
}

function resolveBgmSrc(track: string | undefined, customUrl?: string | null): string | undefined {
  const custom = (customUrl || "").trim();
  if (custom) return custom;
  return bgmPublicSrc(track);
}

export default function SharePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token || "";

  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [unlockedPassword, setUnlockedPassword] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);

  const setNarrationAudio = useCallback((el: HTMLAudioElement | null) => {
    narrationRef.current = el;
    setAudioEl(el);
  }, []);

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

  const loadComments = useCallback(
    (pw: string) => {
      if (!token || !pw) return;
      apiGet<Comment[]>(
        `/shares/${encodeURIComponent(token)}/comments?password=${encodeURIComponent(pw)}`
      )
        .then(setComments)
        .catch(() => setComments([]));
    },
    [token]
  );

  const submitUnlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!meta) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const pw = password.trim();
      const pb = await apiPost<Playback>(`/shares/${encodeURIComponent(token)}/unlock`, {
        password: pw,
      });
      setPlayback(pb);
      setUnlockedPassword(pw);
      loadComments(pw);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "That password doesn't match.");
    } finally {
      setUnlocking(false);
    }
  };

  const togglePlay = () => {
    const n = narrationRef.current;
    if (!n) return;
    const b = bgmRef.current;
    const track = normalizeBgmTrack(playback?.bgm_track);
    if (n.paused) {
      if (b && track !== "none") {
        const src = resolveBgmSrc(track, playback?.bgm_url);
        if (src) {
          const attr = b.getAttribute("src") || "";
          const absolute = new URL(src, window.location.origin).href;
          if (attr !== src && b.src !== absolute && b.src !== src) {
            b.src = src;
          }
        }
        b.muted = false;
        b.volume = BGM_VOLUME;
        b.loop = true;
        if (n.currentTime < 0.25 || n.ended) {
          try {
            b.currentTime = 0;
          } catch {
            /* ignore */
          }
        }
        void b.play().catch(() => {});
      } else {
        b?.pause();
      }
      void n.play().then(() => setPlaying(true)).catch(() => {
        b?.pause();
        setPlaying(false);
      });
    } else {
      n.pause();
      b?.pause();
      setPlaying(false);
    }
  };

  const submitComment = async (e: FormEvent) => {
    e.preventDefault();
    setCommentError(null);
    if (!unlockedPassword) {
      setCommentError("Unlock with the password first.");
      return;
    }
    const name = commenterName.trim();
    const text = commentText.trim();
    if (!name) {
      setCommentError("Please share your name.");
      return;
    }
    if (!text) {
      setCommentError("Please write a short message.");
      return;
    }
    setCommentSubmitting(true);
    try {
      const c = await apiPost<Comment>(`/shares/${encodeURIComponent(token)}/comments`, {
        recipient_name: name,
        text,
        password: unlockedPassword,
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

  const unlocked = playback != null && unlockedPassword != null;
  const title =
    playback?.title ||
    meta.title ||
    (meta.target_type === "story" ? "A private story" : "A private memory");

  return (
    <div className="share-stage stack-12">
      <header className="share-listen-header stack-12 center">
        <Avatar
          imageUrl={playback?.pencil_avatar_url ?? meta.pencil_avatar_url ?? null}
          audio={audioEl}
          playing={playing}
          size={200}
          alt=""
        />
        <div className="center">
          <p className="share-from">{meta.owner_display_name}</p>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            {title}
          </h1>
          {!unlocked ? (
            <p className="text-muted" style={{ marginTop: 6 }}>
              Enter the password to listen.
            </p>
          ) : null}
        </div>
      </header>

      {!unlocked ? (
        <form onSubmit={submitUnlock} className="share-unlock stack-12">
          <label style={{ display: "block", textAlign: "left" }}>
            <div style={{ marginBottom: 6, fontWeight: 600 }}>Password</div>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                fontSize: 18,
                width: "100%",
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid var(--border)",
              }}
              placeholder="Password"
            />
          </label>
          {unlockError ? (
            <div className="msg msg-error" role="alert">
              {unlockError}
            </div>
          ) : null}
          <button
            className="btn btn-primary"
            disabled={unlocking || password.trim().length < 4}
            type="submit"
          >
            {unlocking ? "Checking…" : "Unlock"}
          </button>
        </form>
      ) : null}

      {unlocked && playback && unlockedPassword ? (
        <div className="share-listen stack-12">
          {playback.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={playback.photo_url}
              alt=""
              className="story-photo share-story-photo"
            />
          ) : null}
          <audio
            ref={setNarrationAudio}
            src={narrationSrc(token, unlockedPassword)}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              bgmRef.current?.pause();
            }}
            onEnded={() => {
              setPlaying(false);
              const bgm = bgmRef.current;
              if (bgm) {
                bgm.pause();
                bgm.currentTime = 0;
              }
            }}
            onError={() => {
              setPlaying(false);
              bgmRef.current?.pause();
              setUnlockError("Narration couldn't load. Please try again in a moment.");
            }}
          />
          <audio
            ref={bgmRef}
            src={resolveBgmSrc(playback.bgm_track, playback.bgm_url)}
            preload="auto"
            loop
            aria-hidden
            style={{ display: "none" }}
          />
          {unlockError ? (
            <div className="msg msg-error" role="alert">
              {unlockError}
            </div>
          ) : null}
          <div className="btn-row" style={{ justifyContent: "center" }}>
            <button
              className="btn btn-primary share-play-btn"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play narration"}
            >
              {playing ? "Pause" : "Play"}
            </button>
          </div>
          {playback.body_text ? (
            <details className="share-secondary">
              <summary>Read along</summary>
              <div className="prose" style={{ whiteSpace: "pre-wrap", marginTop: 8, textAlign: "left" }}>
                {playback.body_text}
              </div>
            </details>
          ) : null}

          <details className="share-secondary">
            <summary>Leave a note for {meta.owner_display_name}</summary>
            <form onSubmit={submitComment} className="stack-12" style={{ marginTop: 12, textAlign: "left" }}>
              <label style={{ display: "block" }}>
                <div style={{ marginBottom: 4, fontSize: 14 }}>Your name</div>
                <input
                  type="text"
                  value={commenterName}
                  onChange={(e) => setCommenterName(e.target.value)}
                  required
                  maxLength={120}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <div style={{ marginBottom: 4, fontSize: 14 }}>Your message</div>
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  required
                  maxLength={2000}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    resize: "vertical",
                  }}
                />
              </label>
              {commentError ? (
                <div className="msg msg-error" role="alert">
                  {commentError}
                </div>
              ) : null}
              <button className="btn btn-primary" type="submit" disabled={commentSubmitting}>
                {commentSubmitting ? "Sending…" : "Send"}
              </button>
            </form>

            {comments.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", textAlign: "left" }} className="stack-12">
                {comments.map((c) => (
                  <li key={c.id} style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 14, color: "var(--ink-muted)" }}>
                      {c.recipient_name} · {formatDate(c.created_at)}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{c.text}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        </div>
      ) : null}
    </div>
  );
}
