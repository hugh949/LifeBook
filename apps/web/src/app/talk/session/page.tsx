"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { getRealtimeToken, connectRealtimeWebRTC } from "@/lib/realtime";
import { apiGet, apiPost, apiPatch, apiDelete, apiPostFormData, apiGetWithTimeout, apiPostWithTimeout } from "@/lib/api";
import { createWavRecorderRolling, recordWavForDuration, type WavRecorderRolling } from "@/lib/wavRecorder";
import { useParticipantIdentity } from "@/app/components/ParticipantIdentity";

type Status = "idle" | "identifying" | "connecting" | "connected" | "stubbed" | "error";

type Participant = { id: string; label: string; has_voice_profile?: boolean; recall_passphrase_set?: boolean };

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

const RECALL_PIN_LENGTH = 4;
const RECALL_UNLOCK_STORAGE_KEY = "lifebook_recall_unlocked";

function getRecallUnlockedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(RECALL_UNLOCK_STORAGE_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function addRecallUnlocked(participantId: string): void {
  if (typeof window === "undefined") return;
  const set = getRecallUnlockedIds();
  set.add(participantId);
  sessionStorage.setItem(RECALL_UNLOCK_STORAGE_KEY, JSON.stringify([...set]));
}

function isRecallUnlocked(participantId: string): boolean {
  if (!participantId) return false;
  return getRecallUnlockedIds().has(participantId);
}

function clearAllRecallUnlocked(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(RECALL_UNLOCK_STORAGE_KEY);
}

function formatSessionDateTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
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

/** One line under date: backend-built recall_label (summary + topic words), or summary/tags fallback. */
function getRecallLabel(s: VoiceSession): string {
  if (s.recall_label && s.recall_label.trim()) return s.recall_label.trim();
  if (s.summary && s.summary.trim() && s.summary !== "Session recorded." && s.summary !== "Session recorded")
    return s.summary.trim();
  if (s.reminder_tags?.length) return s.reminder_tags.join(", ");
  if (s.summary && s.summary.trim()) return s.summary.trim();
  return "No preview";
}

const MAX_SUMMARY_CHARS = 100;
const GENERIC_SUMMARY = "Session recorded";

function deriveSummaryFromTurns(turns: Turn[]): string {
  const firstUser = turns.find((t) => t.role === "user");
  if (!firstUser?.content) return "";
  const text = firstUser.content.trim();
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  return text.slice(0, MAX_SUMMARY_CHARS).trim() + "…";
}

// Participant-only, noun-leaning tags (exclude common verbs/adjectives)
const TOPIC_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "so", "its", "it's", "to", "from",
  "i", "me", "my", "you", "your", "he", "she", "we", "they", "them", "us", "our", "his", "her",
  "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "just", "really", "very",
  "hello", "hi", "hey", "yes", "no", "ok", "okay", "well", "oh", "ah", "um", "uh",
  "nice", "good", "great", "lovely", "wonderful", "hear", "speak", "talking", "talk",
  "older", "adult", "today", "now", "here", "there", "this", "that", "these", "those",
  "what", "when", "where", "which", "who", "how", "why", "about", "with", "for", "not",
  "help", "like", "voice", "feeling", "mind", "doing", "right", "whats", "want", "think",
  "know", "get", "see", "come", "go", "say", "make", "take", "need", "try", "ask", "tell",
  "give", "work", "call", "find", "feel", "seem", "seems", "thing", "things", "way", "day",
]);

function deriveKeywordsFromTurns(turns: Turn[]): string[] {
  const substantive = turns.filter((t) => t.role === "user" && t.content && t.content.trim().length > 20);
  const text = (substantive.length ? substantive.map((t) => t.content.trim()) : turns.filter((t) => t.role === "user").map((t) => t.content?.trim()).filter(Boolean)).join(" ");
  if (!text) return [];
  const words = text.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (out.length >= 8) break;
    const clean = w.replace(/[^\w'-]/g, "").toLowerCase();
    if (clean.length < 3 || TOPIC_STOPWORDS.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

type Turn = { role: string; content: string };

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const o = content as { text?: string; transcript?: string };
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.transcript === "string") return o.transcript.trim();
  }
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object") {
      if ("text" in part && typeof (part as { text?: string }).text === "string")
        parts.push((part as { text: string }).text);
      if ("transcript" in part && typeof (part as { transcript?: string }).transcript === "string")
        parts.push((part as { transcript: string }).transcript);
    }
  }
  return parts.join(" ").trim();
}

