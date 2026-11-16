"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiGetBlobWithMeta, apiDelete, apiPatch, apiPost } from "@/lib/api";
import { requestUploadUrl, completeUpload } from "@/lib/media";
import ShareSheet from "@/app/components/ShareSheet";
import StageShell, { type StageMark, type StageStep, type StudioStage } from "@/app/components/StageShell";
import VoiceDock from "@/app/components/VoiceDock";
import { useRealtimeSession } from "@/lib/useRealtimeSession";

type StoryDetail = {
  id: string;
  kind: "story";
  title: string | null;
  summary: string | null;
  story_text: string | null;
  tags: string[];
  created_at: string;
  source_conversation_id: string | null;
  audio_url: string | null;
  bgm_track: string | null;
  narration_tone: string | null;
  photo_url: string | null;
  photo_asset_id: string | null;
  bgm_url?: string | null;
  has_unique_bgm?: boolean;
  voice_enrolled?: boolean;
  voice_label?: string | null;
  voice_hint?: string | null;
  voice_setup_path?: string;
};

type Comment = {
  id: string;
  share_id: string;
  recipient_name: string;
  text: string;
  created_at: string;
};

type PrivatePreview = {
  kind: "story";
  id: string;
  title: string | null;
  summary: string | null;
  body_text: string | null;
  narration_url: string;
  bgm_track: string;
  narration_tone: string | null;
  photo_url: string | null;
  bgm_url?: string | null;
  voice_enrolled?: boolean;
  voice_label?: string | null;
  voice_hint?: string | null;
};

type CurateSuggest = {
  bgm_track: string;
  narration_tone: string;
  reason: string;
  status_line: string;
  applied: boolean;
  music_source: "library" | "generated" | "generating" | "none";
  bgm_url: string | null;
  generative_available: boolean;
  voice_enrolled: boolean;
  voice_label: string | null;
  voice_hint: string | null;
  voice_setup_path: string;
};

type ConversationBrief = {
  turns: { role: string; content: string }[];
  transcript: string | null;
};

type ConversationDetail = {
  id: string;
  kind: "conversation";
  title: string | null;
  summary: string | null;
  tags: string[];
  created_at: string;
  turns: { role: string; content: string }[];
  transcript: string | null;
  audio_url: string | null;
  script_id: string | null;
};

const STAGE_ORDER: StudioStage[] = ["conversation", "script", "curate", "share"];

function parseStage(raw: string | null, fallback: StudioStage): StudioStage {
  const v = (raw || "").toLowerCase();
  if (v === "conversation" || v === "script" || v === "curate" || v === "share") return v;
  return fallback;
}

function writeStageQuery(stage: StudioStage) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("stage", stage);
  const next = `${url.pathname}?${url.searchParams.toString()}`;
  window.history.replaceState(window.history.state, "", next);
}

const BGM_OPTIONS: { id: string; label: string }[] = [
  { id: "none", label: "None" },
  { id: "neutral", label: "Calm" },
  { id: "warm", label: "Warm" },
  { id: "reflective", label: "Reflective" },
  { id: "nostalgic", label: "Nostalgic" },
];

const TONE_OPTIONS: { id: string; label: string }[] = [
  { id: "warm", label: "Warm" },
  { id: "gentle", label: "Soft" },
  { id: "clear", label: "Clear" },
  { id: "lively", label: "Lively" },
];

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Bed under voice — assets are ~-18 LUFS; this keeps music present without drowning speech. */
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
  // Cache-bust when assets are regenerated so Curate mood changes stay fresh
  return `/bgm/${id}.mp3?v=3`;
}

function resolveBgmSrc(track: string | undefined | null, customUrl?: string | null): string | undefined {
  const custom = (customUrl || "").trim();
  if (custom) return custom;
  return bgmPublicSrc(track || undefined);
}

function bgmLabel(track: string | undefined): string {
  const id = normalizeBgmTrack(track);
  return BGM_OPTIONS.find((o) => o.id === id)?.label ?? "Calm";
}

function toneLabel(tone: string | undefined): string {
  const id = (tone || "warm").trim().toLowerCase();
  return TONE_OPTIONS.find((o) => o.id === id)?.label ?? "Warm";
}

function waitForAudioReady(audio: HTMLAudioElement, timeoutMs = 20000): Promise<void> {
  if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("canplay", onMeta);
      audio.removeEventListener("error", onErr);
      fn();
    };
    const onMeta = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) finish(resolve);
    };
    const onErr = () => finish(() => reject(new Error("Couldn't load audio.")));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("Audio took too long to load."))),
      timeoutMs
    );
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("canplay", onMeta);
    audio.addEventListener("error", onErr);
    try {
      audio.load();
    } catch {
      /* load() can throw if element is detached; wait for events anyway */
    }
    onMeta();
  });
}

