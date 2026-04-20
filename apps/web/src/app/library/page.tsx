"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";

type LibraryItem = {
  id: string;
  kind: "conversation" | "story";
  title: string | null;
  summary: string | null;
  tags: string[];
  created_at: string;
  has_audio: boolean;
  has_share: boolean;
};

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<LibraryItem[]>("/library")
      .then(setItems)
      .catch((e) => {
        setItems([]);
        setError(e instanceof Error ? e.message : "Could not load your library.");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <h1 className="page-title">Library</h1>
      <p className="page-lead">Your private conversations and stories.</p>

      {error ? <div className="msg msg-error" role="alert">{error}</div> : null}

      {items === null ? (
        <div className="empty-state"><p className="text-muted">Loading…</p></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">🗒️</div>
          <p>No memories yet.</p>
          <p style={{ marginTop: 12 }}>
            <Link href="/talk" className="btn btn-primary">Start your first conversation</Link>
          </p>
        </div>
      ) : (
        <div className="row-list">
          {items.map((it) => {
            const href = `/library/${it.kind === "story" ? "stories" : "conversations"}/${it.id}`;
            return (
              <Link key={`${it.kind}:${it.id}`} href={href} className="row-item">
                <div className="row-main">
                  <div className="row-title">
                    {it.title || (it.kind === "story" ? "Untitled story" : "Voice conversation")}
                  </div>
                  <div className="row-sub">
                    {it.summary || (it.kind === "story" ? "Story" : "Conversation")}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="row-chip">{it.kind}</span>
                    {it.has_share ? <span className="row-chip">shared</span> : null}
                    <span className="row-chip" style={{ background: "transparent", color: "var(--ink-faint)" }}>
                      {formatDate(it.created_at)}
                    </span>
                  </div>
                </div>
                <div aria-hidden="true" style={{ color: "var(--ink-faint)", fontSize: 20 }}>›</div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
