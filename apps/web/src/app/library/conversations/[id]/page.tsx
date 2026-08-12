"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiDelete, apiPost } from "@/lib/api";
import StageShell from "@/app/components/StageShell";
import VoiceDock from "@/app/components/VoiceDock";
import { useRealtimeSession } from "@/lib/useRealtimeSession";

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

export default function ConversationStudioPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const router = useRouter();
  const [data, setData] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const pendingDeriveRef = useRef(false);

  const load = useCallback(() => {
    if (!id) return;
    apiGet<ConversationDetail>(`/library/conversations/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this conversation."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onDerive = useCallback(async () => {
    setDeriving(true);
    setError(null);
    setStatusNote("Making your Script…");
    try {
      const story = await apiPost<{ id: string }>(
        `/library/conversations/${encodeURIComponent(id)}/derive-script`,
        {}
      );
      router.push(`/library/stories/${encodeURIComponent(story.id)}?stage=script`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not derive a script.");
      setStatusNote(null);
      setDeriving(false);
    }
  }, [id, router]);

  const session = useRealtimeSession({
    conversationId: id,
    mode: "conversing",
    persistConversation: true,
    allowHandoff: false,
    onConversationSaved: () => {
      load();
      setStatusNote("Saved on this conversation.");
    },
    onReadyForScript: () => {
      pendingDeriveRef.current = true;
    },
  });

  useEffect(() => {
    if (!pendingDeriveRef.current) return;
    if (session.isListening || session.isBusy) {
      void session.endSession();
      return;
    }
    pendingDeriveRef.current = false;
    void onDerive();
  }, [session.isListening, session.isBusy, session.status, session.endSession, onDerive]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.turns, session.liveTurns, session.isListening]);

  const onDelete = async () => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await apiDelete(`/library/conversations/${encodeURIComponent(id)}`);
      router.replace("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  if (error && !data) {
    return (
      <>
        <h1 className="page-title">Conversation</h1>
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
        <h1 className="page-title">Conversation</h1>
        <p className="text-muted">Loading…</p>
      </>
    );
  }

  const inVoice =
    session.isListening || session.status === "connecting" || session.status === "saving";
  const displayTurns = inVoice
    ? [...(data.turns || []), ...session.liveTurns]
    : data.turns || [];

  const coach = inVoice
    ? "Keep going until the topic feels emptied out. Exact transcript grows below."
    : data.script_id
      ? "We can keep talking — or open your Script / refresh it when you’re ready."
      : "We can keep going — or shape a Script when you feel ready.";

  return (
    <>
      <p style={{ marginBottom: 4 }}>
        <Link href="/library">← Library</Link>
      </p>

      <StageShell
        stage="conversation"
        conversationId={data.id}
        scriptId={data.script_id}
        title={data.title || "Conversation Studio"}
        coach={coach}
        dock={
          <VoiceDock
            agentLabel="Conversation"
            coachHint="Talk here — the transcript stays on this page."
            status={session.status}
            message={session.message}
            mmss={session.mmss}
            isBusy={session.isBusy}
            isListening={session.isListening}
            onStart={() => void session.start()}
            onEnd={() => void session.endSession()}
          />
        }
      >
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          {formatDate(data.created_at)} · Exact transcript · Private
        </p>

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

        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={session.isBusy || session.isListening}
            onClick={() => void session.start()}
          >
            Continue
          </button>
          {session.isListening ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void session.endSession()}
            >
              End &amp; save
            </button>
          ) : null}
          {session.isListening ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void session.discardWithoutSaving()}
            >
              Don&rsquo;t save this talk
            </button>
          ) : null}
          {data.script_id ? (
            <Link
              className="btn btn-ghost"
              href={`/library/stories/${encodeURIComponent(data.script_id)}?stage=script`}
            >
              Open Script
            </Link>
          ) : null}
          <button className="btn btn-danger" type="button" onClick={() => void onDelete()}>
            Delete
          </button>
        </div>

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
          ) : data.transcript ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{data.transcript}</p>
          ) : (
            <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
              No words yet — start talking with Conversation below.
            </p>
          )}
        </div>

        {data.audio_url ? (
          <audio controls src={data.audio_url} style={{ width: "100%" }} preload="metadata">
            Your browser doesn&rsquo;t support audio playback.
          </audio>
        ) : null}

        {data.summary ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
            Quick recall: {data.summary}
          </p>
        ) : null}

        <div className="ceremony-next detail-next">
          <p className="detail-next-label">When you&rsquo;re ready</p>
          <p className="detail-next-title">I&rsquo;m ready for a Script</p>
          <p className="detail-next-text">
            We&rsquo;ll shape a professional script from this transcript. You can edit and hear it next —
            Curate and Share come after.
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => void onDerive()}
              disabled={deriving || session.isListening || displayTurns.length === 0}
            >
              {deriving
                ? "Making Script…"
                : data.script_id
                  ? "Refresh Script from talk"
                  : "I'm ready for a Script"}
            </button>
          </div>
        </div>
      </StageShell>
    </>
  );
}
