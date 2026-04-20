"use client";

import { useCallback, useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { apiGet, apiPatch } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";

type VoiceStatus = { status: string; voice_id: string | null; consent_at: string | null; error: string | null };
type AvatarStatus = { status: string; original_url: string | null; pencil_url: string | null; error: string | null };

function labelFor(kind: "voice" | "avatar", status: string, ready: boolean): { label: string; tone: "success" | "info" | "error" } {
  if (ready) return { label: "Ready", tone: "success" };
  if (status === "failed") return { label: kind === "voice" ? "Failed" : "Failed", tone: "error" };
  if (status === "processing" || status === "pencilizing" || status === "recording") return { label: "In progress", tone: "info" };
  return { label: "Not set up", tone: "info" };
}

export default function MePage() {
  const { me, refresh, signout, setMe } = useAuth();
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [avatar, setAvatar] = useState<AvatarStatus | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<VoiceStatus>("/me/voice").then(setVoice).catch(() => setVoice(null));
    apiGet<AvatarStatus>("/me/avatar").then(setAvatar).catch(() => setAvatar(null));
  }, []);

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

  const voiceReady = voice?.status === "ready";
  const avatarReady = avatar?.status === "ready";

  return (
    <>
      <h1 className="page-title">Me</h1>
      <p className="page-lead">Your voice and avatar make shared stories feel personal.</p>

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
        href="/me/voice"
        className="row-item"
        style={{ marginBottom: 10 }}
        aria-label="Voice clone settings"
      >
        <div className="row-main">
          <div className="row-title">Your voice</div>
          <div className="row-sub">
            Clone your voice so shared stories can be narrated in your voice.
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
              A friendly stylized portrait that narrates your shared stories.
            </div>
          </div>
        </div>
        <span className={`row-chip`} style={{ background: avatarReady ? "var(--success-bg)" : "var(--accent-soft)", color: avatarReady ? "var(--success)" : "var(--ink-muted)" }}>
          {labelFor("avatar", avatar?.status || "none", avatarReady).label}
        </span>
      </Link>

      <div className="btn-row" style={{ marginTop: 20 }}>
        <button className="btn btn-ghost" onClick={() => void signout()}>Sign out</button>
      </div>
    </>
  );
}
