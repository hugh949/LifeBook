"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPatch } from "@/lib/api";

export function AddComment({ momentId }: { momentId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    try {
      await apiPatch(`/moments/${momentId}`, { add_comment: trimmed });
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card" style={{ marginTop: 24, maxWidth: 640 }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 8px" }}>Add a comment</h2>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: "0 0 12px" }}>
        Add a note or memory about this moment — you can type here or add voice later.
      </p>
      <form onSubmit={handleSubmit}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
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
        {error && (
          <p role="alert" style={{ color: "var(--error)", fontSize: 14, margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          {sending ? "Adding…" : "Add comment"}
        </button>
      </form>
    </section>
  );
}
