"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useParticipantIdentity, PARTICIPANT_STORAGE_KEY } from "../components/ParticipantIdentity";
import { requestUploadUrl, completeUpload } from "@/lib/media";

type Moment = {
  id: string;
  title?: string | null;
  summary?: string | null;
  source?: string;
  created_at?: string | null;
  thumbnail_url?: string | null;
  image_url?: string | null;
  participant_id?: string | null;
  reaction_log?: string | null;
};

type SharedStory = {
  id: string;
  title: string | null;
  summary: string | null;
  reaction_log?: string | null;
  participant_id?: string | null;
  participant_name: string;
  created_at: string;
  has_audio: boolean;
};

/** Full moment from GET /moments/:id (for in-place panel) */
type MomentAsset = {
  id: string;
  type: string;
  role: string;
  playback_url?: string | null;
  duration_sec?: number | null;
};
type MomentDetail = {
  id: string;
  title: string | null;
  summary: string | null;
  source: string;
  created_at: string;
  thumbnail_url?: string | null;
  image_url?: string | null;
  assets?: MomentAsset[] | null;
};

function sharedStoryIdSet(shared: SharedStory[]): Set<string> {
  const set = new Set<string>();
  for (const s of shared) set.add(s.id);
  return set;
}

function formatDate(created_at: string | null | undefined): string {
  if (!created_at) return "";
  const d = new Date(created_at);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Same style as recall conversation list: e.g. "6-Feb-2025 3.45pm" */
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

/** True if URL is a stub (e.g. local-mvp) that won't load as an image */
function isStubMediaUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  return url.startsWith("https://local-mvp/") || url.startsWith("http://local-mvp/");
}

function getStoredParticipantId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const stored = window.localStorage.getItem(PARTICIPANT_STORAGE_KEY);
    return stored?.trim() || null;
  } catch {
    return null;
  }
}

