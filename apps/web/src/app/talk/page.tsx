"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiPost, apiPostWithTimeout } from "@/lib/api";
import { connectRealtimeWebRTC, getRealtimeToken } from "@/lib/realtime";
import { createWavRecorderRolling, type WavRecorderRolling } from "@/lib/wavRecorder";
import { requestUploadUrl, completeUpload } from "@/lib/media";
import { useVoiceAgent } from "@/app/components/VoiceAgentContext";
import { useAuth } from "@/app/components/AuthContext";

type Status = "idle" | "connecting" | "listening" | "saving" | "saved" | "error";

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

const MAX_SESSION_SECONDS = 30 * 60; // 30 minutes hard cap to avoid runaway sessions
const UPLOAD_MAX_SECONDS = 30 * 60;

function TalkInner() {
  const { me } = useAuth();
  const { setIsListening } = useVoiceAgent();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [savedId, setSavedId] = useState<{ kind: "conversation" | "story"; id: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const recRef = useRef<WavRecorderRolling | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const skipSaveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const savingRef = useRef(false);

  const teardown = useCallback(() => {
    setIsListening(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const pc = pcRef.current;
    if (pc) {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
      pcRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (audio.srcObject) {
        (audio.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
        audio.srcObject = null;
      }
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const rec = recRef.current;
    if (rec) {
      rec.stop();
      recRef.current = null;
    }
  }, [setIsListening]);

  const persistConversation = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    const turns = [...turnsRef.current];
    const blob = recRef.current?.getWavBlob() ?? null;
    try {
      let audioAssetId: string | undefined;
      if (blob && blob.size > 1024) {
        try {
          const sas = await requestUploadUrl({
            type: "audio",
            contentType: "audio/wav",
            fileName: `conversation-${Date.now()}.wav`,
          });
          await fetch(sas.uploadUrl, {
            method: "PUT",
            headers: {
              "x-ms-blob-type": "BlockBlob",
              "Content-Type": "audio/wav",
            },
            body: blob,
          });
          const done = await completeUpload({
            blobUrl: sas.blobUrl,
            type: "audio",
            metadata: { source: "voice-session" },
          });
          audioAssetId = done.assetId;
        } catch (err) {
          console.warn("audio upload failed", err);
        }
      }
      const durationSec = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
      const saved = await apiPostWithTimeout<{ conversationId: string }>(
        "/sessions/complete",
        {
          audioAssetId,
          turns,
          sessionMeta: { duration_sec: Math.min(durationSec, UPLOAD_MAX_SECONDS) },
        },
        60000
      );
      setSavedId({ kind: "conversation", id: saved.conversationId });
      setStatus("saved");
      setMessage("Saved to your Library.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save this conversation.");
    } finally {
      savingRef.current = false;
    }
  }, []);

  const endSession = useCallback(async () => {
    const hadTurns = turnsRef.current.length > 0;
    teardown();
    if (skipSaveRef.current || !hadTurns) {
      setStatus("idle");
      setMessage(skipSaveRef.current ? "Okay, this conversation was not saved." : "");
      return;
    }
    setStatus("saving");
    setMessage("Saving your conversation…");
    await persistConversation();
  }, [persistConversation, teardown]);

  useEffect(() => {
    return () => teardown();
  }, [teardown]);

  const handleStart = useCallback(async () => {
    if (status !== "idle" && status !== "error" && status !== "saved") return;
    setSavedId(null);
    setMessage("");
    setStatus("connecting");
    skipSaveRef.current = false;
    turnsRef.current = [];
    try {
      const audio = audioRef.current ?? document.createElement("audio");
      if (!audioRef.current) {
        audioRef.current = audio;
        audio.style.display = "none";
        audio.autoplay = true;
        document.body.appendChild(audio);
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      recRef.current = createWavRecorderRolling(stream, UPLOAD_MAX_SECONDS);

      const conversationId = searchParams.get("conversation_id") || undefined;
      const storyId = searchParams.get("story_id") || undefined;

      const data = await getRealtimeToken({
        conversation_id: conversationId,
        story_id: storyId,
      });
      if (data.stubbed) {
        setStatus("error");
        setMessage("Voice isn't connected on this server. Please set OPENAI_API_KEY.");
        teardown();
        return;
      }
      const key = data.value ?? data.client_secret;
      if (!key) throw new Error("No realtime token received.");

      const { pc, dc } = await connectRealtimeWebRTC(key, audio, stream);
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          void endSession();
        }
      };

      const transcriptByItemId = new Map<string, string>();
      let pendingCallId: string | null = null;
      let pendingToolName: string | null = null;
      const toolArgsBuffer: string[] = [];

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
              call_id?: string;
              transcript?: string;
              delta?: string;
              arguments?: string;
            };
            const t = ev?.type ?? "";

            if (t === "conversation.item.done" && ev.item?.role) {
              const text = extractTextFromContent(ev.item.content);
              if (text) turnsRef.current.push({ role: ev.item.role, content: text });
            }
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

            // Tool-call plumbing
            if (t === "response.output_item.added" && ev.item?.type === "function_call") {
              pendingCallId = ev.item.id ?? null;
              pendingToolName = ev.item.name ?? null;
              toolArgsBuffer.length = 0;
            }
            if (t === "response.function_call_arguments.delta" && typeof ev.delta === "string") {
              toolArgsBuffer.push(ev.delta);
            }
            if (t === "response.function_call_arguments.done") {
              const raw = typeof ev.arguments === "string" && ev.arguments.trim()
                ? ev.arguments.trim()
                : toolArgsBuffer.join("");
              const callId = pendingCallId;
              const toolName = pendingToolName;
              pendingCallId = null;
              pendingToolName = null;
              toolArgsBuffer.length = 0;
              if (!callId || dc.readyState !== "open") continue;
              const sendToolOutput = (output: string) => {
                const out = JSON.stringify({
                  type: "conversation.item.create",
                  item: { type: "function_call_output", call_id: callId, output },
                }) + "\n";
                dc.send(out);
              };
              const triggerResponse = () => {
                dc.send(JSON.stringify({ type: "response.create" }) + "\n");
              };
              if (toolName === "forget_current_conversation") {
                skipSaveRef.current = true;
                sendToolOutput(JSON.stringify({ result: "confirmed" }));
                triggerResponse();
                continue;
              }
              if (toolName === "confirm_story") {
                try {
                  const params = JSON.parse(raw || "{}") as { story_text?: string };
                  const storyText = (params?.story_text ?? "").trim();
                  if (!storyText) {
                    sendToolOutput(JSON.stringify({ error: "story_text required" }));
                    triggerResponse();
                    continue;
                  }
                  const body: { story_text: string; source_conversation_id?: string } = { story_text: storyText };
                  const source = searchParams.get("conversation_id") || undefined;
                  if (source) body.source_conversation_id = source;
                  const created = await apiPostWithTimeout<{ id: string; title: string | null }>(
                    "/stories/confirm",
                    body,
                    30000
                  );
                  sendToolOutput(
                    JSON.stringify({
                      result: "saved",
                      story_id: created.id,
                      message_for_user: "Your story is saved. You can find it under Library.",
                    })
                  );
                  triggerResponse();
                  setSavedId({ kind: "story", id: created.id });
                  setStatus("saved");
                  setMessage("Your story is saved to your Library.");
                  // Keep session open briefly so the agent can speak the confirmation; user can end when ready.
                } catch (err) {
                  sendToolOutput(
                    JSON.stringify({ error: err instanceof Error ? err.message : "Could not save story" })
                  );
                  triggerResponse();
                }
                continue;
              }
            }
          }
        } catch {
          /* ignore parse errors */
        }
      };

      startedAtRef.current = Date.now();
      setElapsed(0);
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_SESSION_SECONDS) {
          void endSession();
        }
      }, 1000);

      setIsListening(true);
      setStatus("listening");
      setMessage("");
    } catch (err) {
      teardown();
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not start the session.");
    }
  }, [endSession, searchParams, setIsListening, status, teardown]);

  const mmss = (() => {
    const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  })();

  const micState =
    status === "listening" ? "listening" :
    status === "connecting" ? "connecting" :
    status === "saving" ? "saving" :
    "idle";

  const micLabel =
    status === "connecting" ? "Connecting…" :
    status === "listening" ? "Tap to end" :
    status === "saving" ? "Saving…" :
    status === "error" ? "Try again" :
    "Tap to talk";

  return (
    <>
      <h1 className="page-title">Talk</h1>
      <p className="page-lead">
        {me?.display_name ? `Hi ${me.display_name}. ` : ""}
        One question at a time. We&rsquo;ll listen and save privately.
      </p>

      <div className="talk-shell">
        <button
          type="button"
          className="talk-mic"
          data-state={micState}
          onClick={() => {
            if (status === "listening") void endSession();
            else if (status === "connecting" || status === "saving") return;
            else void handleStart();
          }}
          disabled={status === "connecting" || status === "saving"}
          aria-label={micLabel}
        >
          {micLabel}
          {status === "listening" ? (
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 500, opacity: 0.9 }}>{mmss}</div>
          ) : null}
        </button>

        {message ? (
          <div
            className={`msg ${status === "error" ? "msg-error" : status === "saved" ? "msg-success" : "msg-info"}`}
            role={status === "error" ? "alert" : "status"}
            style={{ width: "100%", maxWidth: 420 }}
          >
            {message}
          </div>
        ) : null}

        {status === "saved" && savedId ? (
          <div className="btn-row" style={{ justifyContent: "center", width: "100%" }}>
            <Link
              href={`/library/${savedId.kind === "story" ? "stories" : "conversations"}/${savedId.id}`}
              className="btn btn-primary"
            >
              Open in Library
            </Link>
            <button type="button" className="btn btn-ghost" onClick={() => void handleStart()}>
              Start another
            </button>
          </div>
        ) : null}
      </div>

      {status === "idle" ? (
        <p className="text-muted center" style={{ marginTop: 16, fontSize: 13 }}>
          You can end the session anytime. Say &ldquo;forget this&rdquo; to skip saving.
        </p>
      ) : null}
    </>
  );
}

export default function TalkPage() {
  return (
    <Suspense
      fallback={
        <div className="talk-shell">
          <p className="text-muted">Loading…</p>
        </div>
      }
    >
      <TalkInner />
    </Suspense>
  );
}
