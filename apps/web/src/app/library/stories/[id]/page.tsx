"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiGet, apiGetBlobWithMeta, apiDelete, apiPatch, apiPost } from "@/lib/api";
import { requestUploadUrl, completeUpload } from "@/lib/media";
import ShareSheet from "@/app/components/ShareSheet";
import StageShell from "@/app/components/StageShell";
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

function StoryStudioInner() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const stageParam = (searchParams.get("stage") || "script").toLowerCase();
  const stage = stageParam === "curate" ? "curate" : "script";

  const [data, setData] = useState<StoryDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
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
  };

  const load = useCallback(() => {
    if (!id) return;
    apiGet<StoryDetail>(`/library/stories/${encodeURIComponent(id)}`)
      .then(applyStory)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this script."));
    apiGet<Comment[]>(`/library/stories/${encodeURIComponent(id)}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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
      if (!opts?.quiet) setStatusNote("Already saved.");
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
      if (!opts?.quiet) setStatusNote("Saved.");
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
        startBgm(fromStart || n.currentTime < 0.05, preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl);
        syncBgmToNarrationRef.current = true;
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
    [bgmTrack, bgmUrl, preview?.bgm_track, preview?.bgm_url, startBgm]
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
          // BGM should already be running from Listen click (user gesture). Re-assert play.
          startBgm(false, preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl);
          syncBgmToNarrationRef.current = true;
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
  }, [audioSrc, bgmTrack, bgmUrl, preview?.bgm_track, preview?.bgm_url, startBgm]);

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
    setStatusNote(`Preparing with ${moodBit} · ${toneName} tone…`);

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
        normalizeBgmTrack(p.bgm_track) === "none"
          ? "voice only"
          : p.bgm_url
            ? `unique music under ${toneLabel(p.narration_tone || undefined)} voice`
            : `${bgmLabel(p.bgm_track)} under ${toneLabel(p.narration_tone || undefined)} voice`;
      if (!voiceNote) setStatusNote(`Ready — ${readyMood}.`);
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
    // Unlock + start BGM in the same user gesture as Listen (before async fetch).
    startBgm(true, bgmTrack, bgmUrl);
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

  const voiceMode = stage === "curate" ? "curating" : "storytelling";
  const session = useRealtimeSession({
    conversationId: data?.source_conversation_id,
    storyId: id,
    mode: voiceMode,
    persistConversation: false,
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
    onStorySaved: () => {
      load();
      setStatusNote("Script updated by Storyteller.");
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
    if (session.isListening || session.status === "connecting") {
      pausePlayback();
    }
  }, [session.isListening, session.status, pausePlayback]);

  if (error && !data) {
    return (
      <>
        <h1 className="page-title">Script</h1>
        <div className="msg msg-error" role="alert">
          {error}
        </div>
        <p style={{ marginTop: 16 }}>
          <Link href="/library">← Back to Library</Link>
        </p>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <h1 className="page-title">Script</h1>
        <p className="text-muted">Loading…</p>
      </>
    );
  }

  const coach =
    stage === "script"
      ? session.isListening
        ? "Storyteller is with you — the script stays on screen."
        : "Shape the words. Hear them when ready. Curate comes next."
      : session.isListening
        ? "Curator is guiding finishing touches — Listen is still the hero."
        : "Curator sets music and tone. Talk to adjust. Listen is the hero.";

  // Do not gate Listen on autoCurating — Curator status can load in the background.
  // (Blocking Listen on suggest caused a stuck "Preparing…" when React remounted mid-flight.)
  const hearBusy = previewLoading || savingScript;
  const talkBlocksListen = session.isListening || session.status === "connecting";
  const isActuallyPlaying = playing && audioReady && playbackDuration > 0;
  const hearLabel = talkBlocksListen
    ? "End talk first"
    : savingScript && scriptDirty
      ? "Saving…"
      : previewLoading
        ? "Preparing…"
        : isActuallyPlaying
          ? "Pause"
          : audioReady && audioSrc && !scriptDirty
            ? "Play"
            : stage === "curate"
              ? "Listen"
              : "Hear";

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
        src={resolveBgmSrc(preview?.bgm_track || bgmTrack, preview?.bgm_url || bgmUrl)}
        preload="auto"
        loop
        aria-hidden
        className="script-audio-hidden"
      />

      <button
        type="button"
        className={`btn btn-primary script-hear-btn${isActuallyPlaying ? " is-playing" : ""}`}
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

  const craftSecondary = (
    <div className="script-craft-secondary">
      <button
        type="button"
        className="script-text-action"
        onClick={() => void saveScript()}
        disabled={savingScript || (!scriptDirty && scriptSaved)}
      >
        {savingScript ? "Saving…" : scriptDirty ? "Save" : scriptSaved ? "Saved" : "Save"}
      </button>
      <span className="script-craft-dot" aria-hidden>
        ·
      </span>
      <button type="button" className="script-text-action" onClick={() => void openCompare()}>
        Compare
      </button>
    </div>
  );

  return (
    <>
      <p style={{ marginBottom: 4 }}>
        <Link href="/library">← Library</Link>
      </p>

      <StageShell
        stage={stage}
        conversationId={data.source_conversation_id}
        scriptId={data.id}
        title={stage === "script" ? data.title || "Script Studio" : "Curate Studio"}
        coach={coach}
        dock={
          <VoiceDock
            agentLabel={stage === "script" ? "Storyteller" : "Curator"}
            coachHint={
              stage === "script"
                ? "Revise wording while the script stays visible."
                : "Ask to change music or tone — I’ll apply it. I can also help you set up your voice."
            }
            status={session.status}
            message={session.message}
            mmss={session.mmss}
            isBusy={session.isBusy}
            isListening={session.isListening}
            onStart={() => void session.start()}
            onEnd={() => void session.endSession()}
          />
        }
        advance={
          stage === "script" ? (
            <>
              <p className="studio-advance-hint">Next: finishing touches</p>
              <button
                type="button"
                className="btn btn-primary studio-advance-btn"
                disabled={!draftText.trim() || session.isListening}
                aria-label="Ready to Curate — continue to music, tone, voice, and photo"
                onClick={() => {
                  if (scriptDirty) void saveScript({ quiet: true });
                  router.push(`/library/stories/${encodeURIComponent(id)}?stage=curate`);
                }}
              >
                Ready to Curate
              </button>
            </>
          ) : (
            <>
              <p className="studio-advance-hint">Optional — invite someone with a private link.</p>
              <div className="studio-advance-row">
                <button
                  type="button"
                  className="btn btn-ghost studio-advance-btn"
                  onClick={() => setShareOpen(true)}
                  aria-label="Who can listen — create a private password-protected link"
                >
                  Who can listen
                </button>
                <Link
                  className="script-text-action"
                  href={`/library/stories/${encodeURIComponent(id)}?stage=script`}
                >
                  ← Back to Script
                </Link>
              </div>
            </>
          )
        }
        advanceQuiet={stage === "curate"}
      >
        <p className="text-muted script-meta-line">{formatDate(data.created_at)} · Private</p>

        {error ? (
          <div className="msg msg-error" role="alert">
            {error}
          </div>
        ) : null}
        {statusNote ? (
          <div className="msg msg-info" role="status">
            {statusNote}
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

        {stage === "script" ? (
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
                  setStatusNote(null);
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
                  setStatusNote(null);
                }}
                placeholder="Your story script…"
              />

              {listenUnit}
              {craftSecondary}

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
                {data.source_conversation_id ? (
                  <Link
                    href={`/library/conversations/${encodeURIComponent(data.source_conversation_id)}`}
                  >
                    Open Conversation Studio
                  </Link>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="studio-hero-listen">{listenUnit}</div>

            <section className="curate-status stack-12" aria-live="polite">
              <div className="curate-status-card">
                <p className="curate-status-line">
                  {autoCurating
                    ? "Curator is choosing music and tone…"
                    : curateStatusLine ||
                      `Curator set: ${
                        normalizeBgmTrack(bgmTrack) === "none" ? "voice only" : bgmLabel(bgmTrack)
                      } · ${toneLabel(narrationTone)} — tap Listen to hear`}
                </p>
                {curateReason ? <p className="curate-status-why">{curateReason}</p> : null}
                {musicSource === "generating" ? (
                  <p className="curate-status-meta">Composing a unique bed for this story…</p>
                ) : musicSource === "generated" && bgmUrl ? (
                  <p className="curate-status-meta">Unique music bed ready for this story.</p>
                ) : null}
                <p className="curate-status-hint">Change by talking with Curator.</p>
              </div>

              <div className="curate-voice-row">
                <p className="curate-voice-label">
                  {voiceLabel ||
                    (voiceEnrolled
                      ? "Narration: your voice"
                      : "Narration: default voice — Curator can help you enroll")}
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
        )}
      </StageShell>

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        targetType="story"
        targetId={data.id}
      />
    </>
  );
}

export default function StoryDetailPage() {
  return (
    <Suspense
      fallback={
        <>
          <h1 className="page-title">Script</h1>
          <p className="text-muted">Loading…</p>
        </>
      }
    >
      <StoryStudioInner />
    </Suspense>
  );
}
