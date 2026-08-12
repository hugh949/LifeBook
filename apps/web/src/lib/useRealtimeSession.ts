"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiPostWithTimeout } from "@/lib/api";
import { connectRealtimeWebRTC, getRealtimeToken, getAgentPack } from "@/lib/realtime";
import { createWavRecorderRolling, type WavRecorderRolling } from "@/lib/wavRecorder";
import { requestUploadUrl, completeUpload } from "@/lib/media";
import { useVoiceAgent } from "@/app/components/VoiceAgentContext";

export type SessionStatus = "idle" | "connecting" | "listening" | "saving" | "saved" | "error";
export type AgentMode = "conversing" | "storytelling" | "curating";
export type Turn = { role: string; content: string };

const MAX_SESSION_SECONDS = 30 * 60;
const UPLOAD_MAX_SECONDS = 30 * 60;

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

export type UseRealtimeSessionOptions = {
  conversationId?: string | null;
  storyId?: string | null;
  /** Fixed studio mode — handoffs stay within related modes unless allowHandoff */
  mode: AgentMode;
  /** Persist conversation turns on end (Conversation studio) */
  persistConversation?: boolean;
  /** Allow ready_for_story / return_to_conversation mode switches */
  allowHandoff?: boolean;
  onTurnsChange?: (turns: Turn[]) => void;
  onStorySaved?: (storyId: string) => void;
  onConversationSaved?: (conversationId: string) => void;
  onReadyForScript?: () => void;
  onCurateChoice?: (choice: { bgm_track?: string; narration_tone?: string; reason?: string }) => void;
  /** Called when a talk session is about to connect (stop competing audio) */
  onBeforeStart?: () => void;
};