export default function SessionPage() {
  const { participantId: contextParticipantId, setParticipantId: setContextParticipantId, refreshParticipants, participants: contextParticipants } = useParticipantIdentity();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantId] = useState<string>(contextParticipantId ?? "");
  const [recallSessions, setRecallSessions] = useState<VoiceSession[] | null>(null);
  const [storyList, setStoryList] = useState<VoiceStory[] | null>(null);
  const [continuingFromTags, setContinuingFromTags] = useState<string[] | null>(null);
  const [recallUnlockPending, setRecallUnlockPending] = useState<"conversations" | "stories" | null>(null);
  const [pinError, setPinError] = useState("");
  const [pinChecking, setPinChecking] = useState(false);
  const [settingCode, setSettingCode] = useState(false);
  const [changingCode, setChangingCode] = useState(false);
  const [changeCodeError, setChangeCodeError] = useState("");
  const [changeCodeChecking, setChangeCodeChecking] = useState(false);
  const [newUserPinCode, setNewUserPinCode] = useState("");
  const [newUserPinConfirm, setNewUserPinConfirm] = useState("");
  const [newUserPinError, setNewUserPinError] = useState("");
  const [unlockPinCode, setUnlockPinCode] = useState("");
  const [unlockSetCode, setUnlockSetCode] = useState("");
  const [unlockSetConfirm, setUnlockSetConfirm] = useState("");
  const [changeOldCode, setChangeOldCode] = useState("");
  const [changeNewCode, setChangeNewCode] = useState("");
  const [changeNewCodeConfirm, setChangeNewCodeConfirm] = useState("");
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [passphraseSetupNewParticipantId, setPassphraseSetupNewParticipantId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const storyPlaybackRef = useRef<HTMLAudioElement | null>(null); // Build 7: play shared story
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const skipSaveRef = useRef(false); // Build 4: set when user asked to forget this conversation
  const savingSessionRef = useRef(false); // prevent double submit on End session
  const enrollmentWavRecorderRef = useRef<WavRecorderRolling | null>(null);
  const enrollmentFollowUpIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const participantIdRef = useRef(participantId);
  participantIdRef.current = participantId;
  /** When starting from a conversation (or "Turn into story"), so confirm_story can send source_moment_id. */
  const sessionMomentIdRef = useRef<string | null>(null);
  const recallSessionsRef = useRef(recallSessions);
  const storyListRef = useRef(storyList);
  recallSessionsRef.current = recallSessions;
  storyListRef.current = storyList;

  useEffect(() => {
    apiGet<Participant[]>("/voice/participants")
      .then(setParticipants)
      .catch(() => setParticipants([]));
  }, []);

  // Sync global "I'm [Name]" from nav into this page when it changes (no dropdown here)
  useEffect(() => {
    const next = contextParticipantId ?? "";
    if (next !== participantId) {
      setParticipantId(next);
    }
  }, [contextParticipantId]);

  // When user changes "I'm [Name]": clear recall list so we never show another person's data; refetch only if this participant is unlocked
  useEffect(() => {
    setRecallSessions(null);
    setStoryList(null);
    if (!participantId) return;
    if (!isRecallUnlocked(participantId)) return;
    apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(participantId)}`)
      .then((sessions) => {
        const seen = new Set<string>();
        setRecallSessions(sessions.filter((s) => (!seen.has(s.id) && (seen.add(s.id), true))));
      })
      .catch(() => setRecallSessions([]));
    apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(participantId)}`)
      .then(setStoryList)
      .catch(() => setStoryList([]));
  }, [participantId]);

  const endSession = useCallback(() => {
    const pc = pcRef.current;
    if (pc) {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
      pcRef.current = null;
    }
    if (audioRef.current?.srcObject) {
      (audioRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      audioRef.current.srcObject = null;
    }
    const wavRec = enrollmentWavRecorderRef.current;
    if (wavRec) {
      wavRec.stop();
      enrollmentWavRecorderRef.current = null;
    }
    const iv = enrollmentFollowUpIntervalRef.current;
    if (iv) {
      clearInterval(iv);
      enrollmentFollowUpIntervalRef.current = null;
    }
    setStatus("idle");
    setMessage("");
    setContinuingFromTags(null);
  }, []);

  async function handleStart(momentId?: string, recallTags?: string[], storyId?: string) {
    sessionMomentIdRef.current = momentId ?? null;
    setRecallSessions(null);
    setStoryList(null);
    setContinuingFromTags(recallTags?.length ? recallTags : null);
    let effectiveParticipantId = participantId;
    let effectiveLabel: string | null = null;

    try {
      // Voice ID: try to identify from a short clip so we can greet by name with no visible setup
      const withVoiceProfile = participants.some((p) => p.has_voice_profile);
      if (!effectiveParticipantId && withVoiceProfile && !momentId && !storyId) {
        setStatus("identifying");
        setMessage("");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const identifyBlob = await recordWavForDuration(stream, 6000);
          const form = new FormData();
          form.append("audio", identifyBlob, "identify.wav");
          const result = await apiPostFormData<{ recognized: boolean; participant_id?: string; label?: string }>(
            "/voice/identify",
            form
          );
          if (result.recognized && result.participant_id) {
            effectiveParticipantId = result.participant_id;
            effectiveLabel = result.label ?? null;
            setParticipantId(result.participant_id);
          }
        } catch {
          // ignore identify errors; continue without participant_id
        }
      }

      setStatus("connecting");
      setMessage("");

      const data = await getRealtimeToken({
        participant_id: effectiveParticipantId || undefined,
        moment_id: storyId ? undefined : momentId,
        story_id: storyId,
      });
      if (data.stubbed) {
        setStatus("stubbed");
        setMessage(
          "Voice isn’t connected (no API key). Add OPENAI_API_KEY in the server .env to enable the voice companion."
        );
        return;
      }

      const ephemeralKey = data.value ?? data.client_secret;
      if (!ephemeralKey) {
        setStatus("error");
        setMessage("No token received from server.");
        return;
      }

      const audio = audioRef.current ?? document.createElement("audio");
      if (!audioRef.current) {
        audioRef.current = audio;
        audio.style.display = "none";
        document.body.appendChild(audio);
      }

      let stream: MediaStream | undefined;
      if (!effectiveParticipantId) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        enrollmentWavRecorderRef.current = createWavRecorderRolling(stream, 60);
      }

      const { pc, dc } = await connectRealtimeWebRTC(ephemeralKey, audio, stream);
      pcRef.current = pc;
      turnsRef.current = [];
      skipSaveRef.current = false;
      // Voice ID: send follow-up enrollment every 30s so profile can reach "Enrolled" in one session
      if (enrollmentWavRecorderRef.current && !enrollmentFollowUpIntervalRef.current) {
        enrollmentFollowUpIntervalRef.current = setInterval(() => {
          const pid = participantIdRef.current;
          const wavRec = enrollmentWavRecorderRef.current;
          const blob = wavRec?.getWavBlob();
          if (pid && blob) {
            const form = new FormData();
            form.append("audio", blob, "enroll.wav");
            apiPostFormData(`/voice/participants/${encodeURIComponent(pid)}/enroll`, form).catch(() => {});
          }
        }, 30000);
      }
      const transcriptByItemId = new Map<string, string>();
      // Build 4 & 7: tool calls — track current function call and arguments
      let pendingCallId: string | null = null;
      let pendingToolName: string | null = null;
      const playStoryArgsBuffer: string[] = [];

      dc.onmessage = async (event) => {
        try {
          const data = typeof event.data === "string" ? event.data : "";
          const lines = data.split("\n").filter(Boolean);
          if (lines.length === 0 && data.trim()) lines.push(data.trim());
          for (const line of lines) {
            const ev = JSON.parse(line) as {
              type?: string;
              item?: { id?: string; type?: string; role?: string; content?: unknown; name?: string };
              item_id?: string;
              output_item_id?: string;
              transcript?: string;
              delta?: string;
              arguments?: string;
            };
            if (ev?.type === "conversation.item.done" && ev.item?.role) {
              const text = extractTextFromContent(ev.item.content);
              if (text) turnsRef.current.push({ role: ev.item.role, content: text });
            }
            const t = ev?.type ?? "";
            if (t.includes("input_audio_transcription") && t.includes("delta") && typeof ev.delta === "string" && ev.item_id) {
              const prev = transcriptByItemId.get(ev.item_id) ?? "";
              transcriptByItemId.set(ev.item_id, prev + ev.delta);
            }
            if (t.includes("input_audio_transcription") && t.includes("completed")) {
              const transcript = typeof ev.transcript === "string" && ev.transcript.trim()
                ? ev.transcript.trim()
                : (ev.item_id ? transcriptByItemId.get(ev.item_id)?.trim() : "") ?? "";
              if (transcript) {
                turnsRef.current.push({ role: "user", content: transcript });
                if (ev.item_id) transcriptByItemId.delete(ev.item_id);
              }
            }
            // Build 4 & 7: tool calls
            if (t === "response.output_item.added" && ev.item?.type === "function_call") {
              pendingCallId = ev.item.id ?? null;
              pendingToolName = ev.item.name ?? null;
              if (ev.item?.name === "play_story" || ev.item?.name === "confirm_story") playStoryArgsBuffer.length = 0;
            }
            if (t === "response.function_call_arguments.delta" && typeof ev.delta === "string") {
              playStoryArgsBuffer.push(ev.delta);
            }
            if (t === "response.function_call_arguments.done") {
              const raw = typeof ev.arguments === "string" && ev.arguments.trim()
                ? ev.arguments.trim()
                : playStoryArgsBuffer.join("");
              const callId = pendingCallId;
              const toolName = pendingToolName;
              pendingCallId = null;
              pendingToolName = null;
              playStoryArgsBuffer.length = 0;
              if (!callId || dc.readyState !== "open") continue;
              const sendToolOutput = (output: string) => {
                const out = JSON.stringify({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } }) + "\n";
                dc.send(out);
              };
              const triggerResponse = () => {
                dc.send(JSON.stringify({ type: "response.create" }) + "\n");
              };
              if (toolName === "forget_current_conversation") {
                skipSaveRef.current = true;
                sendToolOutput(JSON.stringify({ result: "confirmed" }));
                continue;
              }
              if (toolName === "create_participant") {
                try {
                  const params = JSON.parse(raw || "{}") as { name?: string };
                  const name = (params?.name ?? "").trim() || "Someone";
                  const created = await apiPostWithTimeout<{ id: string; label: string }>(
                    "/voice/participants",
                    { label: name },
                    30000
                  );
                  setParticipantId(created.id);
                  setContextParticipantId(created.id);
                  refreshParticipants(created.id);
                  participantIdRef.current = created.id;
                  const wavRec = enrollmentWavRecorderRef.current;
                  const enrollBlob = wavRec?.getWavBlob();
                  if (enrollBlob) {
                    const form = new FormData();
                    form.append("audio", enrollBlob, "enroll.wav");
                    apiPostFormData(
                      `/voice/participants/${encodeURIComponent(created.id)}/enroll`,
                      form
                    ).catch(() => {});
                  }
                  sendToolOutput(
                    JSON.stringify({ participant_id: created.id, label: created.label, result: "created" })
                  );
                  triggerResponse();
                } catch (err) {
                  sendToolOutput(
                    JSON.stringify({ error: err instanceof Error ? err.message : "Could not create participant" })
                  );
                  triggerResponse();
                }
                continue;
              }
              if (toolName === "confirm_story") {
                try {
                  const params = JSON.parse(raw || "{}") as { story_text?: string };
                  const storyText = (params?.story_text ?? "").trim();
                  const pid = participantIdRef.current;
                  const sourceMomentId = sessionMomentIdRef.current;
                  if (!pid || !storyText) {
                    sendToolOutput(JSON.stringify({ error: "participant_id and story_text are required" }));
                    triggerResponse();
                    continue;
                  }
                  const body: { participant_id: string; story_text: string; source_moment_id?: string } = {
                    participant_id: pid,
                    story_text: storyText,
                  };
                  if (sourceMomentId) body.source_moment_id = sourceMomentId;
                  const created = await apiPostWithTimeout<{ id: string; title: string | null }>(
                    "/voice/stories/confirm",
                    body,
                    30000
                  );
                  refreshParticipants(pid);
                  apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`)
                    .then(setStoryList)
                    .catch(() => {});
                  sendToolOutput(
                    JSON.stringify({
                      result: "saved",
                      story_id: created.id,
                      title: created.title ?? "Voice story",
                      message_for_user:
                        "Your story is saved. You can find it in Recall past stories. When you're ready, you can move it to Shared Memories to share with the family. Say this to the user now.",
                    })
                  );
                  triggerResponse();
                } catch (err) {
                  sendToolOutput(JSON.stringify({ error: err instanceof Error ? err.message : "Could not save story" }));
                  triggerResponse();
                }
                continue;
              }
              if (toolName === "play_story") {
                try {
                  const params = JSON.parse(raw || "{}") as { moment_id?: string };
                  const momentId = params?.moment_id;
                  if (momentId) {
                    const currentParticipantId = participantIdRef.current;
                    apiGetWithTimeout<{ url: string }>(
                      `/voice/stories/shared/playback?moment_id=${encodeURIComponent(momentId)}`,
                      30000
                    )
                      .then(({ url }) => {
                        const storyEl = storyPlaybackRef.current ?? document.createElement("audio");
                        if (!storyPlaybackRef.current) {
                          storyPlaybackRef.current = storyEl;
                          storyEl.style.display = "none";
                          document.body.appendChild(storyEl);
                        }
                        storyEl.src = url;
                        storyEl.play().catch(() => {});
                        if (currentParticipantId) {
                          apiPost("/voice/stories/shared/listened", { participant_id: currentParticipantId, moment_id: momentId }).catch(() => {});
                        }
                        sendToolOutput(JSON.stringify({ result: "played" }));
                        triggerResponse();
                      })
                      .catch(() => {
                        sendToolOutput(JSON.stringify({ error: "Playback failed" }));
                        triggerResponse();
                      });
                  }
                } catch {
                  // ignore parse error
                }
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          endSession();
        }
      };

      setStatus("connected");
      setMessage("You’re live. Speak naturally — one question at a time. ");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Connection failed");
    }
  }

  return (
    <>
      <h1 className="page-title">Voice session</h1>
      <p className="page-lead">
        Talk with a gentle companion. One question at a time — we’ll listen and remember.
      </p>

      <div style={{ maxWidth: 400 }}>
        {status === "identifying" && (
          <p style={{ fontSize: 15, color: "var(--ink-muted)", marginBottom: 12 }}>
            Just a moment…
          </p>
        )}
        {status === "idle" && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleStart()}
              style={{ width: "100%", fontSize: "1.1rem", padding: "16px" }}
            >
              Start talking
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const pid = contextParticipantId ?? "";
                if (!pid) {
                  setRecallSessions([]);
                  setStoryList(null);
                  return;
                }
                if (!isRecallUnlocked(pid)) {
                  setRecallUnlockPending("conversations");
                  setPinError("");
                  return;
                }
                setStoryList(null);
                apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`)
                  .then((sessions) => {
                    const seen = new Set<string>();
                    setRecallSessions(sessions.filter((s) => (!seen.has(s.id) && (seen.add(s.id), true))));
                  })
                  .catch(() => setRecallSessions([]));
              }}
              style={{ width: "100%", marginTop: 8 }}
            >
              Recall a past conversation
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                const pid = contextParticipantId ?? "";
                if (!pid) {
                  setStoryList([]);
                  setRecallSessions(null);
                  return;
                }
                if (!isRecallUnlocked(pid)) {
                  setRecallUnlockPending("stories");
                  setPinError("");
                  return;
                }
                setRecallSessions(null);
                apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`)
                  .then(setStoryList)
                  .catch(() => setStoryList([]));
              }}
              style={{ width: "100%", marginTop: 4 }}
            >
              Recall past stories
            </button>
            {contextParticipantId && !changingCode && !settingCode && recallUnlockPending === null && (() => {
              const participant = contextParticipants.find((p) => p.id === contextParticipantId);
              const hasCode = !!participant?.recall_passphrase_set;
              return (
                <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12 }}
                    onClick={() => (hasCode ? (setChangingCode(true), setChangeCodeError(""), setChangeOldCode(""), setChangeNewCode(""), setChangeNewCodeConfirm("")) : (setSettingCode(true), setNewUserPinError(""), setNewUserPinCode(""), setNewUserPinConfirm("")))}
                  >
                    {hasCode ? "Change code" : "Set code"}
                  </button>
                </div>
              );
            })()}
            {recallUnlockPending !== null && (() => {
              const pid = contextParticipantId ?? "";
              const participant = contextParticipants.find((p) => p.id === pid);
              const isSetMode = !participant?.recall_passphrase_set;

              const handleUnlockSuccess = () => {
                if (pid) addRecallUnlocked(pid);
                setRecallUnlockPending(null);
                setPinError("");
                setUnlockPinCode("");
                setUnlockSetCode("");
                setUnlockSetConfirm("");
                if (recallUnlockPending === "conversations") {
                  setStoryList(null);
                  apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`)
                    .then((sessions) => {
                      const seen = new Set<string>();
                      setRecallSessions(sessions.filter((s) => (!seen.has(s.id) && (seen.add(s.id), true))));
                    })
                    .catch(() => setRecallSessions([]));
                } else {
                  setRecallSessions(null);
                  apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`)
                    .then(setStoryList)
                    .catch(() => setStoryList([]));
                }
              };

              if (isSetMode) {
                const valid = /^\d{4}$/.test(unlockSetCode) && unlockSetCode === unlockSetConfirm;
                const submitSet = () => {
                  setPinError("");
                  if (!/^\d{4}$/.test(unlockSetCode)) {
                    setPinError("Code must be 4 digits.");
                    return;
                  }
                  if (unlockSetCode !== unlockSetConfirm) {
                    setPinError("Codes don't match.");
                    return;
                  }
                  setPinChecking(true);
                  apiPatch(`/voice/participants/${encodeURIComponent(pid)}`, { recall_pin: unlockSetCode })
                    .then(() => {
                      refreshParticipants(pid);
                      handleUnlockSuccess();
                    })
                    .catch((err) => {
                      setPinError(err instanceof Error ? err.message : "Could not set code.");
                    })
                    .finally(() => setPinChecking(false));
                };
                return (
                  <div className="card" style={{ marginTop: 12, padding: 14 }}>
                    <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Choose your 4-digit code</p>
                    <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Enter a 4-digit code to protect your recall lists.</p>
                    <input type="password" inputMode="numeric" maxLength={4} placeholder="Code" value={unlockSetCode} onChange={(e) => setUnlockSetCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                    <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirm" value={unlockSetConfirm} onChange={(e) => setUnlockSetConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                    {pinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{pinError}</p>}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="btn btn-primary" onClick={submitSet} disabled={!valid || pinChecking}>{pinChecking ? "Saving…" : "Set code"}</button>
                      <button type="button" className="btn btn-ghost" onClick={() => { setRecallUnlockPending(null); setPinError(""); setUnlockSetCode(""); setUnlockSetConfirm(""); }}>Cancel</button>
                    </div>
                  </div>
                );
              }

              const submitUnlock = () => {
                setPinError("");
                if (!/^\d{4}$/.test(unlockPinCode)) {
                  setPinError("Code must be 4 digits.");
                  return;
                }
                setPinChecking(true);
                apiPost<{ ok: boolean }>(`/voice/participants/${encodeURIComponent(pid)}/verify-recall`, { code: unlockPinCode })
                  .then((res) => {
                    if (res.ok) handleUnlockSuccess();
                    else setPinError("Wrong code. Try again.");
                  })
                  .catch((err) => setPinError(err instanceof Error ? err.message : "Failed."))
                  .finally(() => setPinChecking(false));
              };
              return (
                <div className="card" style={{ marginTop: 12, padding: 14 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Enter your 4-digit code</p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Your recall lists are private. Enter your code to view them.</p>
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="Code" value={unlockPinCode} onChange={(e) => setUnlockPinCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  {pinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{pinError}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary" onClick={submitUnlock} disabled={unlockPinCode.length !== 4 || pinChecking}>{pinChecking ? "Checking…" : "Unlock"}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setRecallUnlockPending(null); setPinError(""); setUnlockPinCode(""); }}>Cancel</button>
                  </div>
                </div>
              );
            })()}
            {settingCode && contextParticipantId && (() => {
              const pid = contextParticipantId;
              const valid = /^\d{4}$/.test(newUserPinCode) && newUserPinCode === newUserPinConfirm;
              const submit = () => {
                setNewUserPinError("");
                if (!/^\d{4}$/.test(newUserPinCode)) {
                  setNewUserPinError("Code must be 4 digits.");
                  return;
                }
                if (newUserPinCode !== newUserPinConfirm) {
                  setNewUserPinError("Codes don't match.");
                  return;
                }
                setPinChecking(true);
                apiPatch(`/voice/participants/${encodeURIComponent(pid)}`, { recall_pin: newUserPinCode })
                  .then(() => {
                    refreshParticipants(pid);
                    setSettingCode(false);
                    setNewUserPinCode("");
                    setNewUserPinConfirm("");
                  })
                  .catch((err) => setNewUserPinError(err instanceof Error ? err.message : "Could not set code."))
                  .finally(() => setPinChecking(false));
              };
              return (
                <div className="card" style={{ marginTop: 12, padding: 14 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Set your 4-digit code</p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Enter a 4-digit code to protect your recall lists.</p>
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="Code" value={newUserPinCode} onChange={(e) => setNewUserPinCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirm" value={newUserPinConfirm} onChange={(e) => setNewUserPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  {newUserPinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{newUserPinError}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary" onClick={submit} disabled={!valid || pinChecking}>{pinChecking ? "Saving…" : "Set code"}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setSettingCode(false); setNewUserPinError(""); setNewUserPinCode(""); setNewUserPinConfirm(""); }}>Cancel</button>
                  </div>
                </div>
              );
            })()}
            {changingCode && contextParticipantId && (() => {
              const pid = contextParticipantId;
              const validNew = /^\d{4}$/.test(changeNewCode) && changeNewCode === changeNewCodeConfirm;
              const submitChange = () => {
                setChangeCodeError("");
                if (!/^\d{4}$/.test(changeOldCode)) {
                  setChangeCodeError("Current code must be 4 digits.");
                  return;
                }
                if (!/^\d{4}$/.test(changeNewCode)) {
                  setChangeCodeError("New code must be 4 digits.");
                  return;
                }
                if (changeNewCode !== changeNewCodeConfirm) {
                  setChangeCodeError("New codes don't match.");
                  return;
                }
                setChangeCodeChecking(true);
                apiPost<{ ok: boolean }>(`/voice/participants/${encodeURIComponent(pid)}/verify-recall`, { code: changeOldCode })
                  .then((res) => {
                    if (!res.ok) {
                      setChangeCodeError("Wrong current code.");
                      setChangeCodeChecking(false);
                      return;
                    }
                    return apiPatch(`/voice/participants/${encodeURIComponent(pid)}`, { recall_pin: changeNewCode });
                  })
                  .then((ok) => {
                    if (ok !== undefined) {
                      refreshParticipants(pid);
                      setChangingCode(false);
                      setChangeOldCode("");
                      setChangeNewCode("");
                      setChangeNewCodeConfirm("");
                      setChangeCodeError("");
                    }
                  })
                  .catch((err) => setChangeCodeError(err instanceof Error ? err.message : "Failed."))
                  .finally(() => setChangeCodeChecking(false));
              };
              return (
                <div className="card" style={{ marginTop: 12, padding: 14 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Change code</p>
                  <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Enter your current code, then your new 4-digit code twice.</p>
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="Current code" value={changeOldCode} onChange={(e) => setChangeOldCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="New code" value={changeNewCode} onChange={(e) => setChangeNewCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirm new code" value={changeNewCodeConfirm} onChange={(e) => setChangeNewCodeConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
                  {changeCodeError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{changeCodeError}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary" onClick={submitChange} disabled={!validNew || changeOldCode.length !== 4 || changeCodeChecking}>{changeCodeChecking ? "Checking…" : "Change code"}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => { setChangingCode(false); setChangeCodeError(""); setChangeOldCode(""); setChangeNewCode(""); setChangeNewCodeConfirm(""); }}>Cancel</button>
                  </div>
                </div>
              );
            })()}
            {recallSessions !== null && contextParticipantId && isRecallUnlocked(contextParticipantId) && (
              <div className="card" style={{ marginTop: 12, padding: 14 }}>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>
                  Recall a past conversation
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>
                  Continue a conversation or save one as a story to refine and share later.
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {recallSessions.length === 0 ? (
                    <li style={{ fontSize: 14, color: "var(--ink-muted)" }}>No past sessions yet.</li>
                  ) : (
                    recallSessions.map((s) => (
                      <li key={s.id} style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "stretch",
                            gap: 8,
                            minHeight: 44,
                          }}
                        >
                          <button
                            type="button"
                            className="btn"
                            style={{
                              flex: 1,
                              textAlign: "left",
                              padding: "12px 14px",
                              fontSize: 14,
                              minWidth: 0,
                            }}
                            onClick={() => handleStart(s.id, s.reminder_tags)}
                          >
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                              {formatSessionDateTime(s.created_at)}
                            </span>
                            {s.reminder_tags && s.reminder_tags.length > 0 && (
                              <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {s.reminder_tags.map((tag) => (
                                  <span
                                    key={tag}
                                    style={{
                                      fontSize: 11,
                                      padding: "2px 6px",
                                      background: "var(--success-bg)",
                                      color: "var(--ink-muted)",
                                      borderRadius: 4,
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              flexShrink: 0,
                              alignSelf: "center",
                              padding: "8px 10px",
                              fontSize: 11,
                              minWidth: 44,
                              minHeight: 44,
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!participantId) return;
                              handleStart(s.id, s.reminder_tags);
                            }}
                            title="Turn into story"
                            aria-label="Turn this conversation into a story with the voice agent"
                          >
                            Turn into story
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{
                              flexShrink: 0,
                              alignSelf: "center",
                              padding: "10px 12px",
                              fontSize: 12,
                              minWidth: 44,
                              minHeight: 44,
                              color: "var(--ink-muted)",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!participantId) return;
                              if (!window.confirm("Remove this conversation from the list?")) return;
                              apiDelete(
                                `/voice/sessions/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(participantId)}`
                              )
                                .then(() => {
                                  setRecallSessions((prev) => (prev ? prev.filter((x) => x.id !== s.id) : null));
                                })
                                .catch((err) => {
                                  setMessage(err instanceof Error ? err.message : "Could not remove.");
                                });
                            }}
                            title="Remove from list"
                            aria-label="Remove this conversation from the list"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 8, fontSize: 12 }}
                  onClick={() => setRecallSessions(null)}
                >
                  Cancel
                </button>
              </div>
            )}
            {storyList !== null && contextParticipantId && isRecallUnlocked(contextParticipantId) && (
              <div className="card" style={{ marginTop: 12, padding: 14 }}>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600 }}>
                  Recall past stories
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>
                  Your private stories. Tap one to refine with the voice agent, or Move to Shared Memories to share with the family.
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {storyList.length === 0 ? (
                    <li style={{ fontSize: 14, color: "var(--ink-muted)" }}>
                      No stories yet. Use <strong>Recall a past conversation</strong> and tap <strong>Turn into story</strong> to craft one with the voice agent, or create a story during a live conversation and confirm when you're happy with it.
                    </li>
                  ) : (
                    storyList.map((s) => {
                      const isEditingTitle = editingStoryId === s.id;
                      return (
                        <li key={s.id} style={{ marginBottom: 16 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <button
                              type="button"
                              className="btn"
                              style={{
                                textAlign: "left",
                                padding: "12px 14px",
                                fontSize: 14,
                                cursor: "pointer",
                                display: "block",
                                width: "100%",
                              }}
                              onClick={() => handleStart(undefined, undefined, s.id)}
                              title="Click to refine this story with the voice agent"
                            >
                              <span
                                style={{
                                  display: "block",
                                  fontSize: "0.95rem",
                                  fontWeight: 600,
                                  marginBottom: 6,
                                  wordBreak: "break-word",
                                  lineHeight: 1.3,
                                }}
                              >
                                {s.title?.trim() || "Untitled story"}
                              </span>
                              <span style={{ display: "block", fontSize: 12, color: "var(--ink-muted)", marginBottom: 6 }}>
                                {formatSessionDateTime(s.created_at)}
                              </span>
                              {(s.reminder_tags?.length ?? 0) > 0 && (
                                <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                  {s.reminder_tags!.map((tag) => (
                                    <span
                                      key={tag}
                                      style={{
                                        fontSize: 11,
                                        padding: "2px 6px",
                                        background: "var(--success-bg)",
                                        color: "var(--ink-muted)",
                                        borderRadius: 4,
                                      }}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </button>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: "8px 10px", fontSize: 12 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingStoryId(s.id);
                                  setEditingTitle(s.title?.trim() ?? "");
                                }}
                                title="Edit title"
                                aria-label="Edit story title"
                              >
                                Edit title
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: "8px 10px", fontSize: 12, fontWeight: 700 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!participantId) return;
                                  if (!window.confirm("Move this story to Shared Memories? It will be visible to the family.")) return;
                                  apiPost(
                                    `/voice/stories/${encodeURIComponent(s.id)}/share?participant_id=${encodeURIComponent(participantId)}`,
                                    {}
                                  )
                                    .then(() => {
                                      setStoryList((prev) => (prev ? prev.filter((x) => x.id !== s.id) : null));
                                    })
                                    .catch((err) => {
                                      setMessage(err instanceof Error ? err.message : "Could not share.");
                                    });
                                }}
                                title="Move to Shared Memories"
                                aria-label="Move this story to Shared Memories"
                              >
                                Move to Shared Memories
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-muted)" }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!participantId) return;
                                  if (!window.confirm("Delete this story?")) return;
                                  apiDelete(
                                    `/voice/stories/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(participantId)}`
                                  )
                                    .then(() => {
                                      setStoryList((prev) => (prev ? prev.filter((x) => x.id !== s.id) : null));
                                    })
                                    .catch((err) => {
                                      setMessage(err instanceof Error ? err.message : "Could not delete.");
                                    });
                                }}
                                title="Delete story"
                                aria-label="Delete this story"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                          {isEditingTitle && (
                            <div style={{ marginTop: 8, marginLeft: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                placeholder="Story title"
                                className="input"
                                style={{ flex: "1 1 200px", minWidth: 0, maxWidth: 320 }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const t = editingTitle.trim();
                                    if (!participantId || !t) return;
                                    apiPatch(`/voice/stories/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(participantId)}`, { title: t })
                                      .then(() => {
                                        setStoryList((prev) => prev ? prev.map((x) => (x.id === s.id ? { ...x, title: t } : x)) : null);
                                        setEditingStoryId(null);
                                        setEditingTitle("");
                                      })
                                      .catch((err) => setMessage(err instanceof Error ? err.message : "Could not update title."));
                                  }
                                  if (e.key === "Escape") {
                                    setEditingStoryId(null);
                                    setEditingTitle("");
                                  }
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-primary"
                                style={{ fontSize: 12 }}
                                onClick={() => {
                                  const t = editingTitle.trim();
                                  if (!participantId || !t) return;
                                  apiPatch(`/voice/stories/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(participantId)}`, { title: t })
                                    .then(() => {
                                      setStoryList((prev) => prev ? prev.map((x) => (x.id === s.id ? { ...x, title: t } : x)) : null);
                                      setEditingStoryId(null);
                                      setEditingTitle("");
                                    })
                                    .catch((err) => setMessage(err instanceof Error ? err.message : "Could not update title."));
                                }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost"
                                style={{ fontSize: 12 }}
                                onClick={() => {
                                  setEditingStoryId(null);
                                  setEditingTitle("");
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })
                  )}
                </ul>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 8, fontSize: 12 }}
                  onClick={() => setStoryList(null)}
                >
                  Cancel
                </button>
              </div>
            )}
          </>
        )}

        {status === "connecting" && (
          <p style={{ color: "var(--ink-muted)" }}>Connecting… (allow microphone if prompted)</p>
        )}

        {status === "connected" && (
          <>
            {continuingFromTags && continuingFromTags.length > 0 && (
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-muted)" }}>
                Continuing from: {continuingFromTags.join(", ")}
              </p>
            )}
            <div
              className="card"
              style={{
                background: "var(--success-bg)",
                color: "var(--success)",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: "1.25rem" }}>● Live</span>
              <p style={{ margin: "8px 0 0", color: "var(--ink-muted)", fontSize: 14 }}>
                {message}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                if (skipSaveRef.current) {
                  endSession();
                  return;
                }
                if (savingSessionRef.current) {
                  endSession();
                  return;
                }
                const turns = turnsRef.current;
                let currentParticipantId = participantIdRef.current;
                let weCreatedNewParticipant = false;
                // New User: create a participant so we can save the session and show it in recall
                if (!currentParticipantId && (turns.length > 0 || true)) {
                  try {
                    const created = await apiPost<{ id: string; label: string }>("/voice/participants", {
                      label: "New User",
                    });
                    currentParticipantId = created.id;
                    setParticipantId(created.id);
                    setContextParticipantId(created.id);
                    weCreatedNewParticipant = true;
                  } catch {
                    // continue; we may still end without saving
                  }
                }
                if (currentParticipantId && (turns.length > 0 || true)) {
                  savingSessionRef.current = true;
                  try {
                    const keywords = deriveKeywordsFromTurns(turns);
                    const summary = deriveSummaryFromTurns(turns);
                    await apiPost("/sessions/complete", {
                      participantId: currentParticipantId,
                      turns: turns.map((t) => ({ role: t.role, content: t.content })),
                      keywords: keywords.length > 0 ? keywords : undefined,
                      summary: summary || undefined,
                    });
                    refreshParticipants(currentParticipantId);
                    if (weCreatedNewParticipant) setPassphraseSetupNewParticipantId(currentParticipantId);
                  } catch {
                    // non-blocking; session still ends
                  } finally {
                    savingSessionRef.current = false;
                  }
                }
                endSession();
              }}
              style={{ width: "100%" }}
            >
              End session
            </button>
          </>
        )}

        {(status === "stubbed" || status === "error") && message && (
          <div
            role="alert"
            className="card"
            style={{
              marginBottom: 16,
              background: status === "error" ? "var(--error-bg)" : "var(--success-bg)",
              color: status === "error" ? "var(--error)" : "var(--ink-muted)",
            }}
          >
            <p style={{ margin: 0 }}>{message}</p>
            {status === "error" && (
              <p style={{ margin: "8px 0 0", fontSize: 12, opacity: 0.9 }}>
                Check browser console (F12) for full API response details.
              </p>
            )}
          </div>
        )}

        {(status === "stubbed" || status === "error") && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setStatus("idle"); setMessage(""); }}
            style={{ width: "100%" }}
          >
            Try again
          </button>
        )}
      </div>

      <div style={{ marginTop: 32 }}>
        <p style={{ marginTop: 8 }}>
          <Link href="/bank">Shared</Link> · <Link href="/">Home</Link>
        </p>
      </div>
    </>
  );
}
