"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParticipantIdentity } from "@/app/components/ParticipantIdentity";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

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

export default function MyMemoriesPage() {
  const { participantId: contextParticipantId, refreshParticipants, participants: contextParticipants, listReady } = useParticipantIdentity();
  const [recallUnlockPending, setRecallUnlockPending] = useState<"conversations" | "stories" | null>(null);
  const [pinError, setPinError] = useState("");
  const [pinChecking, setPinChecking] = useState(false);
  const [unlockPinCode, setUnlockPinCode] = useState("");
  const [settingCode, setSettingCode] = useState(false);
  const [newUserPinCode, setNewUserPinCode] = useState("");
  const [newUserPinConfirm, setNewUserPinConfirm] = useState("");
  const [newUserPinError, setNewUserPinError] = useState("");
  const [sessions, setSessions] = useState<VoiceSession[] | null>(null);
  const [stories, setStories] = useState<VoiceStory[] | null>(null);
  const [editingStoryId, setEditingStoryId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [mobileTab, setMobileTab] = useState<"conversations" | "stories">("conversations");

  const pid = contextParticipantId ?? "";
  const unlocked = pid && isRecallUnlocked(pid);
  const participant = pid ? contextParticipants.find((p) => p.id === pid) : null;
  const hasCode = !!participant?.recall_passphrase_set;

  useEffect(() => {
    if (!unlocked || !pid) return;
    apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`)
      .then((list) => setSessions(list || []))
      .catch(() => setSessions([]));
    apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`)
      .then((list) => setStories(list || []))
      .catch(() => setStories([]));
  }, [unlocked, pid]);

  const handleUnlockSuccess = () => {
    if (pid) addRecallUnlocked(pid);
    setRecallUnlockPending(null);
    setPinError("");
    setUnlockPinCode("");
    if (pid) {
      apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`)
        .then((list) => setSessions(list || []))
        .catch(() => setSessions([]));
      apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`)
        .then((list) => setStories(list || []))
        .catch(() => setStories([]));
    }
  };

  if (!listReady) {
    return (
      <>
        <h1 className="page-title">My Memories</h1>
        <p className="page-lead">Loading…</p>
      </>
    );
  }

  if (!pid) {
    return (
      <>
        <h1 className="page-title">My Memories</h1>
        <p className="page-lead">Choose who you are in the menu above (I&rsquo;m …), then return here to see your past conversations and stories.</p>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link href="/talk/session">Create Memories</Link> · <Link href="/bank">Shared Memories</Link> · <Link href="/">Home</Link>
        </p>
      </>
    );
  }

  if (!unlocked && !recallUnlockPending && !settingCode) {
    return (
      <>
        <h1 className="page-title">My Memories</h1>
        <p className="page-lead">Recall past voice conversations and stories you&rsquo;ve saved.</p>
        <div className="talk-idle-actions" style={{ maxWidth: 400 }}>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "100%" }}
            onClick={() => { setRecallUnlockPending("conversations"); setPinError(""); }}
          >
            Recall past conversations
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: "100%" }}
            onClick={() => { setRecallUnlockPending("stories"); setPinError(""); }}
          >
            Recall past stories
          </button>
          {hasCode && (
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-muted)" }}>Enter your 4-digit code to view your lists.</p>
          )}
          {!hasCode && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", marginTop: 8, fontSize: 12 }}
              onClick={() => { setSettingCode(true); setNewUserPinError(""); setNewUserPinCode(""); setNewUserPinConfirm(""); }}
            >
              Set a 4-digit code to protect your lists
            </button>
          )}
        </div>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link href="/talk/session">Create Memories</Link> · <Link href="/bank">Shared Memories</Link> · <Link href="/">Home</Link>
        </p>
      </>
    );
  }

  if (recallUnlockPending && !settingCode) {
    // Participant has no code set — show set-code form instead of unlock (backend returns 400 "No code set" otherwise)
    if (!hasCode) {
      const valid = /^\d{4}$/.test(newUserPinCode) && newUserPinCode === newUserPinConfirm;
      const submitSet = () => {
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
            addRecallUnlocked(pid);
            setRecallUnlockPending(null);
            setNewUserPinCode("");
            setNewUserPinConfirm("");
            if (pid) {
              apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`).then((list) => setSessions(list || [])).catch(() => setSessions([]));
              apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`).then((list) => setStories(list || [])).catch(() => setStories([]));
            }
          })
          .catch((err) => setNewUserPinError(err instanceof Error ? err.message : "Could not set code."))
          .finally(() => setPinChecking(false));
      };
      return (
        <>
          <h1 className="page-title">My Memories</h1>
          <div className="card" style={{ maxWidth: 360, marginTop: 12, padding: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Set a 4-digit code first</p>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>You haven&rsquo;t set a code yet. Set one now to view your recall lists.</p>
            <input type="password" inputMode="numeric" maxLength={4} placeholder="Code" value={newUserPinCode} onChange={(e) => setNewUserPinCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
            <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirm" value={newUserPinConfirm} onChange={(e) => setNewUserPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
            {newUserPinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{newUserPinError}</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" onClick={submitSet} disabled={!valid || pinChecking}>{pinChecking ? "Saving…" : "Set code"}</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setRecallUnlockPending(null); setNewUserPinError(""); setNewUserPinCode(""); setNewUserPinConfirm(""); }}>Cancel</button>
            </div>
          </div>
          <p style={{ marginTop: 24, fontSize: 14 }}><Link href="/talk/session">Create Memories</Link> · <Link href="/">Home</Link></p>
        </>
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
      <>
        <h1 className="page-title">My Memories</h1>
        <div className="card" style={{ maxWidth: 360, marginTop: 12, padding: 14 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Enter your 4-digit code</p>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Your recall lists are private.</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Code"
            value={unlockPinCode}
            onChange={(e) => setUnlockPinCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="input"
            style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }}
          />
          {pinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{pinError}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={submitUnlock} disabled={unlockPinCode.length !== 4 || pinChecking}>
              {pinChecking ? "Checking…" : "Unlock"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setRecallUnlockPending(null); setPinError(""); setUnlockPinCode(""); }}>Cancel</button>
          </div>
        </div>
        <p style={{ marginTop: 24, fontSize: 14 }}>
          <Link href="/talk/session">Create Memories</Link> · <Link href="/">Home</Link>
        </p>
      </>
    );
  }

  if (settingCode) {
    const valid = /^\d{4}$/.test(newUserPinCode) && newUserPinCode === newUserPinConfirm;
    const submitSet = () => {
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
          addRecallUnlocked(pid);
          setSettingCode(false);
          setNewUserPinCode("");
          setNewUserPinConfirm("");
          if (pid) {
            apiGet<VoiceSession[]>(`/voice/sessions?participant_id=${encodeURIComponent(pid)}`).then((list) => setSessions(list || [])).catch(() => setSessions([]));
            apiGet<VoiceStory[]>(`/voice/stories?participant_id=${encodeURIComponent(pid)}`).then((list) => setStories(list || [])).catch(() => setStories([]));
          }
        })
        .catch((err) => setNewUserPinError(err instanceof Error ? err.message : "Could not set code."))
        .finally(() => setPinChecking(false));
    };
    return (
      <>
        <h1 className="page-title">My Memories</h1>
        <div className="card" style={{ maxWidth: 360, marginTop: 12, padding: 14 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>Set your 4-digit code</p>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--ink-muted)" }}>Protect your recall lists.</p>
          <input type="password" inputMode="numeric" maxLength={4} placeholder="Code" value={newUserPinCode} onChange={(e) => setNewUserPinCode(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
          <input type="password" inputMode="numeric" maxLength={4} placeholder="Confirm" value={newUserPinConfirm} onChange={(e) => setNewUserPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} className="input" style={{ marginBottom: 8, width: "100%", boxSizing: "border-box" }} />
          {newUserPinError && <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--error)" }}>{newUserPinError}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" onClick={submitSet} disabled={!valid || pinChecking}>{pinChecking ? "Saving…" : "Set code"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setSettingCode(false); setNewUserPinError(""); setNewUserPinCode(""); setNewUserPinConfirm(""); }}>Cancel</button>
          </div>
        </div>
        <p style={{ marginTop: 24, fontSize: 14 }}><Link href="/talk/session">Create Memories</Link> · <Link href="/">Home</Link></p>
      </>
    );
  }

  // Unlocked: two-column (desktop) / tabs (mobile)
  const sessionList = (
    <div className="card" style={{ padding: 14, height: "100%" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600 }}>Recall past conversations</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-muted)" }}>Continue or turn into a story with the voice agent.</p>
      {sessions === null ? (
        <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>No past conversations yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {sessions.map((s) => (
            <li key={s.id} style={{ marginBottom: 10 }}>
              <div className="talk-recall-item">
                <Link
                  href={`/talk/session?moment_id=${encodeURIComponent(s.id)}`}
                  className="btn talk-recall-primary"
                  style={{ display: "block", textAlign: "left", textDecoration: "none", color: "inherit" }}
                >
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{formatSessionDateTime(s.created_at)}</span>
                  {s.reminder_tags?.length > 0 && (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {s.reminder_tags.map((tag) => (
                        <span key={tag} style={{ fontSize: 11, padding: "2px 6px", background: "var(--success-bg)", color: "var(--ink-muted)", borderRadius: 4 }}>{tag}</span>
                      ))}
                    </span>
                  )}
                </Link>
                <div className="talk-recall-secondary">
                  <Link href={`/talk/session?moment_id=${encodeURIComponent(s.id)}`} className="btn btn-ghost" style={{ fontSize: 12 }}>Turn into story</Link>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 12, color: "var(--ink-muted)" }}
                    onClick={() => {
                      if (!window.confirm("Remove this conversation from the list?")) return;
                      apiDelete(`/voice/sessions/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(pid)}`)
                        .then(() => setSessions((prev) => (prev ? prev.filter((x) => x.id !== s.id) : [])))
                        .catch(() => {});
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const storyListEl = (
    <div className="card" style={{ padding: 14, height: "100%" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 600 }}>Recall past stories</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-muted)" }}>Refine with the voice agent or move to Shared Memories.</p>
      {stories === null ? (
        <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>Loading…</p>
      ) : stories.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--ink-muted)" }}>No stories yet. Create one from a conversation or during a voice session.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {stories.map((s) => {
            const isEditing = editingStoryId === s.id;
            return (
              <li key={s.id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <Link
                    href={`/talk/session?story_id=${encodeURIComponent(s.id)}`}
                    className="btn"
                    style={{ textAlign: "left", padding: "12px 14px", fontSize: 14, textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>{s.title?.trim() || "Untitled story"}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink-muted)" }}>{formatSessionDateTime(s.created_at)}</span>
                    {s.reminder_tags?.length > 0 && (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        {s.reminder_tags.map((tag) => (
                          <span key={tag} style={{ fontSize: 11, padding: "2px 6px", background: "var(--success-bg)", color: "var(--ink-muted)", borderRadius: 4 }}>{tag}</span>
                        ))}
                      </span>
                    )}
                  </Link>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditingStoryId(s.id); setEditingTitle(s.title?.trim() ?? ""); }}>Edit title</button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, fontWeight: 700 }}
                      onClick={() => {
                        if (!window.confirm("Move this story to Shared Memories?")) return;
                        apiPost(`/voice/stories/${encodeURIComponent(s.id)}/share?participant_id=${encodeURIComponent(pid)}`, {})
                          .then(() => setStories((prev) => (prev ? prev.filter((x) => x.id !== s.id) : [])))
                          .catch(() => {});
                      }}
                    >
                      Move to Shared Memories
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ fontSize: 12, color: "var(--ink-muted)" }}
                      onClick={() => {
                        if (!window.confirm("Delete this story?")) return;
                        apiDelete(`/voice/stories/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(pid)}`)
                          .then(() => setStories((prev) => (prev ? prev.filter((x) => x.id !== s.id) : [])))
                          .catch(() => {});
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  {isEditing && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        placeholder="Story title"
                        className="input"
                        style={{ flex: "1 1 200px", minWidth: 0 }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ fontSize: 12 }}
                        onClick={() => {
                          const t = editingTitle.trim();
                          if (!t) return;
                          apiPatch(`/voice/stories/${encodeURIComponent(s.id)}?participant_id=${encodeURIComponent(pid)}`, { title: t })
                            .then(() => {
                              setStories((prev) => prev ? prev.map((x) => (x.id === s.id ? { ...x, title: t } : x)) : []);
                              setEditingStoryId(null);
                              setEditingTitle("");
                            })
                            .catch(() => {});
                        }}
                      >
                        Save
                      </button>
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditingStoryId(null); setEditingTitle(""); }}>Cancel</button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <h1 className="page-title">My Memories</h1>
      <p className="page-lead">Your past conversations and stories.</p>

      {/* Mobile: tab switcher + single column */}
      <div
        className="memories-mobile-tabs"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
          maxWidth: 400,
          marginBottom: 12,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
        role="tablist"
        aria-label="Conversations or Stories"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "conversations"}
          onClick={() => setMobileTab("conversations")}
          style={{
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            background: mobileTab === "conversations" ? "var(--success-bg)" : "var(--bg)",
            color: mobileTab === "conversations" ? "var(--ink)" : "var(--ink-muted)",
          }}
        >
          Conversations
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === "stories"}
          onClick={() => setMobileTab("stories")}
          style={{
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 600,
            border: "none",
            background: mobileTab === "stories" ? "var(--success-bg)" : "var(--bg)",
            color: mobileTab === "stories" ? "var(--ink)" : "var(--ink-muted)",
          }}
        >
          Stories
        </button>
      </div>

      {/* Desktop: two columns side by side. Mobile: single column, only active tab (handled below with CSS) */}
      <div
        className="memories-desktop-grid"
        style={{
          display: "none",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {sessionList}
        {storyListEl}
      </div>
      <div className="memories-mobile-content" style={{ display: "block", maxWidth: 400 }}>
        {mobileTab === "conversations" ? sessionList : storyListEl}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @media (min-width: 640px) {
          .memories-mobile-tabs { display: none !important; }
          .memories-mobile-content { display: none !important; }
          .memories-desktop-grid { display: grid !important; }
        }
        @media (max-width: 639px) {
          .memories-desktop-grid { display: none !important; }
        }
      `}} />

      <p style={{ marginTop: 24, fontSize: 14 }}>
        <Link href="/talk/session">Create Memories</Link> · <Link href="/bank">Shared Memories</Link> · <Link href="/">Home</Link>
      </p>
    </>
  );
}
