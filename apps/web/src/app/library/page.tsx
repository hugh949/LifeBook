"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  script_id?: string | null;
  has_photo?: boolean;
  source_conversation_id?: string | null;
};

type TabId = "conversations" | "stories" | "shared";

const TABS: {
  id: TabId;
  label: string;
  blurb: string;
}[] = [
  {
    id: "conversations",
    label: "Conversations",
    blurb:
      "Continue in Conversation Studio — exact transcripts stay private. Next: Ready for a Script.",
  },
  {
    id: "stories",
    label: "Scripts",
    blurb:
      "Open Script Studio to edit and hear, then Finish Curate (music, tone, voice, one photo). Share later is optional.",
  },
  {
    id: "shared",
    label: "Shared",
    blurb:
      "Only Scripts you’ve shared. Control who can listen (and see the photo). Revoke anytime.",
  },
];

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

function itemHref(it: LibraryItem): string {
  if (it.kind === "conversation") {
    return `/library/conversations/${it.id}`;
  }
  // Shared or photo-touched scripts open Curate; fresh scripts open Script Studio.
  if (it.has_share || it.has_photo) {
    return `/library/stories/${it.id}?stage=curate`;
  }
  return `/library/stories/${it.id}?stage=script`;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("conversations");

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

  const visible = useMemo(() => {
    if (!items) return null;
    if (tab === "conversations") return items.filter((it) => it.kind === "conversation");
    if (tab === "stories") return items.filter((it) => it.kind === "story");
    return items.filter((it) => it.kind === "story" && it.has_share);
  }, [items, tab]);

  const activeBlurb = TABS.find((t) => t.id === tab)?.blurb ?? "";

  const needsScript = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => it.kind === "conversation" && !it.script_id);
  }, [items]);

  const needsCurate = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => it.kind === "story" && !it.has_photo && !it.has_share);
  }, [items]);

  return (
    <>
      <h1 className="page-title">Library</h1>
      <p className="page-lead">
        Your personal vault. Conversations stay private. Only Scripts can be shared — when you choose.
      </p>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "library-tab is-active" : "library-tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="library-tab-blurb" role="note">
        {activeBlurb}
      </p>

      {error ? (
        <div className="msg msg-error" role="alert">
          {error}
        </div>
      ) : null}

      {items && tab === "conversations" && needsScript.length > 0 ? (
        <div className="library-nudge" role="status">
          <p>
            {needsScript.length === 1
              ? "You have a conversation ready for a Script."
              : `${needsScript.length} conversations are ready for a Script.`}
          </p>
          <div className="btn-row">
            <Link
              href={`/library/conversations/${needsScript[0].id}`}
              className="btn btn-primary"
            >
              Continue in Conversation
            </Link>
          </div>
        </div>
      ) : null}

      {items && tab === "stories" && needsCurate.length > 0 ? (
        <div className="library-nudge" role="status">
          <p>Finish Curate — music, tone, voice, optional photo — before sharing.</p>
          <div className="btn-row">
            <Link
              href={`/library/stories/${needsCurate[0].id}?stage=curate`}
              className="btn btn-primary"
            >
              Finish Curate
            </Link>
          </div>
        </div>
      ) : null}

      {visible === null ? (
        <div className="empty-state">
          <p className="text-muted">Loading…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">
            🗒️
          </div>
          <p>
            {tab === "shared"
              ? "Nothing shared yet. Finish Curate on a Script you love listening to first."
              : tab === "stories"
                ? "No scripts yet. Open a Conversation and choose I’m ready for a Script."
                : "No conversations yet. Start a new memory on Create."}
          </p>
          {tab !== "shared" ? (
            <p style={{ marginTop: 12 }}>
              <Link href="/talk" className="btn btn-primary">
                Start a new memory
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="row-list">
          {visible.map((it) => {
            const href = itemHref(it);
            return (
              <Link key={`${it.kind}:${it.id}`} href={href} className="row-item">
                <div className="row-main">
                  <div className="row-title">
                    {it.title || (it.kind === "story" ? "Untitled script" : "Voice conversation")}
                  </div>
                  <div className="row-sub">
                    {it.summary || (it.kind === "story" ? "Script" : "Exact transcript")}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="row-chip">{it.kind === "story" ? "script" : "conversation"}</span>
                    {it.kind === "conversation" && it.script_id ? (
                      <span className="row-chip">Open Script</span>
                    ) : null}
                    {it.kind === "conversation" && !it.script_id ? (
                      <span className="row-chip">Continue in Conversation</span>
                    ) : null}
                    {it.kind === "story" && !it.has_share ? (
                      <span className="row-chip">
                        {it.has_photo ? "Open Curate" : "Open Script"}
                      </span>
                    ) : null}
                    {it.has_photo ? <span className="row-chip">photo</span> : null}
                    {it.has_share ? (
                      <span className="row-chip">shared</span>
                    ) : (
                      <span
                        className="row-chip"
                        style={{ background: "transparent", color: "var(--ink-faint)" }}
                      >
                        only you
                      </span>
                    )}
                    <span
                      className="row-chip"
                      style={{ background: "transparent", color: "var(--ink-faint)" }}
                    >
                      {formatDate(it.created_at)}
                    </span>
                  </div>
                </div>
                <div aria-hidden="true" style={{ color: "var(--ink-faint)", fontSize: 20 }}>
                  ›
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