export function useRealtimeSession(options: UseRealtimeSessionOptions) {
  const { mode: fixedMode } = options;

  const { setIsListening } = useVoiceAgent();
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [message, setMessage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [agentMode, setAgentMode] = useState<AgentMode>(fixedMode);
  const [liveTurns, setLiveTurns] = useState<Turn[]>([]);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const recRef = useRef<WavRecorderRolling | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const skipSaveRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const savingRef = useRef(false);
  const agentModeRef = useRef<AgentMode>(fixedMode);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const statusRef = useRef<SessionStatus>("idle");
  statusRef.current = status;
  /** Monotonic session generation — bumps on start attempt and on hard stop */
  const sessionGenRef = useRef(0);
  const startingRef = useRef(false);
  const endingRef = useRef(false);

  const pushTurn = useCallback((turn: Turn) => {
    turnsRef.current.push(turn);
    const next = [...turnsRef.current];
    setLiveTurns(next);
    optionsRef.current.onTurnsChange?.(next);
  }, []);

  const teardown = useCallback(() => {
    setIsListening(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const dc = dcRef.current;
    dcRef.current = null;
    if (dc) {
      try {
        if (dc.readyState === "open") {
          dc.send(JSON.stringify({ type: "response.cancel" }) + "\n");
        }
      } catch {
        /* ignore */
      }
      try {
        dc.onmessage = null;
        dc.close();
      } catch {
        /* ignore */
      }
    }

    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) {
      try {
        pc.onconnectionstatechange = null;
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.getSenders().forEach((s) => {
          try {
            s.track?.stop();
          } catch {
            /* ignore */
          }
        });
        pc.getReceivers().forEach((r) => {
          try {
            r.track?.stop();
          } catch {
            /* ignore */
          }
        });
        pc.close();
      } catch {
        /* ignore */
      }
    }

    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.muted = true;
        if (audio.srcObject) {
          (audio.srcObject as MediaStream).getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          });
          audio.srcObject = null;
        }
        audio.removeAttribute("src");
        audio.load();
        audio.muted = false;
      } catch {
        /* ignore */
      }
    }

    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }

    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
  }, [setIsListening]);

  const persist = useCallback(async () => {
    if (savingRef.current) return;
    if (!optionsRef.current.persistConversation) {
      setStatus("idle");
      return;
    }
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
            headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "audio/wav" },
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
      const saved = await apiPostWithTimeout<{ conversationId: string; status?: string }>(
        "/sessions/complete",
        {
          conversation_id: optionsRef.current.conversationId || undefined,
          audioAssetId,
          turns,
          sessionMeta: { duration_sec: Math.min(durationSec, UPLOAD_MAX_SECONDS) },
        },
        60000
      );
      setStatus("saved");
      setMessage(
        saved.status === "updated"
          ? "Continued and saved on this conversation."
          : "Saved privately for you."
      );
      turnsRef.current = [];
      setLiveTurns([]);
      optionsRef.current.onConversationSaved?.(saved.conversationId);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save this conversation.");
    } finally {
      savingRef.current = false;
    }
  }, []);

  const endSession = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    startingRef.current = false;
    // Invalidate any in-flight start() so late awaits cannot revive the session
    sessionGenRef.current += 1;
    const hadTurns = turnsRef.current.length > 0;
    teardown();
    try {
      if (skipSaveRef.current || !hadTurns) {
        setStatus("idle");
        setMessage(skipSaveRef.current ? "Okay, this conversation was not saved." : "");
        return;
      }
      if (!optionsRef.current.persistConversation) {
        setStatus("idle");
        setMessage("");
        return;
      }
      setStatus("saving");
      setMessage("Saving your conversation…");
      await persist();
    } finally {
      endingRef.current = false;
    }
  }, [persist, teardown]);

  useEffect(() => () => {
    sessionGenRef.current += 1;
    teardown();
  }, [teardown]);

  const start = useCallback(async () => {
    const cur = statusRef.current;
    if (startingRef.current || endingRef.current) return;
    if (cur !== "idle" && cur !== "error" && cur !== "saved") return;

    startingRef.current = true;
    optionsRef.current.onBeforeStart?.();
    const gen = ++sessionGenRef.current;
    setMessage("");
    setStatus("connecting");
    skipSaveRef.current = false;
    turnsRef.current = [];
    setLiveTurns([]);
    const mode = optionsRef.current.mode;
    agentModeRef.current = mode;
    setAgentMode(mode);

    try {
      // Tear down any leftover peer before opening a new one
      teardown();
      if (gen !== sessionGenRef.current) return;

      const audio = audioRef.current ?? document.createElement("audio");
      if (!audioRef.current) {
        audioRef.current = audio;
        audio.style.display = "none";
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
      audio.muted = false;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (gen !== sessionGenRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      recRef.current = createWavRecorderRolling(stream, UPLOAD_MAX_SECONDS);

      const conversationId = optionsRef.current.conversationId || undefined;
      const storyId = optionsRef.current.storyId || undefined;

      const data = await getRealtimeToken({
        conversation_id: conversationId,
        story_id: storyId,
        mode,
      });
      if (gen !== sessionGenRef.current) return;

      if (data.stubbed) {
        setStatus("error");
        setMessage("Voice isn't connected on this server. Please set OPENAI_API_KEY.");
        teardown();
        return;
      }
      const key = data.value ?? data.client_secret;
      if (!key) throw new Error("No realtime token received.");

      const { pc, dc } = await connectRealtimeWebRTC(key, audio, stream);
      if (gen !== sessionGenRef.current) {
        try {
          dc.close();
        } catch {
          /* ignore */
        }
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      pcRef.current = pc;
      dcRef.current = dc;
      pc.onconnectionstatechange = () => {
        if (gen !== sessionGenRef.current) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          void endSession();
        }
      };

      const kickoffGreeting = () => {
        if (gen !== sessionGenRef.current) return;
        if (dc.readyState !== "open") return;
        try {
          dc.send(JSON.stringify({ type: "response.create" }) + "\n");
        } catch (err) {
          console.warn("greeting kickoff failed", err);
        }
      };
      if (dc.readyState === "open") kickoffGreeting();
      else dc.addEventListener("open", kickoffGreeting, { once: true });

      const applyAgentMode = async (next: AgentMode) => {
        if (gen !== sessionGenRef.current) return;
        if (dc.readyState !== "open") return;
        try {
          const pack = await getAgentPack(next, {
            conversation_id: conversationId,
            story_id: storyId,
          });
          if (gen !== sessionGenRef.current || dc.readyState !== "open") return;
          dc.send(
            JSON.stringify({
              type: "session.update",
              session: {
                instructions: pack.instructions,
                tools: pack.tools,
                tool_choice: "auto",
              },
            }) + "\n"
          );
          agentModeRef.current = pack.mode;
          setAgentMode(pack.mode);
        } catch (err) {
          console.warn("agent handoff failed", err);
        }
      };

      const transcriptByItemId = new Map<string, string>();
      let pendingCallId: string | null = null;
      let pendingToolName: string | null = null;
      const toolArgsBuffer: string[] = [];

      dc.onmessage = async (event) => {
        if (gen !== sessionGenRef.current) return;
        try {
          const rawData = typeof event.data === "string" ? event.data : "";
          const lines = rawData.split("\n").filter(Boolean);
          if (lines.length === 0 && rawData.trim()) lines.push(rawData.trim());
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
              if (text) pushTurn({ role: ev.item.role, content: text });
            }
            if (
              t.includes("input_audio_transcription") &&
              t.includes("delta") &&
              typeof ev.delta === "string" &&
              ev.item_id
            ) {
              const prev = transcriptByItemId.get(ev.item_id) ?? "";
              transcriptByItemId.set(ev.item_id, prev + ev.delta);
            }
            if (t.includes("input_audio_transcription") && t.includes("completed")) {
              const transcript =
                typeof ev.transcript === "string" && ev.transcript.trim()
                  ? ev.transcript.trim()
                  : (ev.item_id ? transcriptByItemId.get(ev.item_id)?.trim() : "") ?? "";
              if (transcript) {
                pushTurn({ role: "user", content: transcript });
                if (ev.item_id) transcriptByItemId.delete(ev.item_id);
              }
            }

            if (t === "response.output_item.added" && ev.item?.type === "function_call") {
              pendingCallId = ev.item.id ?? null;
              pendingToolName = ev.item.name ?? null;
              toolArgsBuffer.length = 0;
            }
            if (t === "response.function_call_arguments.delta" && typeof ev.delta === "string") {
              toolArgsBuffer.push(ev.delta);
            }
            if (t === "response.function_call_arguments.done") {
              const raw =
                typeof ev.arguments === "string" && ev.arguments.trim()
                  ? ev.arguments.trim()
                  : toolArgsBuffer.join("");
              const callId = pendingCallId;
              const toolName = pendingToolName;
              pendingCallId = null;
              pendingToolName = null;
              toolArgsBuffer.length = 0;
              if (!callId || dc.readyState !== "open" || gen !== sessionGenRef.current) continue;
              const sendToolOutput = (output: string) => {
                if (dc.readyState !== "open" || gen !== sessionGenRef.current) return;
                dc.send(
                  JSON.stringify({
                    type: "conversation.item.create",
                    item: { type: "function_call_output", call_id: callId, output },
                  }) + "\n"
                );
              };
              const triggerResponse = () => {
                if (dc.readyState !== "open" || gen !== sessionGenRef.current) return;
                dc.send(JSON.stringify({ type: "response.create" }) + "\n");
              };

              if (toolName === "forget_current_conversation") {
                skipSaveRef.current = true;
                sendToolOutput(JSON.stringify({ result: "confirmed" }));
                triggerResponse();
                continue;
              }
              if (toolName === "ready_for_story") {
                sendToolOutput(JSON.stringify({ result: "handoff", mode: "storytelling" }));
                if (optionsRef.current.allowHandoff) {
                  await applyAgentMode("storytelling");
                }
                optionsRef.current.onReadyForScript?.();
                triggerResponse();
                continue;
              }
              if (toolName === "return_to_conversation") {
                sendToolOutput(JSON.stringify({ result: "handoff", mode: "conversing" }));
                if (optionsRef.current.allowHandoff) {
                  await applyAgentMode("conversing");
                }
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
                  const body: {
                    story_text: string;
                    source_conversation_id?: string;
                    story_id?: string;
                  } = { story_text: storyText };
                  if (optionsRef.current.conversationId)
                    body.source_conversation_id = optionsRef.current.conversationId;
                  if (optionsRef.current.storyId) body.story_id = optionsRef.current.storyId;
                  const created = await apiPostWithTimeout<{ id: string }>(
                    "/stories/confirm",
                    body,
                    30000
                  );
                  if (gen !== sessionGenRef.current) return;
                  sendToolOutput(
                    JSON.stringify({
                      result: "saved",
                      story_id: created.id,
                      message_for_user:
                        "Script saved. You can keep refining here, then Curate when ready.",
                    })
                  );
                  triggerResponse();
                  setMessage("Script saved.");
                  optionsRef.current.onStorySaved?.(created.id);
                } catch (err) {
                  sendToolOutput(
                    JSON.stringify({
                      error: err instanceof Error ? err.message : "Could not save story",
                    })
                  );
                  triggerResponse();
                }
                continue;
              }
              if (toolName === "set_curate_choice") {
                try {
                  const params = JSON.parse(raw || "{}") as {
                    bgm_track?: string;
                    narration_tone?: string;
                    reason?: string;
                  };
                  const choice: {
                    bgm_track?: string;
                    narration_tone?: string;
                    reason?: string;
                  } = {};
                  const track = (params.bgm_track || "").trim().toLowerCase();
                  const tone = (params.narration_tone || "").trim().toLowerCase();
                  const reason = (params.reason || "").trim();
                  if (track) choice.bgm_track = track;
                  if (tone) choice.narration_tone = tone;
                  if (reason) choice.reason = reason;
                  if (!choice.bgm_track && !choice.narration_tone) {
                    sendToolOutput(
                      JSON.stringify({ error: "Provide bgm_track and/or narration_tone" })
                    );
                    triggerResponse();
                    continue;
                  }
                  optionsRef.current.onCurateChoice?.(choice);
                  sendToolOutput(
                    JSON.stringify({
                      result: "applied",
                      ...choice,
                      ready_to_listen: true,
                      message_for_user:
                        "Choice saved. Invite them to end talk if needed, then Listen again.",
                    })
                  );
                  triggerResponse();
                  setMessage("Curate choice applied — ready to re-listen.");
                } catch (err) {
                  sendToolOutput(
                    JSON.stringify({
                      error: err instanceof Error ? err.message : "Could not apply curate choice",
                    })
                  );
                  triggerResponse();
                }
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
        if (gen !== sessionGenRef.current) return;
        const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(s);
        if (s >= MAX_SESSION_SECONDS) void endSession();
      }, 1000);

      if (gen !== sessionGenRef.current) {
        teardown();
        return;
      }
      setIsListening(true);
      setStatus("listening");
      setMessage("");
    } catch (err) {
      if (gen === sessionGenRef.current) {
        teardown();
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Could not start the session.");
      }
    } finally {
      startingRef.current = false;
    }
  }, [endSession, pushTurn, setIsListening, teardown]);

  useEffect(() => {
    agentModeRef.current = fixedMode;
    setAgentMode(fixedMode);
  }, [fixedMode]);

  const mmss = (() => {
    const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  })();

  const discardWithoutSaving = useCallback(async () => {
    skipSaveRef.current = true;
    sessionGenRef.current += 1;
    startingRef.current = false;
    teardown();
    turnsRef.current = [];
    setLiveTurns([]);
    setStatus("idle");
    setMessage("Okay, this talk was not saved.");
  }, [teardown]);

  return {
    status,
    message,
    setMessage,
    agentMode,
    liveTurns,
    elapsed,
    mmss,
    start,
    endSession,
    discardWithoutSaving,
    isBusy: status === "connecting" || status === "saving",
    isListening: status === "listening",
  };
}