export default function StudioScreen({ routeKind }: { routeKind: "conversation" | "story" }) {
  const params = useParams<{ id: string }>();
  const routeId = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [stage, setStage] = useState<StudioStage>(() =>
    parseStage(searchParams.get("stage"), routeKind === "conversation" ? "conversation" : "script")
  );
  const [storyId, setStoryId] = useState<string | null>(routeKind === "story" ? routeId : null);
  const [conversationId, setConversationId] = useState<string | null>(
    routeKind === "conversation" ? routeId : null
  );
  const id = storyId || "";

  const [data, setData] = useState<StoryDetail | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [storyError, setStoryError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [savingScript, setSavingScript] = useState(false);
  const [scriptSaved, setScriptSaved] = useState(false);
  const [bgmTrack, setBgmTrack] = useState("neutral");
  const [narrationTone, setNarrationTone] = useState("warm");
  const [bgmUrl, setBgmUrl] = useState<string | null>(null);
  const [curateReason, setCurateReason] = useState<string | null>(null);
  const [curateStatusLine, setCurateStatusLine] = useState<string | null>(null);
  const [musicSource, setMusicSource] = useState<CurateSuggest["music_source"] | null>(null);
  const [voiceEnrolled, setVoiceEnrolled] = useState(false);
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [autoCurating, setAutoCurating] = useState(false);
  const [savingCurate, setSavingCurate] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [shareCount, setShareCount] = useState(0);
  const [heardOnce, setHeardOnce] = useState(false);
  const [curateContinued, setCurateContinued] = useState(false);
  const [confirmDeleteConversation, setConfirmDeleteConversation] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const onShareCount = useCallback((count: number) => setShareCount(count), []);
  const [preview, setPreview] = useState<PrivatePreview | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTurns, setCompareTurns] = useState<ConversationBrief | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const narrationRef = useRef<HTMLAudioElement | null>(null);
  const bgmRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const hearGenRef = useRef(0);
  const playWhenReadyRef = useRef(false);
  /** True while Curator/Storyteller talk is connecting or live — blocks Listen dual-audio */
  const talkActiveRef = useRef(false);
  const deriveRef = useRef<() => Promise<void>>(async () => {});
  const advanceAfterSaveRef = useRef(false);
  const advanceFromQueryRef = useRef(false);
  const autoCurateKeyRef = useRef<string | null>(null);
  /**
   * When true, narration pause/end should also pause BGM.
   * Must be false while we clear/reload narration during Listen prepare — otherwise
   * narration.onPause permanently kills music that was started in the user gesture.
   */
  const syncBgmToNarrationRef = useRef(false);

  const revokeAudioUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const clearPlayback = useCallback((opts?: { keepBgm?: boolean }) => {
    hearGenRef.current += 1;
    playWhenReadyRef.current = false;
    syncBgmToNarrationRef.current = false;
    const n = narrationRef.current;
    if (n) {
      n.pause();
      n.removeAttribute("src");
      n.load();
    }
    if (!opts?.keepBgm) {
      const b = bgmRef.current;
      if (b) {
        b.pause();
        try {
          b.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
    }
    setPlaying(false);
    setAudioReady(false);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    setPreview(null);
    setAudioSrc(null);
    revokeAudioUrl();
  }, [revokeAudioUrl]);

  useEffect(() => () => revokeAudioUrl(), [revokeAudioUrl]);

  const applyStory = (s: StoryDetail) => {
    setData(s);
    setDraftText(s.story_text || "");
    setDraftTitle(s.title || "");
    setBgmTrack(normalizeBgmTrack(s.bgm_track));
    setNarrationTone(s.narration_tone || "warm");
    setBgmUrl(s.bgm_url || null);
    if (typeof s.voice_enrolled === "boolean") setVoiceEnrolled(s.voice_enrolled);
    if (s.voice_label) setVoiceLabel(s.voice_label);
    if (s.voice_hint !== undefined) setVoiceHint(s.voice_hint || null);
    setScriptSaved(true);
    if (s.source_conversation_id) {
      setConversationId((prev) => prev || s.source_conversation_id);
    }
  };

  const load = useCallback(() => {
    if (!id) return;
    apiGet<StoryDetail>(`/library/stories/${encodeURIComponent(id)}`)
      .then((story) => {
        setStoryError(null);
        applyStory(story);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Could not load this script.";
        if (routeKind === "story") setError(msg);
        else setStoryError(msg);
      });
    apiGet<Comment[]>(`/library/stories/${encodeURIComponent(id)}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [id, routeKind]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    apiGet<ConversationDetail>(`/library/conversations/${encodeURIComponent(conversationId)}`)
      .then((c) => {
        if (cancelled) return;
        setConversation(c);
        if (c.script_id) setStoryId((prev) => prev || c.script_id);
      })
      .catch((e) => {
        if (cancelled) return;
        if (routeKind === "conversation") {
          setError(e instanceof Error ? e.message : "Could not load this conversation.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, routeKind]);

  const primaryMissing =
    routeKind === "conversation" ? !conversation && !error : !data && !error;

  useEffect(() => {
    if (primaryMissing || error) return;
    const scriptReady = Boolean(storyId);
    const talkReady = Boolean(conversationId);
    if ((stage === "script" || stage === "curate" || stage === "share") && !scriptReady && talkReady) {
      setStage("conversation");
      writeStageQuery("conversation");
      return;
    }
    if (stage === "conversation" && !talkReady && scriptReady) {
      setStage("script");
      writeStageQuery("script");
    }
  }, [primaryMissing, error, stage, storyId, conversationId]);

  useEffect(() => {
    if (stage !== "curate") {
      // Allow a fresh auto-suggest the next time Curate is entered
      autoCurateKeyRef.current = null;
      setAutoCurating(false);
    }
  }, [stage]);

  /** Auto-curate when entering Curate with unset music/tone (or refresh status). */
  useEffect(() => {
    if (stage !== "curate" || !id || !data) return;
    const key = `${id}:curate`;
    // Already completed successfully for this story — don't re-fetch / re-busy Listen
    if (autoCurateKeyRef.current === key) return;

    let cancelled = false;
    setAutoCurating(true);
    const run = async () => {
      try {
        const res = await apiPost<CurateSuggest>(
          `/library/stories/${encodeURIComponent(id)}/curate/suggest`,
          { force: false, try_generate: true }
        );
        if (cancelled) return;
        autoCurateKeyRef.current = key;
        setBgmTrack(normalizeBgmTrack(res.bgm_track));
        setNarrationTone(res.narration_tone || "warm");
        setBgmUrl(res.bgm_url || null);
        setCurateReason(res.reason);
        setCurateStatusLine(res.status_line);
        setMusicSource(res.music_source);
        setVoiceEnrolled(Boolean(res.voice_enrolled));
        setVoiceLabel(res.voice_label);
        setVoiceHint(res.voice_hint);
        setStatusNote(res.status_line);
      } catch {
        if (!cancelled) {
          setCurateStatusLine(null);
          setStatusNote("Curator couldn’t auto-set music yet — Talk with Curator, then Listen.");
        }
      } finally {
        // Always clear busy flag for this attempt (Strict Mode may cancel mid-flight)
        if (!cancelled) setAutoCurating(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
      // Critical: React Strict Mode remounts cancel the in-flight suggest.
      // Without clearing busy here, Listen stays stuck on "Preparing…".
      setAutoCurating(false);
    };
  }, [stage, id, data]);

  /** Poll for unique generative bed while composing. */
  useEffect(() => {
    if (stage !== "curate" || musicSource !== "generating" || !id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await apiGet<StoryDetail>(`/library/stories/${encodeURIComponent(id)}`);
        if (cancelled) return;
        if (s.bgm_url) {
          setBgmUrl(s.bgm_url);
          setMusicSource("generated");
          setBgmTrack(normalizeBgmTrack(s.bgm_track));
          setNarrationTone(s.narration_tone || "warm");
          if (typeof s.voice_enrolled === "boolean") setVoiceEnrolled(s.voice_enrolled);
          if (s.voice_label) setVoiceLabel(s.voice_label);
          setCurateStatusLine(
            `Curator set: unique bed (${bgmLabel(s.bgm_track || undefined)}) · ${toneLabel(
              s.narration_tone || undefined
            )} — tap Listen to hear`
          );
          setStatusNote(
            `Curator set: unique bed (${bgmLabel(s.bgm_track || undefined)}) · ${toneLabel(
              s.narration_tone || undefined
            )} — tap Listen to hear`
          );
        }
      } catch {
        /* ignore */
      }
    };
    const t = window.setInterval(() => void tick(), 8000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [stage, musicSource, id]);

  const scriptDirty =
    Boolean(data) &&
    (draftText.trim() !== (data?.story_text || "").trim() ||
      draftTitle.trim() !== (data?.title || "").trim());

  const saveScript = async (opts?: { quiet?: boolean; keepBgm?: boolean }): Promise<boolean> => {
    if (!draftText.trim()) {
      setError("Script text cannot be empty.");
      return false;
    }
    if (!scriptDirty) {
      setScriptSaved(true);
      if (!opts?.quiet) {
        setStatusNote("Already saved. Hear it if you want, or continue to Curate. This screen stays here.");
      }
      return true;
    }
    setSavingScript(true);
    setError(null);
    if (!opts?.quiet) setStatusNote(null);
    setScriptSaved(false);
    try {
      const updated = await apiPatch<StoryDetail>(`/library/stories/${encodeURIComponent(id)}`, {
        story_text: draftText.trim(),
        title: draftTitle.trim() || undefined,
      });
      applyStory(updated);
      setScriptSaved(true);
      clearPlayback({ keepBgm: Boolean(opts?.keepBgm) });
      if (!opts?.quiet) {
        setStatusNote(
          "Saved. Hear it if you want — that can take a few minutes. Continue to Curate only when you tap it."
        );
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save script.");
      return false;
    } finally {
      setSavingScript(false);
    }
  };

  const saveCurate = async (patch: {
    bgm_track?: string;
    narration_tone?: string;
    photo_asset_id?: string;
    clear_photo?: boolean;
    reason?: string;
  }) => {
    setSavingCurate(true);
    setError(null);
    try {
      const { reason, ...body } = patch;
      const updated = await apiPatch<StoryDetail>(`/library/stories/${encodeURIComponent(id)}`, body);
      applyStory(updated);
      clearPlayback();
      if (patch.bgm_track) setBgmUrl(null); // library mood replaces unique bed
      const mood = patch.bgm_track ? bgmLabel(patch.bgm_track) : bgmLabel(updated.bgm_track || undefined);
      const tone = patch.narration_tone
        ? toneLabel(patch.narration_tone)
        : toneLabel(updated.narration_tone || undefined);
      const line =
        normalizeBgmTrack(updated.bgm_track) === "none"
          ? `Curator set: voice only · ${tone} — tap Listen to hear`
          : `Curator set: ${mood} · ${tone} — tap Listen to hear`;
      setCurateStatusLine(line);
      if (reason) setCurateReason(reason);
      else if (patch.bgm_track || patch.narration_tone) {
        setCurateReason("Updated from your conversation with Curator.");
      }
      if (talkActiveRef.current) {
        setStatusNote(`${line.replace("tap Listen to hear", "Listen after you end talk")}`);
      } else {
        setStatusNote(line);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save curate choices.");
    } finally {
      setSavingCurate(false);
    }
  };

  const onPhotoSelected = async (file: File | null) => {
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      const sas = await requestUploadUrl({
        type: "photo",
        contentType: file.type || "image/jpeg",
        fileName: file.name || `story-photo-${Date.now()}.jpg`,
      });
      if ((sas.uploadUrl || "").includes("local-mvp")) {
        throw new Error(
          "Photo upload isn’t configured on this server yet (Azure Storage). You can still Listen and share without a photo."
        );
      }
      const put = await fetch(sas.uploadUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": file.type || "image/jpeg",
        },
        body: file,
      });
      if (!put.ok) {
        throw new Error("Could not upload the photo. Check your connection and try again.");
      }
      const done = await completeUpload({
        blobUrl: sas.blobUrl,
        type: "photo",
        metadata: { source: "story-curate" },
      });
      await saveCurate({ photo_asset_id: done.assetId });
      setStatusNote("Photo saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setUploadingPhoto(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startBgm = useCallback(
    (fromStart: boolean, track?: string | null, customUrl?: string | null) => {
      const b = bgmRef.current;
      if (!b) return;
      const id = normalizeBgmTrack(track || bgmTrack);
      const src = resolveBgmSrc(id, customUrl !== undefined ? customUrl : bgmUrl);
      if (!src || id === "none") {
        b.pause();
        return;
      }
      const attr = b.getAttribute("src") || "";
      const absolute = typeof window !== "undefined" ? new URL(src, window.location.origin).href : src;
      if (attr !== src && b.src !== absolute && b.src !== src) {
        b.src = src;
        try {
          b.load();
        } catch {
          /* ignore */
        }
      }
      b.muted = false;
      b.volume = BGM_VOLUME;
      b.loop = true;
      if (fromStart) {
        try {
          b.currentTime = 0;
        } catch {
          /* ignore */
        }
      }
      void b.play().catch(() => {
        window.setTimeout(() => {
          void b.play().catch(() => {});
        }, 50);
      });
    },
    [bgmTrack, bgmUrl]
  );

  const pausePlayback = useCallback(() => {
    syncBgmToNarrationRef.current = false;
    narrationRef.current?.pause();
    bgmRef.current?.pause();
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(
    async (fromStart = true): Promise<boolean> => {
      const n = narrationRef.current;
      if (!n || !n.src) {
        setPreviewError("Couldn't play — try again.");
        setPlaying(false);
        return false;
      }
      try {
        if (n.readyState < 1 || !Number.isFinite(n.duration) || n.duration <= 0) {
          await waitForAudioReady(n);
        }
        const duration = n.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("Audio has no duration.");
        }
        setPlaybackDuration(duration);
        setAudioReady(true);
        if (fromStart || n.ended) n.currentTime = 0;
        // Script review is the voice reading the words. Music starts on Finish.
        if (stage === "script") {
          syncBgmToNarrationRef.current = false;
          const bed = bgmRef.current;
          if (bed) {
            bed.pause();
            bed.muted = true;
          }
        } else {
          startBgm(fromStart || n.currentTime < 0.05, preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl);
          syncBgmToNarrationRef.current = true;
        }
        await n.play();
        setPlaying(true);
        setPreviewError(null);
        setStatusNote(null);
        return true;
      } catch {
        syncBgmToNarrationRef.current = false;
        bgmRef.current?.pause();
        setPlaying(false);
        setPreviewError("Couldn't play — try again.");
        return false;
      }
    },
    [bgmTrack, bgmUrl, preview?.bgm_track, preview?.bgm_url, stage, startBgm]
  );

  /** After blob URL is set on state, wire <audio>, wait for metadata, then play. */
  useEffect(() => {
    if (!audioSrc) return;
    const gen = hearGenRef.current;
    const n = narrationRef.current;
    if (!n) return;

    let cancelled = false;
    const run = async () => {
      try {
        if (n.src !== audioSrc) {
          n.src = audioSrc;
        }
        await waitForAudioReady(n);
        if (cancelled || gen !== hearGenRef.current) return;
        const duration = n.duration;
        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error("Audio has no duration.");
        }
        setPlaybackDuration(duration);
        setAudioReady(true);
        setPreviewLoading(false);
        if (playWhenReadyRef.current) {
          playWhenReadyRef.current = false;
          if (stage === "script") {
            syncBgmToNarrationRef.current = false;
            const bed = bgmRef.current;
            if (bed) {
              bed.pause();
              bed.muted = true;
            }
          } else {
            // BGM should already be running from Listen click (user gesture). Re-assert play.
            startBgm(false, preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl);
            syncBgmToNarrationRef.current = true;
          }
          n.currentTime = 0;
          await n.play();
          if (cancelled || gen !== hearGenRef.current) return;
          setPlaying(true);
          setPreviewError(null);
        }
      } catch (e) {
        if (cancelled || gen !== hearGenRef.current) return;
        playWhenReadyRef.current = false;
        syncBgmToNarrationRef.current = false;
        bgmRef.current?.pause();
        setPlaying(false);
        setAudioReady(false);
        setPreviewLoading(false);
        setPreviewError(e instanceof Error ? e.message : "Couldn't play — try again.");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [audioSrc, bgmTrack, bgmUrl, preview?.bgm_track, preview?.bgm_url, stage, startBgm]);

  /** Prepare preview metadata + fetch MP3 as blob (credentials), then play via effect. */
  const loadPreview = async (autoPlay = true) => {
    setPreviewError(null);

    // Save first if needed. keepBgm: Listen already started music in the user gesture.
    if (scriptDirty) {
      const ok = await saveScript({ quiet: true, keepBgm: autoPlay });
      if (!ok) return;
    }

    const moodName = bgmLabel(bgmTrack);
    const toneName = toneLabel(narrationTone);
    const moodBit =
      normalizeBgmTrack(bgmTrack) === "none" ? "voice only (no music)" : `${moodName} music`;
    setStatusNote(
      stage === "script"
        ? "Preparing the voice that reads your script. Music waits until Finish."
        : `Preparing with ${moodBit} · ${toneName} tone…`
    );

    const gen = ++hearGenRef.current;
    playWhenReadyRef.current = autoPlay;
    setPreviewLoading(true);
    setAudioReady(false);
    setPlaying(false);
    setPlaybackTime(0);
    setPlaybackDuration(0);
    setAudioSrc(null);
    revokeAudioUrl();
    // Do NOT pause BGM here when autoplaying — it was started in the Listen click
    // (user gesture). Pausing would require a new gesture to restart under autoplay policy.
    if (!autoPlay) {
      bgmRef.current?.pause();
    }
    // Clearing narration src fires onPause — keep sync off so that does not kill BGM.
    syncBgmToNarrationRef.current = false;
    const n0 = narrationRef.current;
    if (n0) {
      n0.pause();
      n0.removeAttribute("src");
      n0.load();
    }

    try {
      const p = await apiGet<PrivatePreview>(`/library/stories/${encodeURIComponent(id)}/preview`);
      if (gen !== hearGenRef.current) return;

      // Bust any intermediary caches when tone or script changes
      const toneQ = encodeURIComponent((p.narration_tone || narrationTone || "warm").trim().toLowerCase());
      const basePath = p.narration_url.startsWith("/") ? p.narration_url : `/${p.narration_url}`;
      const path = `${basePath}${basePath.includes("?") ? "&" : "?"}tone=${toneQ}&t=${Date.now()}`;
      const { blob, headers } = await apiGetBlobWithMeta(path);
      if (gen !== hearGenRef.current) return;

      const voiceMode = (headers.get("X-Narration-Voice") || "").toLowerCase();
      const voiceNote = headers.get("X-Narration-Note");
      if (voiceMode === "cloned") {
        setVoiceEnrolled(true);
        setVoiceLabel("Narration: your voice");
        setVoiceHint(null);
      } else if (voiceNote) {
        setVoiceLabel(
          voiceMode === "default_fallback"
            ? "Narration: default voice (your voice unavailable)"
            : "Narration: default voice"
        );
        setVoiceHint(voiceNote);
        setStatusNote(voiceNote);
      } else if (typeof p.voice_enrolled === "boolean") {
        setVoiceEnrolled(p.voice_enrolled);
        if (p.voice_label) setVoiceLabel(p.voice_label);
        if (p.voice_hint) setVoiceHint(p.voice_hint);
      }

      if (p.bgm_url) setBgmUrl(p.bgm_url);

      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setPreview(p);
      setAudioSrc(objectUrl);
      const readyMood =
        stage === "script"
          ? "voice only"
          : normalizeBgmTrack(p.bgm_track) === "none"
            ? "voice only"
            : p.bgm_url
              ? `unique music under ${toneLabel(p.narration_tone || undefined)} voice`
              : `${bgmLabel(p.bgm_track)} under ${toneLabel(p.narration_tone || undefined)} voice`;
      if (!voiceNote) {
        setStatusNote(
          stage === "script"
            ? "Ready. This is your voice only. Share it with your family when it sounds like you."
            : `Ready — ${readyMood}.`
        );
      }
      // metadata + play handled in audioSrc effect
    } catch (e) {
      if (gen !== hearGenRef.current) return;
      playWhenReadyRef.current = false;
      syncBgmToNarrationRef.current = false;
      bgmRef.current?.pause();
      setPlaying(false);
      setAudioReady(false);
      setPreview(null);
      setAudioSrc(null);
      revokeAudioUrl();
      setPreviewLoading(false);
      setStatusNote(null);
      setPreviewError(e instanceof Error ? e.message : "Couldn't play — try again.");
    }
  };

  const onHear = () => {
    if (previewLoading || savingScript) return;
    if (talkActiveRef.current) {
      setPreviewError(null);
      setStatusNote("End talk first — story playback and live conversation can’t run together.");
      return;
    }
    const n = narrationRef.current;
    if (audioSrc && audioReady && n && !scriptDirty) {
      if (playing && !n.paused) {
        pausePlayback();
        return;
      }
      void startPlayback(n.ended || n.currentTime <= 0.05);
      return;
    }
    // Finish previews the music bed. The script step is the voice alone.
    if (stage === "script") {
      syncBgmToNarrationRef.current = false;
      const bed = bgmRef.current;
      if (bed) {
        bed.pause();
        bed.muted = true;
      }
    } else {
      const bed = bgmRef.current;
      if (bed) bed.muted = false;
      // Unlock + start BGM in the same user gesture as Listen (before async fetch).
      startBgm(true, bgmTrack, bgmUrl);
    }
    void loadPreview(true);
  };

  const replayPlayback = () => {
    if (!audioSrc || previewLoading || !audioReady) return;
    void startPlayback(true);
  };

  const openCompare = async () => {
    if (!data?.source_conversation_id) {
      setStatusNote("No linked conversation for this script.");
      return;
    }
    setCompareOpen(true);
    if (compareTurns) return;
    setCompareLoading(true);
    try {
      const c = await apiGet<ConversationBrief>(
        `/library/conversations/${encodeURIComponent(data.source_conversation_id)}`
      );
      setCompareTurns({ turns: c.turns || [], transcript: c.transcript });
    } catch {
      setCompareTurns({ turns: [], transcript: null });
      setStatusNote("Could not load transcript.");
    } finally {
      setCompareLoading(false);
    }
  };

  const onDelete = async () => {
    if (!confirm("Delete this script? This cannot be undone.")) return;
    setError(null);
    try {
      await apiDelete(`/library/stories/${encodeURIComponent(id)}`);
      router.replace("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  const onDeleteConversation = async () => {
    if (!conversationId || deletingConversation) return;
    setDeletingConversation(true);
    setError(null);
    try {
      if (session.isListening || session.status === "connecting") {
        await session.discardWithoutSaving();
      }
      await apiDelete(`/library/conversations/${encodeURIComponent(conversationId)}`);
      router.replace("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
      setDeletingConversation(false);
    }
  };

  const voiceMode =
    stage === "curate" ? "curating" : stage === "script" ? "storytelling" : "conversing";
  const session = useRealtimeSession({
    conversationId,
    storyId: id || null,
    mode: voiceMode,
    persistConversation: stage === "conversation",
    allowHandoff: false,
    onBeforeStart: () => {
      // Dual-audio rule: live talk wins — stop Listen/Hear + BGM immediately
      pausePlayback();
      playWhenReadyRef.current = false;
      syncBgmToNarrationRef.current = false;
      hearGenRef.current += 1;
      setStatusNote(null);
      setPreviewError(null);
    },
    onConversationSaved: () => {
      if (!conversationId) return;
      apiGet<ConversationDetail>(`/library/conversations/${encodeURIComponent(conversationId)}`)
        .then((c) => {
          setConversation(c);
          if (c.script_id) setStoryId((prev) => prev || c.script_id);
        })
        .catch(() => {});
      if (advanceAfterSaveRef.current) {
        advanceAfterSaveRef.current = false;
        setStatusNote("Talk saved. Writing your script…");
        void deriveRef.current();
      } else {
        setStatusNote("Talk saved. Tap Make my story when you are ready.");
      }
    },
    onReadyForScript: () => {},
    onStorySaved: (savedId) => {
      if (savedId) setStoryId((prev) => prev || savedId);
      load();
      setStatusNote("Story updated. Share it with your family when it sounds like you.");
    },
    onCurateChoice: (choice) => {
      if (choice.bgm_track) setBgmTrack(normalizeBgmTrack(choice.bgm_track));
      if (choice.narration_tone) setNarrationTone(choice.narration_tone);
      if (choice.reason) setCurateReason(choice.reason);
      // Persist + refresh status line; next Listen uses new mood/tone
      void saveCurate(choice);
    },
  });

  talkActiveRef.current = session.isListening || session.status === "connecting";

  useEffect(() => {
    if (playing) setHeardOnce(true);
  }, [playing]);

  const goStage = useCallback(
    async (next: StudioStage) => {
      const order = STAGE_ORDER;
      const scriptReady = Boolean(storyId);
      const talkReady = Boolean(conversationId);
      const reachable =
        next === "conversation"
          ? talkReady
          : next === "script" || next === "curate" || next === "share"
            ? scriptReady
            : false;
      if (!reachable) {
        if (!scriptReady && next !== "conversation") {
        setStatusNote("The script isn’t ready yet. Finish talking and it will be written on this screen.");
        } else if (!talkReady && next === "conversation") {
          setStatusNote("This script has no linked conversation. Script, Curate, and Share are on this screen.");
        }
        return;
      }
      if (next === stage) {
        return;
      }
      pausePlayback();
      if (
        session.isListening ||
        session.status === "connecting" ||
        session.status === "saving"
      ) {
        await session.endSession();
      }
      if (stage === "curate" && next === "share") setCurateContinued(true);
      setStage(next);
      setStatusNote(null);
      writeStageQuery(next);
    },
    [
      conversationId,
      pausePlayback,
      session,
      stage,
      storyId,
    ]
  );

  const onDerive = useCallback(async () => {
    if (!conversationId) return;
    setDeriving(true);
    setError(null);
    setStatusNote("Writing your script from this talk. Stay here — it opens on this screen.");
    try {
      const story = await apiPost<StoryDetail>(
        `/library/conversations/${encodeURIComponent(conversationId)}/derive-script`,
        {}
      );
      applyStory(story);
      setStoryId(story.id);
      setStage("script");
      writeStageQuery("script");
      setStatusNote(
        "Your script is ready. Read it, change a word if you want, then add the finishing touches."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not derive a script.");
      setStatusNote("The story didn’t finish. Tap Make my story to try again.");
    } finally {
      setDeriving(false);
    }
  }, [conversationId]);

  deriveRef.current = onDerive;

  useEffect(() => {
    if (advanceFromQueryRef.current) return;
    if (searchParams.get("advance") !== "script") return;
    if (!conversation || storyId || conversation.script_id) return;
    const words =
      (conversation.turns?.length || 0) > 0 || Boolean((conversation.transcript || "").trim());
    if (!words) return;
    advanceFromQueryRef.current = true;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("advance");
      const query = url.searchParams.toString();
      window.history.replaceState(window.history.state, "", query ? `${url.pathname}?${query}` : url.pathname);
    }
    void deriveRef.current();
  }, [conversation, searchParams, storyId]);

  useEffect(() => {
    if (session.isListening || session.status === "connecting") {
      pausePlayback();
    }
  }, [session.isListening, session.status, pausePlayback]);

  useEffect(() => {
    if (stage !== "conversation") return;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stage, conversation?.turns, session.liveTurns, session.isListening]);

  if (routeKind === "story" && error && !data) {
    return (
      <>
        <h1 className="page-title">Script</h1>
        <div className="msg msg-error" role="alert">
          {error}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/library">← Memories</Link>
        </p>
      </>
    );
  }

  if (routeKind === "conversation" && error && !conversation) {
    return (
      <>
        <h1 className="page-title">Conversation</h1>
        <div className="msg msg-error" role="alert">
          {error}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/library">← Memories</Link>
        </p>
      </>
    );
  }

  if (primaryMissing) {
    return (
      <>
        <h1 className="page-title">{routeKind === "conversation" ? "Conversation" : "Script"}</h1>
        <p className="text-muted">Loading…</p>
      </>
    );
  }

  const conversationWords =
    (conversation?.turns?.length || 0) > 0 || Boolean((conversation?.transcript || "").trim());
  const inVoice =
    session.isListening || session.status === "connecting" || session.status === "saving";
  const displayTurns = inVoice
    ? [...(conversation?.turns || []), ...session.liveTurns]
    : conversation?.turns || [];

  const conversationDone = conversationWords || Boolean(storyId);
  const scriptDone = Boolean(data && draftText.trim() && !scriptDirty);
  const curateDone = curateContinued || heardOnce || shareCount > 0;
  const shareDone = shareCount > 0;

  const currentStep: StudioStage = stage === "share" ? "curate" : stage;

  const markFor = (stepId: StudioStage): StageMark => {
    if (stepId === currentStep) return "now";
    const order: StudioStage[] = ["conversation", "script", "curate"];
    const next = order[order.indexOf(currentStep) + 1];
    if (stepId === next) return "next";
    const done =
      stepId === "conversation"
        ? conversationDone
        : stepId === "script"
          ? scriptDone
          : curateDone || shareDone;
    if (done || order.indexOf(stepId) < order.indexOf(currentStep)) return "done";
    return "later";
  };

  const steps: StageStep[] = [
    {
      id: "conversation",
      label: "Talk",
      mark: markFor("conversation"),
      reachable: Boolean(conversationId),
    },
    { id: "script", label: "Story", mark: markFor("script"), reachable: Boolean(storyId) },
    { id: "curate", label: "Share", mark: markFor("curate"), reachable: Boolean(storyId) },
  ];

  const guide =
    statusNote ||
    (currentStep === "conversation"
      ? session.status === "saving" || deriving
        ? "Writing your story. Stay on this screen."
        : session.isListening || session.status === "connecting"
          ? "The microphone is on. Speak, then tap the button when you are finished."
          : storyId
            ? "This talk already has a story. Open Story when you want to hear it."
            : conversationWords
              ? "This talk is saved. Tap Make my story when you are ready."
              : "The microphone is off. Tap the button, then speak."
      : currentStep === "script"
        ? scriptDirty
          ? "Your edits are not saved yet. Share with family will save them."
          : "Listen if you want. When it sounds like you, share it with your family."
        : "Music is suggested for you. A photo is optional. When it feels right, share it below.");

  const pageTitle =
    currentStep === "conversation"
      ? conversation?.title || "Talk"
      : currentStep === "script"
        ? data?.title || draftTitle || "Script"
        : "Finish";


  // Do not gate Listen on autoCurating — Curator status can load in the background.
  // (Blocking Listen on suggest caused a stuck "Preparing…" when React remounted mid-flight.)
  const hearBusy = previewLoading || savingScript;
  const talkBlocksListen = session.isListening || session.status === "connecting";
  const isActuallyPlaying = playing && audioReady && playbackDuration > 0;
  const hearLabel = talkBlocksListen
    ? "End talk first"
    : previewLoading
      ? "Preparing…"
      : isActuallyPlaying
        ? "Pause"
        : "Listen";

  const onScrub = (value: number) => {
    const n = narrationRef.current;
    if (!n || !Number.isFinite(value) || !audioReady) return;
    n.currentTime = value;
    setPlaybackTime(value);
  };

  const showPlayerSlot = previewLoading || Boolean(audioSrc);
  const showPlayerControls = Boolean(audioSrc) && audioReady && playbackDuration > 0;

  const listenUnit = (
    <div className="script-listen" data-stage={stage}>
      <audio
        ref={narrationRef}
        preload="auto"
        title="Your script"
        aria-label="Your script narration"
        onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setPlaybackDuration(d);
            setAudioReady(true);
          }
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) {
            setPlaybackDuration(d);
            setAudioReady(true);
          }
        }}
        onPlay={() => {
          const d = narrationRef.current?.duration ?? 0;
          if (Number.isFinite(d) && d > 0) setPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
          // Only stop BGM for intentional pause/end — not when we clear narration during prepare.
          if (syncBgmToNarrationRef.current) {
            bgmRef.current?.pause();
          }
        }}
        onEnded={() => {
          setPlaying(false);
          syncBgmToNarrationRef.current = false;
          const bgm = bgmRef.current;
          if (bgm) {
            bgm.pause();
            try {
              bgm.currentTime = 0;
            } catch {
              /* ignore */
            }
          }
        }}
        onError={() => {
          if (!audioSrc) return;
          syncBgmToNarrationRef.current = false;
          bgmRef.current?.pause();
          setPlaying(false);
          setAudioReady(false);
          setPreviewLoading(false);
          setPreviewError("Couldn't play — try again.");
        }}
      />
      <audio
        ref={bgmRef}
        src={
          stage === "script"
            ? undefined
            : resolveBgmSrc(preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl)
        }
        muted={stage === "script"}
        preload="auto"
        loop
        aria-hidden
        className="script-audio-hidden"
      />

      <button
        type="button"
        className={`btn ${stage === "script" ? "btn-ghost" : "btn-primary"} script-hear-btn${isActuallyPlaying ? " is-playing" : ""}`}
        onClick={onHear}
        disabled={hearBusy || !draftText.trim() || talkBlocksListen}
        aria-label={hearLabel}
        title={
          talkBlocksListen
            ? "End talk first — playback and live conversation can’t run together"
            : undefined
        }
      >
        {hearLabel}
      </button>

      <div
        className={`script-player-slot${showPlayerSlot ? " is-open" : ""}${previewLoading ? " is-preparing" : ""}`}
        aria-live="polite"
      >
        {previewLoading ? (
          <p className="script-player-preparing">
            Preparing with{" "}
            {normalizeBgmTrack(bgmTrack) === "none" ? "voice only" : bgmLabel(bgmTrack)}
            {stage === "curate" ? ` · ${toneLabel(narrationTone)}` : ""}…
          </p>
        ) : null}

        {showPlayerControls ? (
          <div className="script-player is-ready" role="region" aria-label="Script playback">
            <div className="script-player-status">
              {isActuallyPlaying ? "Playing" : playbackTime > 0.05 ? "Paused" : "Ready"}
            </div>
            <div className="script-player-row">
              <span className="script-player-time" aria-hidden>
                {formatPlaybackTime(playbackTime)}
              </span>
              <input
                className="script-player-scrub"
                type="range"
                min={0}
                max={playbackDuration}
                step={0.1}
                value={Math.min(playbackTime, playbackDuration)}
                aria-label="Playback position"
                onChange={(e) => onScrub(Number(e.target.value))}
              />
              <span className="script-player-time" aria-hidden>
                {formatPlaybackTime(playbackDuration)}
              </span>
              <button
                type="button"
                className="btn btn-ghost script-player-replay"
                onClick={replayPlayback}
                disabled={hearBusy}
                aria-label="Replay from start"
              >
                Replay
              </button>
            </div>
          </div>
        ) : audioSrc && !previewLoading ? (
          <p className="script-player-preparing">Loading audio…</p>
        ) : null}
      </div>
    </div>
  );

  const spoken =
    conversationWords || session.liveTurns.some((t) => (t.content || "").trim().length > 0);

  const readyForScript = async () => {
    if (!spoken || deriving) return;
    if (session.isListening || session.status === "connecting" || session.status === "saving") {
      setStatusNote("Saving this talk, then making your Script…");
      await session.endSession();
    }
    await onDerive();
  };

  const continueToCurate = async () => {
    if (!draftText.trim()) {
      setStatusNote("The script is empty. Add a few words, then continue.");
      return;
    }
    if (scriptDirty) {
      setStatusNote("Saving your script…");
      const ok = await saveScript({ quiet: true });
      if (!ok) {
        setStatusNote("Save didn’t finish. Tap Share with family again.");
        return;
      }
    }
    await goStage("curate");
  };

  const stageActions = (
    <>
      {stage === "conversation" ? (
        <>
          {storyId ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => void goStage("script")}>
              See my story
            </button>
          ) : spoken && !session.isListening && session.status !== "connecting" && session.status !== "saving" ? (
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => void readyForScript()}
              disabled={deriving}
            >
              {deriving ? "Writing your story…" : "Make my story"}
            </button>
          ) : null}
          {confirmDeleteConversation ? (
            <div className="library-confirm" role="group" aria-label="Confirm delete">
              <p>Delete this conversation? This cannot be undone.</p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirmDeleteConversation(false)}
                  disabled={deletingConversation}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void onDeleteConversation()}
                  disabled={deletingConversation}
                >
                  {deletingConversation ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="stage-quiet-delete"
              onClick={() => setConfirmDeleteConversation(true)}
            >
              Delete
            </button>
          )}
        </>
      ) : null}
      {stage === "script" && data ? (
        <>
          {listenUnit}
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!draftText.trim() || session.isListening || savingScript || deriving}
            onClick={() => void continueToCurate()}
          >
            {savingScript ? "Saving…" : "Share with family"}
          </button>
        </>
      ) : null}
      {stage === "script" && !data ? (
        <p className="stage-actions-note">{storyError || "Loading your story…"}</p>
      ) : null}
      {stage === "curate" && data ? (
        <>
          {listenUnit}
        </>
      ) : null}
      {(stage === "curate" || stage === "share") && data ? (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => void goStage("script")}>
          Change the story
        </button>
      ) : null}
    </>
  );

  return (
    <>
      <p style={{ marginBottom: 4 }}>
        <Link href="/library">← Memories</Link>
      </p>

      <StageShell
        steps={steps}
        onSelect={(next) => void goStage(next === "share" ? "curate" : next)}
        title={pageTitle}
        coach={guide}
        actions={stageActions}
        dock={
          <VoiceDock
            agentLabel={
              currentStep === "conversation" ? "Talk" : currentStep === "script" ? "Script" : "Finish"
            }
            coachHint={
              currentStep === "conversation"
                ? "Tap to talk, then speak. Tap to finish and the script starts."
                : currentStep === "script"
                  ? "Only if you want to change the words."
                  : "Only if you want to change the music."
            }
            emphasis={currentStep === "conversation" ? "primary" : "optional"}
            idleLabel={
              currentStep === "script" ? "Talk to change the words" : "Talk to change the music"
            }
            status={session.status}
            message={session.message}
            mmss={session.mmss}
            isBusy={session.isBusy}
            isListening={session.isListening}
            onStart={() => void session.start()}
            onEnd={() => {
              const hasWords =
                conversationWords ||
                session.liveTurns.some((t) => (t.content || "").trim().length > 0);
              if (stage === "conversation" && !storyId && hasWords) {
                advanceAfterSaveRef.current = true;
                setStatusNote("Finishing your talk, then writing the script…");
              }
              void session.endSession();
            }}
          />
        }
      >
        <p className="text-muted script-meta-line">
          {formatDate((stage === "conversation" ? conversation?.created_at : data?.created_at) || "")}
          {stage === "conversation" ? " · Exact transcript · Private" : " · Private"}
        </p>

        {error || storyError ? (
          <div className="msg msg-error" role="alert">
            {error || storyError}
          </div>
        ) : null}
        {previewError ? (
          <div className="msg msg-error" role="alert">
            {previewError}{" "}
            <button type="button" className="script-text-action script-text-action-inline" onClick={onHear}>
              Try again
            </button>
          </div>
        ) : null}

        {stage === "script" && data ? (
          <>
            <section className="script-canvas stack-12">
              <label className="field-label" htmlFor="script-title">
                Title
              </label>
              <input
                id="script-title"
                className="input"
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.target.value);
                  setScriptSaved(false);
                  setStatusNote("These edits are not saved yet. Share with family will save them.");
                }}
                placeholder="Script title"
              />
              <label className="field-label" htmlFor="script-body">
                Script
              </label>
              <textarea
                id="script-body"
                className="input script-editor"
                rows={14}
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setScriptSaved(false);
                  setStatusNote("These edits are not saved yet. Share with family will save them.");
                }}
                placeholder="Your story script…"
              />

              <div className="script-craft-secondary">
                <button type="button" className="script-text-action" onClick={() => void openCompare()}>
                  Compare with conversation
                </button>
              </div>

              <p className="script-voice-note">
                Narration uses your voice when enrolled (
                <Link href="/me/voice">Me → Voice</Link>
                ).
              </p>

              <details className="studio-danger-details">
                <summary>Delete this script</summary>
                <p className="text-muted" style={{ margin: "8px 0", fontSize: 13 }}>
                  Removes this script from your library. This cannot be undone.
                </p>
                <button className="btn btn-danger" type="button" onClick={() => void onDelete()}>
                  Delete permanently
                </button>
              </details>
            </section>

            {compareOpen ? (
              <div className="script-compare stack-8">
                <div className="script-compare-head">
                  <div className="section-title" style={{ marginTop: 0 }}>
                    Exact transcript
                  </div>
                  <button type="button" className="script-text-action" onClick={() => setCompareOpen(false)}>
                    Close
                  </button>
                </div>
                {compareLoading ? (
                  <p className="text-muted">Loading…</p>
                ) : compareTurns?.turns?.length ? (
                  <div className="studio-live-turns stack-8">
                    {compareTurns.turns.map((t, i) => (
                      <div key={i} style={{ fontSize: 14 }}>
                        <span style={{ fontWeight: 600 }}>
                          {t.role === "user" ? "You" : "Companion"}
                        </span>
                        <span className="text-muted">: </span>
                        <span style={{ whiteSpace: "pre-wrap" }}>{t.content}</span>
                      </div>
                    ))}
                  </div>
                ) : compareTurns?.transcript ? (
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>
                    {compareTurns.transcript}
                  </p>
                ) : (
                  <p className="text-muted">No transcript available.</p>
                )}
                {conversationId ? (
                  <button type="button" className="script-text-action" onClick={() => void goStage("conversation")}>
                    Open Conversation
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : stage === "conversation" ? (
          <>
            <div className="card stack-8">
              <div className="section-title" style={{ marginTop: 0 }}>
                Exact transcript
              </div>
              {displayTurns.length ? (
                <div className="studio-live-turns stack-8">
                  {displayTurns.map((t, i) => (
                    <div key={i} style={{ fontSize: 14 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          color: t.role === "user" ? "var(--primary)" : "var(--ink-muted)",
                        }}
                      >
                        {t.role === "user" ? "You" : "Companion"}
                      </span>
                      <span className="text-muted">: </span>
                      <span style={{ whiteSpace: "pre-wrap" }}>{t.content}</span>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              ) : conversation?.transcript ? (
                <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{conversation.transcript}</p>
              ) : (
                <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
                  No words yet. The microphone is off until you tap Talk above.
                </p>
              )}
            </div>
            {conversation?.audio_url ? (
              <audio controls src={conversation.audio_url} style={{ width: "100%" }} preload="metadata">
                Your browser doesn&rsquo;t support audio playback.
              </audio>
            ) : null}
            {conversation?.summary ? (
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                Quick recall: {conversation.summary}
              </p>
            ) : null}
          </>
        ) : (stage === "curate" || stage === "share") && data ? (
          <>
            <section className="curate-status stack-12" aria-live="polite">
              <div className="curate-status-card">
                <p className="curate-status-line">
                  {autoCurating
                    ? "Choosing music for this story…"
                    : curateStatusLine ||
                      `Music: ${
                        normalizeBgmTrack(bgmTrack) === "none" ? "voice only" : bgmLabel(bgmTrack)
                      }. Voice: ${toneLabel(narrationTone)}. Tap Listen to hear it.`}
                </p>
                {curateReason ? <p className="curate-status-why">{curateReason}</p> : null}
                {musicSource === "generating" ? (
                  <p className="curate-status-meta">Making music for this story…</p>
                ) : musicSource === "generated" && bgmUrl ? (
                  <p className="curate-status-meta">Music for this story is ready.</p>
                ) : null}
                <p className="curate-status-hint">Talk above if you want different music.</p>
              </div>

              <div className="curate-voice-row">
                <p className="curate-voice-label">
                  {voiceLabel ||
                    (voiceEnrolled
                      ? "This story uses your voice."
                      : "This story uses a standard voice until you record your own.")}
                </p>
                {voiceHint ? <p className="curate-status-meta">{voiceHint}</p> : null}
                {!voiceEnrolled ? (
                  <p className="curate-voice-link">
                    <Link href="/me/voice">Set up your voice</Link>
                  </p>
                ) : (
                  <p className="curate-voice-link">
                    <Link href="/me/voice">Me → Voice</Link>
                  </p>
                )}
              </div>

              <div className="field-label">Photo (optional — one only)</div>
              {data.photo_url ? (
                <div className="stack-8">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={data.photo_url} alt="Story moment" className="story-photo" />
                  <div className="btn-row">
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={uploadingPhoto || savingCurate}
                      onClick={() => fileRef.current?.click()}
                    >
                      Replace photo
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={savingCurate}
                      onClick={() => void saveCurate({ clear_photo: true })}
                    >
                      Remove photo
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={uploadingPhoto || savingCurate}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploadingPhoto ? "Uploading…" : "Add a photo"}
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => void onPhotoSelected(e.target.files?.[0] ?? null)}
              />
            </section>

            <section className="finish-share">
              <h2 className="section-title">Ready to share</h2>
              <p className="stage-actions-note">
                A private link for family. They hear the story. They don’t see this app.
              </p>
              <ShareSheet
                embedded
                open
                onClose={() => {}}
                targetType="story"
                targetId={data.id}
                onActiveCount={onShareCount}
              />
            </section>

            <div className="share-section">
              <div className="section-title">Notes from people you shared with</div>
              {comments.length === 0 ? (
                <p className="text-muted" style={{ fontSize: 14 }}>
                  No notes yet.
                </p>
              ) : (
                <div className="stack-8">
                  {comments.map((c) => (
                    <div key={c.id} className="card" style={{ padding: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "baseline",
                        }}
                      >
                        <strong>{c.recipient_name}</strong>
                        <span className="text-faint" style={{ fontSize: 12 }}>
                          {formatDate(c.created_at)}
                        </span>
                      </div>
                      <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{c.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted">{storyError || "Loading…"}</p>
        )}
      </StageShell>
    </>
  );
}
