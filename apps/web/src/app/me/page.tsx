"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";
import AgentTeam from "@/app/components/AgentTeam";

type VoiceStatus = { status: string; voice_id: string | null; consent_at: string | null; error: string | null };
type AvatarStatus = { status: string; original_url: string | null; pencil_url: string | null; error: string | null };

type LearnedItem = { id?: string; text?: string; source?: string; at?: string };
type PrefsPayload = {
  prefs: {
    tone?: string;
    story_length?: string;
    topics_to_avoid?: string;
    language?: string;
    preferred_bgm?: string;
    themes?: string[];
    learned_summary?: string;
    learned_items?: LearnedItem[];
    notes?: string;
    corrections?: Array<string | { text?: string; kind?: string }>;
    last_learned_at?: string;
    last_learned_source?: string;
  };
  has_memory?: boolean;
};

function labelFor(kind: "voice" | "avatar", status: string, ready: boolean): { label: string; tone: "success" | "info" | "error" } {
  if (ready) return { label: "Ready", tone: "success" };
  if (status === "failed") return { label: kind === "voice" ? "Failed" : "Failed", tone: "error" };
  if (status === "processing" || status === "pencilizing" || status === "recording") return { label: "In progress", tone: "info" };
  return { label: "Not set up", tone: "info" };
}

function formatLearnedWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function MePage() {
  const { me, refresh, signout, setMe } = useAuth();
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [avatar, setAvatar] = useState<AvatarStatus | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [prefsData, setPrefsData] = useState<PrefsPayload | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsBusy, setPrefsBusy] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true);
    setPrefsError(null);
    try {
      const data = await apiGet<PrefsPayload>("/me/preferences");
      setPrefsData(data);
    } catch {
      setPrefsData(null);
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  const load = useCallback(() => {
    apiGet<VoiceStatus>("/me/voice").then(setVoice).catch(() => setVoice(null));
    apiGet<AvatarStatus>("/me/avatar").then(setAvatar).catch(() => setAvatar(null));
    void loadPrefs();
  }, [loadPrefs]);

  useEffect(() => { load(); }, [load]);

  const onRename = async (e: FormEvent) => {
    e.preventDefault();
    setNameError(null);
    setSavingName(true);
    try {
      const updated = await apiPatch<Me>("/auth/me", { display_name: nameDraft.trim() });
      setMe(updated);
      setEditingName(false);
      await refresh();
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not update your name.");
    } finally {
      setSavingName(false);
    }
  };

  const dismissItem = async (item: LearnedItem) => {
    setPrefsBusy(true);
    setPrefsError(null);
    try {
      const updated = await apiPatch<PrefsPayload>("/me/preferences", {
        dismiss_item_id: item.id || undefined,
        dismiss_item_text: item.text || undefined,
      });
      setPrefsData(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : "Could not update memory.");
    } finally {
      setPrefsBusy(false);
    }
  };

  const clearMemory = async () => {
    if (!window.confirm("Clear everything LifeBook has learned about your preferences? This cannot be undone.")) {
      return;
    }
    setPrefsBusy(true);
    setPrefsError(null);
    try {
      await apiDelete("/me/preferences");
      setPrefsData({ prefs: {}, has_memory: false });
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : "Could not clear memory.");
    } finally {
      setPrefsBusy(false);
    }
  };

  const addManualNote = async () => {
    const text = window.prompt("Optional note for LifeBook (private to you):");
    if (!text?.trim()) return;
    setPrefsBusy(true);
    setPrefsError(null);
    try {
      const updated = await apiPatch<PrefsPayload>("/me/preferences", { remember: text.trim() });
      setPrefsData(updated);
    } catch (err) {
      setPrefsError(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      setPrefsBusy(false);
    }
  };

  const voiceReady = voice?.status === "ready";
  const avatarReady = avatar?.status === "ready";
  const prefs = prefsData?.prefs || {};
  const learnedItems = Array.isArray(prefs.learned_items) ? prefs.learned_items.filter((i) => i?.text) : [];
  const themes = Array.isArray(prefs.themes) ? prefs.themes.filter(Boolean) : [];
  const hasMemory = Boolean(prefsData?.has_memory);
  const learnedWhen = formatLearnedWhen(prefs.last_learned_at);

  const factRows: Array<{ label: string; value: string }> = [];
  if (prefs.tone) factRows.push({ label: "Tone", value: prefs.tone });
  if (prefs.story_length) factRows.push({ label: "Story length", value: prefs.story_length });
  if (prefs.language) factRows.push({ label: "Language", value: prefs.language });
  if (prefs.topics_to_avoid) factRows.push({ label: "Treat gently", value: prefs.topics_to_avoid });
  if (prefs.preferred_bgm) factRows.push({ label: "Listen mood", value: prefs.preferred_bgm });

  return (
    <>
      <h1 className="page-title">Me</h1>
      <p className="page-lead">Your voice and avatar for listening to your own stories.</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>Account</div>
        {editingName ? (
          <form onSubmit={onRename} className="stack-8">
            <input
              className="input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={120}
              autoFocus
              aria-label="Display name"
            />
            {nameError ? <div className="msg msg-error">{nameError}</div> : null}
            <div className="btn-row">
              <button className="btn btn-primary" disabled={savingName} type="submit">
                {savingName ? "Saving…" : "Save"}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setEditingName(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{me?.display_name || "—"}</div>
                <div className="text-muted" style={{ fontSize: 13 }}>{me?.email}</div>
              </div>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setNameDraft(me?.display_name || "");
                  setEditingName(true);
                }}
                style={{ padding: "8px 12px", minHeight: 36 }}
              >
                Edit
              </button>
            </div>
          </>
        )}
      </div>

      <Link
        href="/me/security"
        className="row-item"
        style={{ marginBottom: 10 }}
        aria-label="Security settings"
      >
        <div className="row-main">
          <div className="row-title">Security</div>
          <div className="row-sub">
            Optional two-factor authentication with an authenticator app.
          </div>
        </div>
        <span
          className="row-chip"
          style={{
            background: me?.totp_enabled ? "var(--success-bg)" : "var(--accent-soft)",
            color: me?.totp_enabled ? "var(--success)" : "var(--ink-muted)",
          }}
        >
          {me?.totp_enabled ? "2FA on" : "2FA off"}
        </span>
      </Link>

      <Link
        href="/me/voice"
        className="row-item"
        style={{ marginBottom: 10 }}
        aria-label="Voice clone settings"
      >
        <div className="row-main">
          <div className="row-title">Your voice</div>
          <div className="row-sub">
            Clone your voice so your stories can be narrated in your voice.
          </div>
        </div>
        <span className={`row-chip`} style={{ background: voiceReady ? "var(--success-bg)" : "var(--accent-soft)", color: voiceReady ? "var(--success)" : "var(--ink-muted)" }}>
          {labelFor("voice", voice?.status || "none", voiceReady).label}
        </span>
      </Link>

      <Link
        href="/me/avatar"
        className="row-item"
        style={{ marginBottom: 10 }}
        aria-label="Avatar settings"
      >
        <div className="row-main" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {avatar?.pencil_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={avatar.pencil_url}
              alt=""
              width={44}
              height={44}
              style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }}
            />
          ) : (
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--accent-soft)" }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row-title">Your pencil-sketch avatar</div>
            <div className="row-sub">
              A friendly stylized portrait for your story narrations.
            </div>
          </div>
        </div>
        <span className={`row-chip`} style={{ background: avatarReady ? "var(--success-bg)" : "var(--accent-soft)", color: avatarReady ? "var(--success)" : "var(--ink-muted)" }}>
          {labelFor("avatar", avatar?.status || "none", avatarReady).label}
        </span>
      </Link>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>What LifeBook remembers</div>
        <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
          Private to you. LifeBook learns automatically from how you talk and the stories you keep —
          tone, length, themes, and what to treat gently — so you correct less over time.
        </p>

        {prefsLoading ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>Loading…</p>
        ) : !hasMemory ? (
          <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
            Nothing learned yet. After you finish a conversation or save a story, a short summary
            will appear here.
          </p>
        ) : (
          <div className="stack-12" style={{ marginBottom: 12 }}>
            {prefs.learned_summary ? (
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>{prefs.learned_summary}</p>
            ) : null}

            {learnedWhen ? (
              <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                Updated {learnedWhen}
                {prefs.last_learned_source ? ` from your last ${prefs.last_learned_source}` : ""}
              </p>
            ) : null}

            {factRows.length ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.5 }}>
                {factRows.map((row) => (
                  <li key={row.label}>
                    <span className="text-muted">{row.label}:</span> {row.value}
                  </li>
                ))}
              </ul>
            ) : null}

            {themes.length ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {themes.map((t) => (
                  <span key={t} className="row-chip">{t}</span>
                ))}
              </div>
            ) : null}

            {learnedItems.length ? (
              <ul className="me-team-list" style={{ marginTop: 4 }}>
                {learnedItems.map((item, idx) => (
                  <li key={item.id || `${item.text}-${idx}`} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="me-team-name" style={{ fontWeight: 500 }}>{item.text}</div>
                      {item.source === "manual" ? (
                        <div className="me-team-role">You added this</div>
                      ) : null}
                    </div>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      disabled={prefsBusy}
                      onClick={() => void dismissItem(item)}
                      style={{ padding: "6px 10px", minHeight: 32, fontSize: 13, flexShrink: 0 }}
                      aria-label={`Don't remember: ${item.text}`}
                    >
                      Don&apos;t remember
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}

        {prefsError ? <div className="msg msg-error" style={{ marginBottom: 10 }}>{prefsError}</div> : null}

        <div className="btn-row">
          <button className="btn btn-ghost" type="button" disabled={prefsBusy} onClick={() => void addManualNote()}>
            Add a note
          </button>
          {hasMemory ? (
            <button className="btn btn-ghost" type="button" disabled={prefsBusy} onClick={() => void clearMemory()}>
              Clear memory
            </button>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>About</div>
        <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
          Private first. Your specialists guide Create — Conversation → Script → Curate → share later.
          Sharing stays optional.{" "}
          <Link href="/talk">See how it works on Create</Link>.
        </p>
        <div className="me-team-heading">Your team</div>
        <AgentTeam />
      </div>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={() => void signout()}>Sign out</button>
      </div>
    </>
  );
}