export default function BankPage() {
  const { participantId, participantLabel } = useParticipantIdentity();
  const [participantIdFromStorage, setParticipantIdFromStorage] = useState<string | null>(getStoredParticipantId);
  const readStoredParticipant = useCallback(() => {
    setParticipantIdFromStorage(getStoredParticipantId());
  }, []);
  useEffect(() => {
    readStoredParticipant();
  }, [participantId, readStoredParticipant]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onVisibility = () => readStoredParticipant();
    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [readStoredParticipant]);
  const effectiveParticipantId = (participantId ?? participantIdFromStorage ?? "").trim() || null;
  const normalizedParticipantId = effectiveParticipantId;
  const currentUserLabel = (participantLabel ?? "").trim() || null;
  const [moments, setMoments] = useState<Moment[]>([]);
  const [sharedStories, setSharedStories] = useState<SharedStory[]>([]);
  const [loading, setLoading] = useState(true);
  /** When set, show recall-code prompt to delete this shared story (author only). */
  const [deleteStoryId, setDeleteStoryId] = useState<string | null>(null);
  /** When set, show inline edit for this story's text (author only). */
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editingStoryText, setEditingStoryText] = useState("");
  const [editingStorySaving, setEditingStorySaving] = useState(false);
  const [editingStoryError, setEditingStoryError] = useState<string | null>(null);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSending, setDeleteSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** When set, this voice story is playing in place; value is the playback URL. */
  const [playingMomentId, setPlayingMomentId] = useState<string | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  /** When set, show in-place detail panel (no navigation to /m/[id]). */
  const [selectedMomentId, setSelectedMomentId] = useState<string | null>(null);
  /** When set, this voice story row is expanded in place. */
  const [expandedVoiceId, setExpandedVoiceId] = useState<string | null>(null);
  /** What to show when expanded: view (story + reactions), reaction (reactions + form), edit (story edit only). */
  const [expandedMode, setExpandedMode] = useState<"view" | "reaction" | "edit" | null>(null);
  /** Playback URL for the expanded voice story (so audio is playable inline). */
  const [expandedPlaybackUrl, setExpandedPlaybackUrl] = useState<string | null>(null);

  const [panelMoment, setPanelMoment] = useState<MomentDetail | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  /** Inline comment/reaction text for the expanded voice story. */
  const [inlineCommentText, setInlineCommentText] = useState("");
  const [inlineCommentSending, setInlineCommentSending] = useState(false);
  const [inlineCommentError, setInlineCommentError] = useState<string | null>(null);
  /** Name used for reaction log (persisted so family members don't re-type). */
  const [reactionAuthorName, setReactionAuthorName] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("lifebook_reaction_name") || "";
  });
  /** Voice reaction: which story we're recording for, blob after stop, upload state. */
  const [recordingMomentId, setRecordingMomentId] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordSending, setRecordSending] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  /** OpenAI TTS narration: which story is currently playing. */
  const [narratingMomentId, setNarratingMomentId] = useState<string | null>(null);
  const [narrateLoading, setNarrateLoading] = useState(false);
  const [narrateError, setNarrateError] = useState<string | null>(null);
  const narrateAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrateUrlRef = useRef<string | null>(null);
  const narrateBgmRef = useRef<HTMLAudioElement | null>(null);
  /** True once playback finished naturally (onended); used to ignore spurious onerror after cleanup. */
  const narratePlaybackCompletedRef = useRef(false);
  /** When TTS is ready but user has not tapped play yet (avoids autoplay block). */
  const [showTapToPlay, setShowTapToPlay] = useState(false);
  /** "cloned" = your voice; "default" = AI voice (clone not used or unavailable). */
  const [narrateVoiceUsed, setNarrateVoiceUsed] = useState<"cloned" | "default" | null>(null);
  const narratePendingBgmUrlRef = useRef<string | null>(null);
  const NARRATE_FETCH_TIMEOUT_MS = 120000;
  /** Shared Memories view: voice (default) | photos | videos */
  const [bankView, setBankView] = useState<"voice" | "photos" | "videos">("voice");

  useEffect(() => {
    apiGet<Moment[]>("/moments")
      .then(setMoments)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
    apiGet<SharedStory[]>("/voice/stories/shared")
      .then(setSharedStories)
      .catch(() => setSharedStories([]));
  }, []);

  const fetchPanelMoment = useCallback((momentId: string) => {
    setPanelError(null);
    setPanelLoading(true);
    apiGet<MomentDetail>(`/moments/${momentId}`)
      .then(setPanelMoment)
      .catch((err) => setPanelError(err instanceof Error ? err.message : "Failed to load moment"))
      .finally(() => setPanelLoading(false));
  }, []);

  useEffect(() => {
    if (selectedMomentId) {
      setPanelMoment(null);
      fetchPanelMoment(selectedMomentId);
    } else {
      setPanelMoment(null);
      setPanelError(null);
    }
  }, [selectedMomentId, fetchPanelMoment]);

  // When a voice story is expanded, fetch playback URL so audio is playable inline
  useEffect(() => {
    if (!expandedVoiceId) {
      setExpandedPlaybackUrl(null);
      return;
    }
    const story = sharedStories.find((s) => s.id === expandedVoiceId);
    if (!story?.has_audio) {
      setExpandedPlaybackUrl(null);
      return;
    }
    setExpandedPlaybackUrl(null);
    apiGet<{ url: string }>(`/voice/stories/shared/playback?moment_id=${encodeURIComponent(expandedVoiceId)}`)
      .then(({ url }) => setExpandedPlaybackUrl(url))
      .catch(() => setExpandedPlaybackUrl(null));
  }, [expandedVoiceId, sharedStories]);

  function playSharedStory(momentId: string) {
    apiGet<{ url: string }>(`/voice/stories/shared/playback?moment_id=${encodeURIComponent(momentId)}`)
      .then(({ url }) => {
        setPlayingMomentId(momentId);
        setPlayingUrl(url);
        // Start playback once the inline <audio> is in the DOM
        setTimeout(() => {
          const el = document.querySelector<HTMLAudioElement>(`audio[data-moment-id="${momentId}"]`);
          if (el) el.play().catch(() => {});
        }, 50);
      })
      .catch(() => {});
  }

  function refetchSharedStories() {
    apiGet<SharedStory[]>("/voice/stories/shared")
      .then(setSharedStories)
      .catch(() => {});
  }

  async function handleInlineAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!expandedVoiceId || !inlineCommentText.trim() || inlineCommentSending) return;
    setInlineCommentError(null);
    setInlineCommentSending(true);
    const name = reactionAuthorName.trim() || "A family member";
    if (typeof window !== "undefined") window.localStorage.setItem("lifebook_reaction_name", name);
    const timestamp = formatSessionDateTime(new Date().toISOString());
    const commentWithLog = `${name} · ${timestamp}\n\n${inlineCommentText.trim()}`;
    try {
      await apiPatch(`/moments/${expandedVoiceId}`, { add_comment: commentWithLog });
      setInlineCommentText("");
      refetchSharedStories();
    } catch (err) {
      setInlineCommentError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setInlineCommentSending(false);
    }
  }

  /** Narrate story using OpenAI TTS with synthetic AI-generated BGM (unique per story, cached). */
  async function narrateStory(story: SharedStory) {
    const text = (story.summary?.trim() || story.title?.trim() || "No content to read.").slice(0, 4096);
    if (!text.trim()) return;
    if (typeof window !== "undefined") {
      console.log("[narrate] narrateStory called", { storyId: story.id, textLen: text.length });
    }
    stopNarrate();
    setNarrateError(null);
    setNarrateLoading(true);
    setNarratingMomentId(story.id);
    const ttsBody = JSON.stringify({
      text: text.trim(),
      ...(story.participant_id ? { participant_id: story.participant_id } : {}),
    });
    const bgmBody = JSON.stringify({ moment_id: story.id, text: text.trim() });
    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), NARRATE_FETCH_TIMEOUT_MS);
    try {
      const bgmPromise = fetch(`${API_BASE}/voice/narrate/bgm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bgmBody,
      })
        .then((r) => {
          if (typeof window !== "undefined") {
            console.log("[narrate] BGM fetch completed", { status: r.status, ok: r.ok });
          }
          return r.ok ? r.json() : { url: null };
        })
        .catch((e) => {
          if (typeof window !== "undefined") console.warn("[narrate] BGM fetch failed", e);
          return { url: null };
        });

      if (typeof window !== "undefined") {
        console.log("[narrate] TTS fetch starting", { participant_id: story.participant_id ?? null });
      }
      const narrateRes = await fetch(`${API_BASE}/voice/narrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: ttsBody,
        signal: abort.signal,
      });
      clearTimeout(timeoutId);

      const narrationVoice = (narrateRes.headers.get("X-Narration-Voice") ?? "unknown") as "cloned" | "default" | string;
      setNarrateVoiceUsed(narrationVoice === "cloned" ? "cloned" : narrationVoice === "default" ? "default" : null);
      if (typeof window !== "undefined") {
        console.log("[narrate] TTS fetch completed", {
          status: narrateRes.status,
          ok: narrateRes.ok,
          "X-Narration-Voice": narrationVoice,
          participant_id: story.participant_id ?? null,
        });
      }

      if (!narrateRes.ok) {
        const errBody = await narrateRes.text();
        let msg = narrateRes.statusText;
        try {
          const j = JSON.parse(errBody);
          if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
        } catch {
          if (errBody) msg = errBody.slice(0, 200);
        }
        throw new Error(msg);
      }
      const blob = await narrateRes.blob();
      if (typeof window !== "undefined") {
        console.log("[narrate] TTS blob received", { size: blob.size });
      }
      if (!blob.size) {
        throw new Error("No audio received. Try again.");
      }
      const url = URL.createObjectURL(blob);
      narrateUrlRef.current = url;
      const audio = new Audio(url);
      narrateAudioRef.current = audio;
      audio.onended = () => {
        narratePlaybackCompletedRef.current = true;
        cleanupNarrate();
        setNarratingMomentId(null);
        setShowTapToPlay(false);
      };
      audio.onerror = () => {
        // Ignore error if playback already finished (some browsers fire error after we revoke the blob in cleanup)
        if (narratePlaybackCompletedRef.current) {
          cleanupNarrate();
          setNarratingMomentId(null);
          setShowTapToPlay(false);
          return;
        }
        cleanupNarrate();
        setNarratingMomentId(null);
        setShowTapToPlay(false);
        setNarrateError("Narration playback failed. Try again.");
      };
      // Wait for BGM so we have it when playback starts
      const bgmRes = await bgmPromise;
      const bgmUrl = bgmRes?.url && typeof bgmRes.url === "string" ? bgmRes.url.trim() : null;
      narratePendingBgmUrlRef.current = bgmUrl;
      // Try to start playback immediately (one-tap flow). If the browser blocks it, show "Tap to play".
      audio.play().then(() => {
        if (typeof window !== "undefined") console.log("[narrate] auto-play started");
        setShowTapToPlay(false);
        if (bgmUrl) {
          const bgm = new Audio(bgmUrl);
          narrateBgmRef.current = bgm;
          bgm.volume = 0.2;
          bgm.loop = true;
          bgm.onerror = () => {};
          bgm.play().catch(() => {});
        }
        narratePendingBgmUrlRef.current = null;
      }).catch((playErr) => {
        if (typeof window !== "undefined") console.log("[narrate] auto-play blocked, show Tap to play", playErr);
        setShowTapToPlay(true);
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setNarrateError("Narration request timed out. Try again.");
      } else {
        setNarrateError(err instanceof Error ? err.message : "Narration failed");
      }
      setNarratingMomentId(null);
      setShowTapToPlay(false);
      setNarrateVoiceUsed(null);
      if (typeof window !== "undefined") console.warn("[narrate] error", err);
    } finally {
      setNarrateLoading(false);
    }
  }

  /** Called when user taps "Tap to play narration" (fresh gesture so play() is allowed). */
  function handleTapToPlayNarrate() {
    const audio = narrateAudioRef.current;
    if (!audio) return;
    if (typeof window !== "undefined") console.log("[narrate] play() called (tap to play)");
    setShowTapToPlay(false);
    audio
      .play()
      .then(() => {
        if (typeof window !== "undefined") console.log("[narrate] play() resolved");
        const bgmUrl = narratePendingBgmUrlRef.current;
        if (bgmUrl) {
          const bgm = new Audio(bgmUrl);
          narrateBgmRef.current = bgm;
          bgm.volume = 0.2;
          bgm.loop = true;
          bgm.onerror = () => {};
          bgm.play().catch(() => {});
        }
        narratePendingBgmUrlRef.current = null;
      })
      .catch((playErr) => {
        if (typeof window !== "undefined") console.warn("[narrate] play() rejected", playErr);
        cleanupNarrate();
        setNarratingMomentId(null);
        setNarrateError(playErr?.message || "Playback was blocked. Tap Narrate again to listen.");
      });
  }

  function cleanupNarrate() {
    setShowTapToPlay(false);
    narratePendingBgmUrlRef.current = null;
    const url = narrateUrlRef.current;
    if (url) {
      URL.revokeObjectURL(url);
      narrateUrlRef.current = null;
    }
    const audio = narrateAudioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      narrateAudioRef.current = null;
    }
    const bgm = narrateBgmRef.current;
    if (bgm) {
      bgm.pause();
      bgm.src = "";
      narrateBgmRef.current = null;
    }
  }

  function stopNarrate() {
    narratePlaybackCompletedRef.current = false;
    cleanupNarrate();
    setNarratingMomentId(null);
    setNarrateLoading(false);
    setNarrateError(null);
    setNarrateVoiceUsed(null);
  }

  /** Start recording a voice reaction for the given moment. */
  async function startRecordReaction(momentId: string) {
    setRecordError(null);
    setRecordingBlob(null);
    recordingChunksRef.current = [];
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordError("Recording not supported in this browser. Use HTTPS or localhost.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      recordingStreamRef.current = stream;
      let recorder: MediaRecorder;
      try {
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const options: MediaRecorderOptions = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 };
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) recordingChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        const finalMime = recorder.mimeType || "audio/webm";
        if (chunks.length) {
          setRecordingBlob(new Blob([...chunks], { type: finalMime }));
        } else {
          setRecordError("No audio captured. Record for at least a second and try again.");
        }
        stream.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
      };
      recorder.onerror = () => {
        setRecordError("Recording failed");
        stream.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
      };
      recorder.start(250);
      setRecordingMomentId(momentId);
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : "Could not start microphone. Allow access when prompted.");
    }
  }

  function stopRecordReaction() {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === "recording") {
      rec.stop();
    } else if (rec.state === "paused") {
      rec.stop();
    }
  }

  async function submitRecordedReaction(momentId: string) {
    if (!recordingBlob || recordSending) return;
    setRecordError(null);
    setRecordSending(true);
    try {
      const type = "audio";
      const contentType = recordingBlob.type || "audio/webm";
      const ext = contentType.includes("opus") || contentType.includes("webm") ? "webm" : "ogg";
      const fileName = `reaction.${ext}`;
      const { uploadUrl, blobUrl } = await requestUploadUrl({ type, contentType, fileName });
      const isStub = uploadUrl.startsWith("https://local-mvp/") || uploadUrl.startsWith("http://local-mvp/");
      if (!isStub) {
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: recordingBlob,
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
        });
        if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      }
      const { assetId } = await completeUpload({
        blobUrl,
        type,
        metadata: { source: "voice_reaction", moment_id: momentId },
      });
      await apiPatch(`/moments/${momentId}`, { add_voice_comment_asset_id: assetId });
      setRecordingBlob(null);
      setRecordingMomentId(null);
      refetchSharedStories();
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : "Failed to upload reaction");
    } finally {
      setRecordSending(false);
    }
  }

  function cancelRecordedReaction() {
    setRecordingBlob(null);
    setRecordingMomentId(null);
    setRecordError(null);
  }

  return (
    <>
      <h1 className="page-title">Shared Memories</h1>
      <p className="page-lead">
        Moments shared with the family. Tap one to view and comment without leaving this page.
      </p>
      <p style={{ marginTop: 0, marginBottom: 16, fontSize: 14, color: "var(--ink-muted)" }}>
        A place for your whole family to revisit stories together — today and for future generations.
      </p>

      {/* Topic tabs: Voice Stories (default) | Photo Album | Videos (coming soon) | Add a Memory */}
      <nav
        role="tablist"
        aria-label="Shared Memories sections"
        className="bank-tabs"
      >
        <button
          type="button"
          role="tab"
          aria-selected={bankView === "voice"}
          className={bankView === "voice" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: 13 }}
          onClick={() => setBankView("voice")}
        >
          Voice Stories
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={bankView === "photos"}
          className={bankView === "photos" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: 13 }}
          onClick={() => setBankView("photos")}
        >
          Photo Album
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={bankView === "videos"}
          className={bankView === "videos" ? "btn btn-primary" : "btn btn-ghost"}
          style={{ fontSize: 13 }}
          onClick={() => setBankView("videos")}
        >
          Videos (coming soon)
        </button>
        <a
          href="/create/upload"
          className="btn btn-ghost"
          style={{ fontSize: 13, textDecoration: "none", color: "var(--primary)", marginLeft: "auto" }}
        >
          Add a Memory
        </a>
      </nav>

      {bankView === "voice" && (() => {
        const voiceIds = sharedStoryIdSet(sharedStories);
        const voiceFromMoments = !loading ? moments.filter((m) => m.source === "voice_story" || m.source === "older_session") : [];
        const voiceList: SharedStory[] = [...sharedStories];
        for (const m of voiceFromMoments) {
          if (!voiceIds.has(m.id)) {
            voiceList.push({
              id: m.id,
              title: m.title ?? null,
              summary: m.summary ?? null,
              reaction_log: m.reaction_log ?? null,
              participant_id: m.participant_id ?? null,
              participant_name: "Someone",
              created_at: m.created_at ?? "",
              has_audio: true,
            });
          }
        }
        if (voiceList.length === 0) {
          return (
            <div className="card empty-state" style={{ padding: "32px 24px" }}>
              <div className="icon">🎙️</div>
              <p style={{ margin: 0, fontSize: 1.1, color: "var(--ink-muted)" }}>
                No voice stories yet. Create and share stories from the voice companion, or add a memory.
              </p>
              <a href="/create/upload" className="btn btn-primary" style={{ marginTop: 20, display: "inline-block", textDecoration: "none", color: "white" }}>
                Add a memory
              </a>
            </div>
          );
        }
        return (
        <div className="card" style={{ marginBottom: 24, padding: 16 }}>
          {!normalizedParticipantId && voiceList.some((s) => s.participant_id) && (
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-muted)" }} role="status">
              Select who you are in the top bar to delete your own stories.
            </p>
          )}
          <h2 style={{ fontSize: "1rem", margin: "0 0 8px", fontWeight: 600 }}>Voice stories</h2>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-muted)" }}>
            Stories shared from voice sessions. View, listen, and add reactions without leaving this page.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {voiceList.map((s: SharedStory) => {
              const isExpanded = expandedVoiceId === s.id;
              const displayTitle = s.title?.trim() || (s.summary?.trim() ? s.summary.trim().slice(0, 60) + (s.summary.trim().length > 60 ? "…" : "") : null);
              const isRecording = recordingMomentId === s.id;
              const hasRecording = recordingBlob && recordingMomentId === s.id;
              const isNarrating = narratingMomentId === s.id;
              return (
                <li
                  key={s.id}
                  style={{
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{ flexShrink: 0, fontSize: 24, lineHeight: 1 }} aria-hidden>
                      🎙️
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{s.participant_name?.trim() || "Someone"}</span>
                        {" · "}
                        {formatSessionDateTime(s.created_at)}
                      </p>
                      {displayTitle && (
                        <p style={{ margin: "4px 0 0", fontSize: "0.95rem", fontWeight: 600, color: "var(--ink)" }}>
                          {displayTitle}
                        </p>
                      )}
                      <div className="bank-voice-actions-row">
                        <div className="bank-voice-primary-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedVoiceId(null);
                                setExpandedMode(null);
                                setEditingStoryId(null);
                                setEditingStoryText("");
                              } else {
                                setExpandedVoiceId(s.id);
                                setExpandedMode("view");
                                setInlineCommentText("");
                                setInlineCommentError(null);
                                setRecordError(null);
                                setNarrateError(null);
                                stopNarrate();
                              }
                            }}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? "Collapse" : "View Story"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              if (isNarrating) stopNarrate();
                              else narrateStory(s);
                            }}
                            disabled={narrateLoading}
                            aria-label="Narrate story with voice agent quality"
                          >
                            {narrateLoading && narratingMomentId === s.id ? "Preparing…" : isNarrating ? "⏹ Stop" : "Narrate Story"}
                          </button>
                          {/* Inline narrate status (no need to expand); show when this story is being narrated */}
                          {narratingMomentId === s.id && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              {narrateLoading && (
                                <span style={{ fontSize: 13, color: "var(--ink-muted)" }}>
                                  <span style={{ width: 16, height: 16, border: "2px solid var(--border)", borderTopColor: "var(--ink)", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block", verticalAlign: "middle", marginRight: 6 }} aria-hidden />
                                  Preparing…
                                </span>
                              )}
                              {showTapToPlay && !narrateLoading && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={handleTapToPlayNarrate}
                                    aria-label="Tap to play narration"
                                    style={{ fontSize: 13 }}
                                  >
                                    Tap to play
                                  </button>
                                  {narrateVoiceUsed === "cloned" && (
                                    <span style={{ fontSize: 12, color: "var(--success)" }}>Your voice</span>
                                  )}
                                  {narrateVoiceUsed === "default" && (
                                    <span style={{ fontSize: 12, color: "var(--ink-muted)" }}>Default voice (clone not used)</span>
                                  )}
                                </span>
                              )}
                              {narrateError && expandedVoiceId !== s.id && (
                                <span role="alert" style={{ fontSize: 12, color: "var(--error)" }}>{narrateError}</span>
                              )}
                            </span>
                          )}
                        </div>
                        <div className="bank-voice-secondary-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setExpandedVoiceId(s.id);
                              setExpandedMode("reaction");
                              setInlineCommentError(null);
                              setRecordError(null);
                              setNarrateError(null);
                            }}
                          >
                            Give Reaction
                          </button>
                          {normalizedParticipantId && (() => {
                            const isDeletable = sharedStoryIdSet(sharedStories).has(s.id);
                            if (!isDeletable) return false;
                            const matchById = s.participant_id && (s.participant_id.trim().toLowerCase() === normalizedParticipantId.toLowerCase());
                            const matchByName = !s.participant_id && currentUserLabel && (s.participant_name?.trim() || "").toLowerCase() === currentUserLabel.toLowerCase();
                            return matchById || matchByName;
                          })() && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => {
                                  setExpandedVoiceId(s.id);
                                  setExpandedMode("edit");
                                  setEditingStoryId(s.id);
                                  setEditingStoryText(s.summary?.trim() ?? "");
                                  setEditingStoryError(null);
                                }}
                                aria-label="Edit Story (author only)"
                              >
                                Edit Story
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ color: "var(--error)" }}
                                onClick={() => {
                                  setDeleteStoryId(s.id);
                                  setDeleteCode("");
                                  setDeleteError(null);
                                }}
                                aria-label="Delete this story (author only)"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {deleteStoryId === s.id && (
                        <div style={{ marginTop: 12, marginLeft: 36, padding: 12, background: "var(--bg)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink)" }}>
                            Enter your 4-digit recall code to delete this story.
                          </p>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                            <input
                              type="password"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              value={deleteCode}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                                setDeleteCode(v);
                                setDeleteError(null);
                              }}
                              placeholder="••••"
                              disabled={deleteSending}
                              style={{
                                width: 80,
                                padding: "8px 10px",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--border)",
                                fontFamily: "inherit",
                                fontSize: 16,
                                letterSpacing: 4,
                              }}
                              aria-label="Recall pass code (4 digits)"
                            />
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ fontSize: 13 }}
                              disabled={deleteSending || deleteCode.length !== 4}
                              onClick={async () => {
                                if (!normalizedParticipantId || deleteCode.length !== 4) return;
                                setDeleteSending(true);
                                setDeleteError(null);
                                try {
                                  await apiPost<{ deleted: boolean }>("/voice/stories/shared/delete", {
                                    moment_id: s.id,
                                    participant_id: normalizedParticipantId,
                                    code: deleteCode,
                                  });
                                  const deletedId = s.id;
                                  setDeleteSending(false);
                                  setDeleteStoryId(null);
                                  setDeleteCode("");
                                  setDeleteError(null);
                                  if (expandedVoiceId === deletedId) {
                                    setExpandedVoiceId(null);
                                    setExpandedMode(null);
                                  }
                                  if (playingMomentId === deletedId) setPlayingMomentId(null);
                                  if (selectedMomentId === deletedId) {
                                    setSelectedMomentId(null);
                                    setPanelMoment(null);
                                  }
                                  setSharedStories((prev) => prev.filter((x) => x.id !== deletedId));
                                  setMoments((prev) => prev.filter((m) => m.id !== deletedId));
                                  refetchSharedStories();
                                  apiGet<Moment[]>("/moments").then(setMoments).catch(() => {});
                                } catch (err) {
                                  const msg = err instanceof Error ? err.message : "Delete failed.";
                                  setDeleteError(msg.includes("Incorrect") ? "Incorrect pass code. Use the same 4-digit code you use to unlock your recall stories in Talk." : msg);
                                } finally {
                                  setDeleteSending(false);
                                }
                              }}
                            >
                              {deleteSending ? "Deleting…" : "Confirm delete"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: 13 }}
                              onClick={() => {
                                setDeleteStoryId(null);
                                setDeleteCode("");
                                setDeleteError(null);
                              }}
                              disabled={deleteSending}
                            >
                              Cancel
                            </button>
                          </div>
                          {deleteError && (
                            <p role="alert" style={{ color: "var(--error)", fontSize: 12, margin: "8px 0 0" }}>{deleteError}</p>
                          )}
                        </div>
                      )}
                      {playingMomentId === s.id && playingUrl && !isExpanded && (
                        <audio
                          data-moment-id={s.id}
                          src={playingUrl}
                          controls
                          style={{ maxWidth: 280, height: 32, marginTop: 8 }}
                          onEnded={() => {
                            setPlayingMomentId(null);
                            setPlayingUrl(null);
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div style={{ marginTop: 12, marginLeft: 36, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                      {expandedMode === "view" && (
                        <>
                          <section style={{ marginBottom: 16 }} aria-label="Story content">
                            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase" }}>Story</p>
                            {s.summary?.trim() ? (
                              <p style={{ margin: 0, fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
                                {s.summary.trim()}
                              </p>
                            ) : (
                              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>No story text.</p>
                            )}
                          </section>
                          {s.reaction_log?.trim() && (
                            <section style={{ marginBottom: 0 }} aria-label="Reactions">
                              <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase" }}>Reactions</p>
                              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)", whiteSpace: "pre-wrap" }}>
                                {s.reaction_log.trim()}
                              </p>
                            </section>
                          )}
                        </>
                      )}
                      {expandedMode === "reaction" && (
                        <section style={{ marginBottom: 0 }} aria-label="Reactions">
                          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase" }}>Reactions</p>
                          {s.reaction_log?.trim() ? (
                            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-muted)", whiteSpace: "pre-wrap" }}>
                              {s.reaction_log.trim()}
                            </p>
                          ) : (
                            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--ink-muted)" }}>No reactions yet. Add one below.</p>
                          )}
                          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase" }}>Add reaction</p>
                          <form onSubmit={handleInlineAddComment} style={{ display: "flex", flexDirection: "column", gap: 0, maxWidth: 400 }}>
                            <label htmlFor={`reaction-name-${s.id}`} style={{ marginBottom: 4, fontSize: 12, color: "var(--ink-muted)" }}>
                              Your name (so others know who reacted)
                            </label>
                            <input
                              id={`reaction-name-${s.id}`}
                              type="text"
                              value={reactionAuthorName}
                              onChange={(e) => {
                                const v = e.target.value;
                                setReactionAuthorName(v);
                                if (typeof window !== "undefined") window.localStorage.setItem("lifebook_reaction_name", v);
                              }}
                              placeholder="e.g. Sarah, Dad"
                              disabled={inlineCommentSending}
                              className="input"
                              style={{ width: "100%", marginBottom: 10 }}
                            />
                            <textarea
                              value={inlineCommentText}
                              onChange={(e) => setInlineCommentText(e.target.value)}
                              placeholder="Write your reaction…"
                              rows={3}
                              disabled={inlineCommentSending}
                              className="input"
                              style={{ width: "100%", resize: "vertical", marginBottom: 8 }}
                            />
                            <button type="submit" className="btn btn-primary" style={{ fontSize: 13, alignSelf: "flex-start" }} disabled={inlineCommentSending || !inlineCommentText.trim()}>
                              {inlineCommentSending ? "Sending…" : "Send reaction"}
                            </button>
                            {inlineCommentError && (
                              <p role="alert" style={{ color: "var(--error)", fontSize: 12, margin: "4px 0 0" }}>{inlineCommentError}</p>
                            )}
                          </form>
                        </section>
                      )}
                      {expandedMode === "edit" && editingStoryId === s.id && (
                        <section style={{ marginBottom: 0 }} aria-label="Edit story">
                          <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase" }}>Story</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <textarea
                              value={editingStoryText}
                              onChange={(e) => setEditingStoryText(e.target.value)}
                              rows={6}
                              className="input"
                              style={{ width: "100%", resize: "vertical" }}
                              disabled={editingStorySaving}
                              aria-label="Story text"
                            />
                            {editingStoryError && (
                              <p role="alert" style={{ color: "var(--error)", fontSize: 12, margin: 0 }}>{editingStoryError}</p>
                            )}
                            <div className="action-row">
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={editingStorySaving}
                                onClick={async () => {
                                  setEditingStoryError(null);
                                  setEditingStorySaving(true);
                                  try {
                                    await apiPatch(`/moments/${s.id}`, { summary: editingStoryText.trim() || null });
                                    setEditingStoryId(null);
                                    setEditingStoryText("");
                                    setSharedStories((prev) =>
                                      prev.map((x) => (x.id === s.id ? { ...x, summary: editingStoryText.trim() || null } : x))
                                    );
                                    setMoments((prev) =>
                                      prev.map((m) => (m.id === s.id ? { ...m, summary: editingStoryText.trim() || null } : m))
                                    );
                                    refetchSharedStories();
                                    setExpandedMode("view");
                                  } catch (err) {
                                    setEditingStoryError(err instanceof Error ? err.message : "Failed to update story");
                                  } finally {
                                    setEditingStorySaving(false);
                                  }
                                }}
                              >
                                {editingStorySaving ? "Saving…" : "Save"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                disabled={editingStorySaving}
                                onClick={() => {
                                  setEditingStoryId(null);
                                  setEditingStoryText("");
                                  setEditingStoryError(null);
                                  setExpandedMode("view");
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </section>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        );
      })()}

      {loading && (
        <p style={{ color: "var(--ink-muted)" }}>Loading…</p>
      )}
      {error && (
        <div role="alert" className="card" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
          <p style={{ margin: 0 }}>{error}</p>
          <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.9 }}>
            Check browser console (F12) for full API response details.
          </p>
        </div>
      )}
      {!loading && !error && bankView === "voice" && moments.length === 0 && (
        <div className="card empty-state">
          <div className="icon">📚</div>
          <p style={{ margin: 0, fontSize: 1.1 }}>
            No voice stories yet. Share a story from the voice companion or add a memory.
          </p>
          <a
            href="/create/upload"
            className="btn btn-primary"
            style={{ marginTop: 20, display: "inline-block", textDecoration: "none", color: "white" }}
          >
            Add a memory
          </a>
        </div>
      )}
      {bankView === "videos" && (
        <div className="card empty-state" style={{ padding: "48px 24px" }}>
          <div className="icon" style={{ fontSize: "2.5rem" }}>🎬</div>
          <p style={{ margin: 0, fontSize: 1.1, color: "var(--ink-muted)" }}>
            Videos are coming soon. You’ll be able to watch and react to family videos here.
          </p>
        </div>
      )}
      {!loading && !error && bankView === "photos" && (() => {
        const voiceIds = sharedStoryIdSet(sharedStories);
        const isVoiceMoment = (m: Moment) => m.source === "voice_story" || m.source === "older_session";
        const photoMoments = moments.filter((m) => !isVoiceMoment(m) && !voiceIds.has(m.id));
        if (photoMoments.length === 0) {
          return (
            <div className="card empty-state">
              <div className="icon">📷</div>
              <p style={{ margin: 0, fontSize: 1.1, color: "var(--ink-muted)" }}>
                No photos in the album yet. Add a memory to get started.
              </p>
              <a
                href="/create/upload"
                className="btn btn-primary"
                style={{ marginTop: 20, display: "inline-block", textDecoration: "none", color: "white" }}
              >
                Add a memory
              </a>
            </div>
          );
        }
        return (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 16,
          }}
        >
          {photoMoments.map((m) => {
            const thumbUrl = m.thumbnail_url || m.image_url;
            const showThumb = thumbUrl && !isStubMediaUrl(thumbUrl);
            return (
              <li key={m.id ?? String(Math.random())}>
                <button
                  type="button"
                  onClick={() => setSelectedMomentId(m.id)}
                  className="card"
                  style={{
                    textAlign: "left",
                    width: "100%",
                    textDecoration: "none",
                    color: "var(--ink)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    padding: 0,
                    minHeight: 200,
                    border: "none",
                    cursor: "pointer",
                    font: "inherit",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "4/3",
                      backgroundColor: "var(--border)",
                      position: "relative",
                      flexShrink: 0,
                    }}
                  >
                    {showThumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hide");
                        }}
                      />
                    ) : null}
                    <div
                      className={showThumb ? "hide" : ""}
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--ink-faint)",
                        fontSize: 40,
                      }}
                      aria-hidden
                    >
                      📷
                    </div>
                  </div>
                  <div style={{ padding: "10px 12px", flex: 1, minHeight: 0 }}>
                    <h2
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: "0.95rem",
                        margin: "0 0 4px",
                        fontWeight: 600,
                        color: "var(--ink)",
                        lineHeight: 1.3,
                      }}
                    >
                      {m.title?.trim() || "Untitled"}
                    </h2>
                    {m.summary?.trim() ? (
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12,
                          color: "var(--ink-muted)",
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {m.summary}
                      </p>
                    ) : null}
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
                      {formatDate(m.created_at)}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        );
      })()}

      <p style={{ marginTop: 32 }}>
        <a href="/create/upload">Add a memory</a> · <a href="/">Home</a>
      </p>

      {selectedMomentId && (
        <MomentDetailPanel
          momentId={selectedMomentId}
          moment={panelMoment}
          loading={panelLoading}
          error={panelError}
          onClose={() => setSelectedMomentId(null)}
          onCommentAdded={() => selectedMomentId && fetchPanelMoment(selectedMomentId)}
          isStubMediaUrl={isStubMediaUrl}
        />
      )}
    </>
  );
}

