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
    label: "Talks",
    blurb: "Talks you have recorded. Open one to hear it or turn it into a story.",
  },
  {
    id: "stories",
    label: "Stories",
    blurb: "Stories written from your talks. Open one to listen or share it.",
  },
  {
    id: "shared",
    label: "Shared",
    blurb: "Stories your family can open with a link.",
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
      <h1 className="page-title">Memories</h1>
      <p className="page-lead">Open a memory, or record a new one. Nothing is shared until you say so.</p>

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
              ? "Nothing shared yet. Open a story, then share it with your family."
              : tab === "stories"
                ? "No stories yet. Record a talk and a story is written for you."
                : "No talks yet. Record a memory when you are ready."}
          </p>
          {tab !== "shared" ? (
            <p style={{ marginTop: 12 }}>
              <Link href="/talk" className="btn btn-primary">
                Record a memory
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
            const blurb = clip((it.summary || it.excerpt || "").trim(), 110);
            const showBlurb = Boolean(blurb) && blurb !== name && !looksLikeRawId(blurb);
            const confirming = confirmKey === key;
            return (
              <article key={key} className="library-card">
                <Link href={href} className="library-card-main row-main">
                  <div className="row-title">{name}</div>
                  {when ? <div className="row-time">{when}</div> : null}
                  {showBlurb ? <div className="row-sub">{blurb}</div> : null}
                  {it.has_share ? (
                    <div style={{ marginTop: 6 }}>
                      <span className="row-chip">Shared with family</span>
                    </div>
                  ) : null}
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
                  <>
                    <Link className="btn btn-primary btn-block" href={href}>
                      Open
                    </Link>
                    <button type="button" className="stage-quiet-delete" onClick={() => setConfirmKey(key)}>
                      Delete
                    </button>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
