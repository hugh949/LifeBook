"use client";

import { useEffect, useState } from "react";
import { apiPost, apiDelete, apiGet } from "@/lib/api";

type ShareOut = {
  token: string;
  url: string;
  target_type: string;
  target_id: string;
  has_code: boolean;
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
  const [code, setCode] = useState("");
  const [useCode, setUseCode] = useState(false);
  const [existing, setExisting] = useState<ShareOut[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode("");
      setUseCode(false);
      setError(null);
      setCopied(null);
      return;
    }
    apiGet<ShareOut[]>("/shares")
      .then((all) => setExisting(all.filter((s) => s.target_type === targetType && s.target_id === targetId && !s.revoked_at)))
      .catch(() => setExisting([]));
  }, [open, targetType, targetId]);

  if (!open) return null;

  const onCreate = async () => {
    setError(null);
    setCreating(true);
    try {
      const body: { target_type: string; target_id: string; code?: string } = {
        target_type: targetType,
        target_id: targetId,
      };
      if (useCode) {
        if (!/^\d{4}$/.test(code)) {
          setError("Code must be exactly 4 digits.");
          setCreating(false);
          return;
        }
        body.code = code;
      }
      const s = await apiPost<ShareOut>("/shares", body);
      setExisting((prev) => (prev ? [s, ...prev] : [s]));
      setUseCode(false);
      setCode("");
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
    if (!confirm("Revoke this share link? Recipients will no longer be able to open it.")) return;
    try {
      await apiDelete(`/shares/${encodeURIComponent(token)}`);
      setExisting((prev) => (prev ?? []).filter((s) => s.token !== token));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke the link.");
    }
  };

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 10px", fontSize: "1.1rem", fontWeight: 700 }}>Share</h2>
        <p className="text-muted" style={{ margin: "0 0 14px", fontSize: 14 }}>
          Create a link. Anyone with the link can listen. Add a 4-digit code for extra privacy.
        </p>

        <div className="stack-12">
          <label className="field" style={{ gap: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={useCode}
                onChange={(e) => setUseCode(e.target.checked)}
              />
              <span className="label-text">Require a 4-digit code</span>
            </span>
          </label>
          {useCode ? (
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="e.g. 1234"
              aria-label="4-digit code"
            />
          ) : null}
          {error ? <div className="msg msg-error">{error}</div> : null}
          <button className="btn btn-primary btn-block" disabled={creating} onClick={onCreate}>
            {creating ? "Creating…" : "Create share link"}
          </button>
        </div>

        <div className="section-title" style={{ marginBottom: 8 }}>Your links</div>
        {existing === null ? (
          <p className="text-muted" style={{ fontSize: 14 }}>Loading…</p>
        ) : existing.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 14 }}>No active links yet.</p>
        ) : (
          <ul className="stack-8" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {existing.map((s) => (
              <li key={s.token} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ fontSize: 12, wordBreak: "break-all", flex: 1, minWidth: 0 }}>
                    /s/{s.token}
                  </code>
                  {s.has_code ? <span className="row-chip">code</span> : null}
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={() => copy(s.token)}>
                    {copied === s.token ? "Copied!" : "Copy"}
                  </button>
                  <button className="btn btn-danger" onClick={() => revoke(s.token)}>
                    Revoke
                  </button>
                </div>
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