type MomentDetailPanelProps = {
  momentId: string;
  moment: MomentDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onCommentAdded: () => void;
  isStubMediaUrl: (url: string | null | undefined) => boolean;
};

function MomentDetailPanel({
  momentId,
  moment,
  loading,
  error,
  onClose,
  onCommentAdded,
  isStubMediaUrl,
}: MomentDetailPanelProps) {
  const [commentText, setCommentText] = useState("");
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || sending) return;
    setCommentError(null);
    setSending(true);
    try {
      await apiPatch(`/moments/${momentId}`, { add_comment: trimmed });
      setCommentText("");
      onCommentAdded();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="moment-panel-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        overflow: "auto",
        background: "rgba(0,0,0,0.4)",
        padding: "1rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="card"
        style={{
          maxWidth: 640,
          width: "100%",
          margin: "0 auto 2rem",
          padding: 0,
          overflow: "hidden",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 id="moment-panel-title" style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>Moment</h2>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            style={{ padding: "8px 12px" }}
          >
            Back
          </button>
        </div>
        <div style={{ maxHeight: "calc(100vh - 120px)", overflow: "auto" }}>
          {loading && (
            <p style={{ padding: 24, color: "var(--ink-muted)" }}>Loading…</p>
          )}
          {error && (
            <div role="alert" style={{ padding: 24, color: "var(--error)" }}>
              <p style={{ margin: 0 }}>{error}</p>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 12 }} onClick={onClose}>
                Close
              </button>
            </div>
          )}
          {!loading && !error && moment && (
            <>
              <div
                style={{
                  width: "100%",
                  aspectRatio: "4/3",
                  backgroundColor: "var(--border)",
                  position: "relative",
                }}
              >
                {(moment.image_url || moment.thumbnail_url) && !isStubMediaUrl(moment.image_url || moment.thumbnail_url) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={moment.image_url || moment.thumbnail_url!}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--ink-faint)",
                      fontSize: 64,
                    }}
                    aria-hidden
                  >
                    🎙️
                  </div>
                )}
              </div>
              <div style={{ padding: "1rem 1.25rem" }}>
                <h3 style={{ margin: "0 0 8px", fontSize: "1.1rem", fontWeight: 600 }}>
                  {moment.title?.trim() || "Untitled"}
                </h3>
                {(moment.created_at || moment.source) && (
                  <p style={{ fontSize: 14, color: "var(--ink-faint)", margin: "0 0 1rem" }}>
                    {moment.created_at && !Number.isNaN(new Date(moment.created_at).getTime()) &&
                      new Date(moment.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}
                    {moment.source && ` · ${moment.source.replace(/_/g, " ")}`}
                  </p>
                )}
                {moment.summary && (
                  <p style={{ margin: 0, color: "var(--ink-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {moment.summary}
                  </p>
                )}
                {moment.assets && moment.assets.some((a) => a.playback_url && (a.type === "audio" || a.role === "session_audio")) && (
                  <div style={{ marginTop: "1rem" }}>
                    {moment.assets
                      .filter((a) => a.playback_url && (a.type === "audio" || a.role === "session_audio"))
                      .map((a) => (
                        <div key={a.id} style={{ marginBottom: 12 }}>
                          <audio
                            controls
                            src={a.playback_url!}
                            style={{ width: "100%", maxWidth: 400 }}
                            preload="metadata"
                          >
                            Your browser does not support audio playback.
                          </audio>
                          {a.duration_sec != null && a.duration_sec > 0 && (
                            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>
                              {Math.round(a.duration_sec)}s
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                )}
              </div>
              <section className="card" style={{ margin: "0 1.25rem 1rem", padding: 16 }}>
                <h4 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 8px" }}>Add a comment</h4>
                <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
                  Add a note or memory about this moment — you can type here or add voice later.
                </p>
                <form onSubmit={handleAddComment}>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Type a comment…"
                    rows={3}
                    disabled={sending}
                    style={{
                      width: "100%",
                      padding: 12,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                      fontFamily: "inherit",
                      fontSize: 14,
                      resize: "vertical",
                      marginBottom: 8,
                    }}
                  />
                  {commentError && (
                    <p role="alert" style={{ color: "var(--error)", fontSize: 14, margin: "0 0 8px" }}>
                      {commentError}
                    </p>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={sending || !commentText.trim()}>
                    {sending ? "Adding…" : "Add comment"}
                  </button>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
