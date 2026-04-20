"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiDelete } from "@/lib/api";
import ShareSheet from "@/app/components/ShareSheet";

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
};

type Comment = {
  id: string;
  share_id: string;
  recipient_name: string;
  text: string;
  created_at: string;
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

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";
  const router = useRouter();
  const [data, setData] = useState<ConversationDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    apiGet<ConversationDetail>(`/library/conversations/${encodeURIComponent(id)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this conversation."));
    apiGet<Comment[]>(`/library/conversations/${encodeURIComponent(id)}/comments`)
      .then(setComments)
      .catch(() => setComments([]));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const onDelete = async () => {
    if (!confirm("Delete this conversation? This cannot be undone.")) return;
    try {
      await apiDelete(`/library/conversations/${encodeURIComponent(id)}`);
      router.replace("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    }
  };

  if (error) {
    return (
      <>
        <h1 className="page-title">Conversation</h1>
        <div className="msg msg-error" role="alert">{error}</div>
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

  return (
    <>
      <p style={{ marginBottom: 10 }}><Link href="/library">← Library</Link></p>
      <h1 className="page-title">{data.title || "Voice conversation"}</h1>
      <p className="text-muted" style={{ margin: "0 0 14px" }}>{formatDate(data.created_at)}</p>

      {data.tags.length ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {data.tags.map((t) => (<span key={t} className="row-chip">{t}</span>))}
        </div>
      ) : null}

      {data.audio_url ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <audio controls src={data.audio_url} style={{ width: "100%" }} preload="metadata">
            Your browser doesn&rsquo;t support audio playback.
          </audio>
        </div>
      ) : null}

      <div className="btn-row" style={{ marginBottom: 20 }}>
        <button className="btn btn-primary" onClick={() => setShareOpen(true)}>Share</button>
        <Link className="btn btn-ghost" href={`/talk?conversation_id=${encodeURIComponent(data.id)}`}>Continue</Link>
        <button className="btn btn-danger" onClick={onDelete}>Delete</button>
      </div>

      {data.summary ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Summary</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{data.summary}</p>
        </div>
      ) : null}

      {data.turns.length ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Transcript</div>
          <div className="stack-8">
            {data.turns.map((t, i) => (
              <div key={i} style={{ fontSize: 14 }}>
                <span style={{ fontWeight: 600, color: t.role === "user" ? "var(--primary)" : "var(--ink-muted)" }}>
                  {t.role === "user" ? "You" : "Companion"}
                </span>
                <span className="text-muted">: </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{t.content}</span>
              </div>
            ))}
          </div>
        </div>
      ) : data.transcript ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Transcript</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14 }}>{data.transcript}</p>
        </div>
      ) : null}

      <div className="section-title">Comments from recipients</div>
      {comments.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 14 }}>No comments yet.</p>
      ) : (
        <div className="stack-8">
          {comments.map((c) => (
            <div key={c.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <strong>{c.recipient_name}</strong>
                <span className="text-faint" style={{ fontSize: 12 }}>{formatDate(c.created_at)}</span>
              </div>
              <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{c.text}</p>
            </div>
          ))}
        </div>
      )}

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        targetType="conversation"
        targetId={data.id}
      />
    </>
  );
}
