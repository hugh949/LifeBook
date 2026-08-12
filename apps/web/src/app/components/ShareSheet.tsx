"use client";

import { useEffect, useState } from "react";
import { apiPost, apiDelete, apiGet, apiPatch } from "@/lib/api";

type ShareOut = {
  token: string;
  url: string;
  target_type: string;
  target_id: string;
  has_password: boolean;
  created_at: string;
  revoked_at: string | null;
};

type Props = {
  targetType: "conversation" | "story";
  targetId: string;
  open: boolean;
  onClose: () => void;
};

export default function ShareSheet({ targetType, targetId, open, onClose }: Props) {
  const [password, setPassword] = useState("");
  const [changePasswordFor, setChangePasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [existing, setExisting] = useState<ShareOut[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setChangePasswordFor(null);
      setNewPassword("");
      setError(null);
      setCopied(null);
      return;
    }
    apiGet<ShareOut[]>("/shares")
      .then((all) =>
        setExisting(
          all.filter(
            (s) => s.target_type === targetType && s.target_id === targetId && !s.revoked_at
          )
        )
      )
      .catch(() => setExisting([]));
  }, [open, targetType, targetId]);

  if (!open) return null;

  const onCreate = async () => {
    setError(null);
    const pw = password.trim();
    if (pw.length < 4) {
      setError("Choose a password of at least 4 characters.");
      return;
    }
    setCreating(true);
    try {
      const s = await apiPost<ShareOut>("/shares", {
        target_type: targetType,
        target_id: targetId,
        password: pw,
      });
      setExisting((prev) => (prev ? [s, ...prev] : [s]));
      setPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create share link.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (token: string) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const link = `${origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(token);
      setTimeout(() => setCopied((v) => (v === token ? null : v)), 2500);
    } catch {
      window.prompt("Copy this link:", link);
    }
  };

  const revoke = async (token: string) => {
    if (!confirm("Remove access for this link? Anyone with it will no longer be able to open it.")) return;
    try {
      await apiDelete(`/shares/${encodeURIComponent(token)}`);
      setExisting((prev) => (prev ?? []).filter((s) => s.token !== token));
      if (changePasswordFor === token) {
        setChangePasswordFor(null);
        setNewPassword("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the link.");
    }
  };

  const saveNewPassword = async (token: string) => {
    setError(null);
    const pw = newPassword.trim();
    if (pw.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    setSavingPassword(true);
    try {
      const updated = await apiPatch<ShareOut>(`/shares/${encodeURIComponent(token)}`, {
        password: pw,
      });
      setExisting((prev) => (prev ?? []).map((s) => (s.token === token ? updated : s)));
      setChangePasswordFor(null);
      setNewPassword("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 10px", fontSize: "1.1rem", fontWeight: 700 }}>
          Who can listen
        </h2>
        <p className="text-muted" style={{ margin: "0 0 14px", fontSize: 14 }}>
          This stays private to you until you create a password-protected link. Share the link and
          password only when you choose — not a public post. You can change the password or remove
          access anytime.
        </p>

        <div className="stack-12">
          <label className="field">
            <span className="label-text">Password for new link</span>
            <input
              className="input"
              type="text"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password"
              aria-label="Password for new share link"
            />
          </label>
          {error ? <div className="msg msg-error">{error}</div> : null}
          <button className="btn btn-primary btn-block" disabled={creating} onClick={onCreate}>
            {creating ? "Creating…" : "Create protected link"}
          </button>
        </div>

        <div className="section-title" style={{ marginBottom: 8 }}>Active links</div>
        {existing === null ? (
          <p className="text-muted" style={{ fontSize: 14 }}>Loading…</p>
        ) : existing.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 14 }}>
            No links yet. Only you can listen until you invite someone.
          </p>
        ) : (
          <ul className="stack-8" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {existing.map((s) => (
              <li key={s.token} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ fontSize: 12, wordBreak: "break-all", flex: 1, minWidth: 0 }}>
                    /s/{s.token}
                  </code>
                  <span className="row-chip">password</span>
                </div>
                {changePasswordFor === s.token ? (
                  <div className="stack-8" style={{ marginTop: 10 }}>
                    <input
                      className="input"
                      type="text"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password"
                      aria-label="New password"
                    />
                    <div className="btn-row">
                      <button
                        className="btn btn-primary"
                        disabled={savingPassword}
                        onClick={() => void saveNewPassword(s.token)}
                      >
                        {savingPassword ? "Saving…" : "Save password"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => {
                          setChangePasswordFor(null);
                          setNewPassword("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="btn-row" style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost" onClick={() => copy(s.token)}>
                      {copied === s.token ? "Copied!" : "Copy link"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setChangePasswordFor(s.token);
                        setNewPassword("");
                        setError(null);
                      }}
                    >
                      Change password
                    </button>
                    <button className="btn btn-danger" onClick={() => revoke(s.token)}>
                      Remove access
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="btn-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
