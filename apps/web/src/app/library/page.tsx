"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiDelete, apiGet } from "@/lib/api";

type LibraryItem = {
  id: string;
  kind: "conversation" | "story";
  title: string | null;
  summary: string | null;
  excerpt?: string | null;
  tags: string[];
  created_at: string;
  updated_at?: string;
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
    blurb: "Opens Conversation on the story screen. Script, Curate, and Share stay there.",
  },
  {
    id: "stories",
    label: "Scripts",
    blurb: "Opens Script on the same screen. Edit, hear, then Curate or Share when you choose.",
  },
  {
    id: "shared",
    label: "Shared",
    blurb:
      "Opens Share so you can revise the script and create a new link. Remove an old link when that access should stop.",
  },
];

function formatStamp(iso: string): string {
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

function looksLikeRawId(value: string): boolean {
  const s = value.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(s) ||
    /^[0-9a-f]{32}$/i.test(s) ||
    /^[0-9a-f]{16,}$/i.test(s)
  );
}

function clip(text: string, limit = 80): string {
  const raw = text.replace(/\s+/g, " ").trim();
  if (raw.length <= limit) return raw;
  const cut = raw.slice(0, limit - 1).replace(/\s+\S*$/, "").trim();
  return `${cut.length >= 24 ? cut : raw.slice(0, limit - 1).trim()}…`;
}

function recallName(it: LibraryItem): string {
  const title = (it.title || "").trim();
  if (title && !looksLikeRawId(title)) return title;
  const excerpt = (it.excerpt || "").trim();
  if (excerpt && !looksLikeRawId(excerpt)) return clip(excerpt);
  const summary = (it.summary || "").trim();
  if (summary && !looksLikeRawId(summary)) return clip(summary);
  return it.kind === "story" ? "Untitled script" : "Untitled conversation";
}

function stampOf(it: LibraryItem): string {
  return it.updated_at || it.created_at || "";
}

function itemHref(it: LibraryItem, tab: TabId): string {
  if (it.kind === "conversation") {
    return `/library/conversations/${it.id}?stage=conversation`;
  }
  const stage = tab === "shared" ? "share" : "script";
  return `/library/stories/${it.id}?stage=${stage}`;
}

function byNewest(a: LibraryItem, b: LibraryItem): number {
  const as = stampOf(a);
  const bs = stampOf(b);
  if (as === bs) return 0;
  return as < bs ? 1 : -1;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("conversations");
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

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
    const filtered =
      tab === "conversations"
        ? items.filter((it) => it.kind === "conversation")
        : tab === "stories"
          ? items.filter((it) => it.kind === "story")
          : items.filter((it) => it.kind === "story" && it.has_share);
    return [...filtered].sort(byNewest);
  }, [items, tab]);

  const activeBlurb = TABS.find((t) => t.id === tab)?.blurb ?? "";

  const needsScript = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => it.kind === "conversation" && !it.script_id).sort(byNewest);
  }, [items]);

  const needsCurate = useMemo(() => {
    if (!items) return [];
    return items.filter((it) => it.kind === "story" && !it.has_photo && !it.has_share).sort(byNewest);
  }, [items]);

  const onDelete = async (it: LibraryItem) => {
    const key = `${it.kind}:${it.id}`;
    setDeletingKey(key);
    setError(null);
    try {
      const path =
        it.kind === "conversation"
          ? `/library/conversations/${encodeURIComponent(it.id)}`
          : `/library/stories/${encodeURIComponent(it.id)}`;
      await apiDelete(path);
      setConfirmKey(null);
      setItems((prev) =>
        (prev || []).filter((row) => !(row.kind === it.kind && row.id === it.id))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <>
      <h1 className="page-title">Library</h1>
      <p className="page-lead">
        Your personal vault. Open any item and stay on one screen for Conversation, Script, Curate,
        and Share.
      </p>

      <div className="library-tabs" role="tablist" aria-label="Library sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "library-tab is-active" : "library-tab"}
            onClick={() => {
              setTab(t.id);
              setConfirmKey(null);
            }}
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
              href={`/library/conversations/${needsScript[0].id}?stage=conversation`}
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
              ? "Nothing shared yet. Finish a script you love listening to, then create a link from Share."
              : tab === "stories"
                ? "No scripts yet. Finish a talk and the script is written for you."
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
            const href = itemHref(it, tab);
            const name = recallName(it);
            const key = `${it.kind}:${it.id}`;
            const when = formatStamp(stampOf(it));
            const blurb = (it.summary || it.excerpt || "").trim();
            const showBlurb = blurb && blurb !== name && !looksLikeRawId(blurb);
            const confirming = confirmKey === key;
            return (
              <article key={key} className="library-card">
                <Link href={href} className="library-card-main row-main">
                  <div className="row-title">{name}</div>
                  {when ? <div className="row-time">{when}</div> : null}
                  {showBlurb ? <div className="row-sub">{blurb}</div> : null}
                  <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className="row-chip">{it.kind === "story" ? "script" : "conversation"}</span>
                    {it.kind === "conversation" && it.script_id ? (
                      <span className="row-chip">Script ready</span>
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
                  </div>
                </Link>
                {confirming ? (
                  <div className="library-confirm" role="group" aria-label={`Confirm delete ${name}`}>
                    <p>Delete “{name}”? This cannot be undone.</p>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirmKey(null)}
                        disabled={deletingKey === key}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => void onDelete(it)}
                        disabled={deletingKey === key}
                      >
                        {deletingKey === key ? "Deleting…" : "Delete permanently"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row">
                    <Link className="btn btn-primary" href={href}>
                      {tab === "shared" ? "Revise & share" : "Open"}
                    </Link>
                    <button type="button" className="btn btn-danger" onClick={() => setConfirmKey(key)}>
                      Delete
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
