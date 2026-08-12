"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPost } from "@/lib/api";

type Status = { enabled: boolean; recovery_codes_remaining: number };
type Setup = { secret: string; otpauth_uri: string; qr_data_url: string };

export default function SecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [setup, setSetup] = useState<Setup | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmCode, setConfirmCode] = useState("");
  const [action, setAction] = useState<"disable" | "regen" | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await apiGet<Status>("/auth/2fa/status");
      setStatus(s);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Could not load security settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    setRecoveryCodes(null);
    try {
      const out = await apiPost<Setup>("/auth/2fa/setup", {});
      setSetup(out);
      setVerifyCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start setup.");
    } finally {
      setBusy(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await apiPost<{ recovery_codes: string[] }>(
        "/auth/2fa/enable",
        { code: verifyCode.trim() },
        { silentStatuses: [400, 401] }
      );
      setSetup(null);
      setVerifyCode("");
      setRecoveryCodes(out.recovery_codes);
      setInfo("Two-factor authentication is on. Save your recovery codes now — they won’t be shown again.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable 2FA.");
    } finally {
      setBusy(false);
    }
  };

  const runProtected = async (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const body = {
        password: confirmPassword || undefined,
        code: confirmCode.trim() || undefined,
      };
      if (action === "disable") {
        await apiPost("/auth/2fa/disable", body, { silentStatuses: [400, 401] });
        setRecoveryCodes(null);
        setSetup(null);
        setInfo("Two-factor authentication is off.");
      } else {
        const out = await apiPost<{ recovery_codes: string[] }>(
          "/auth/2fa/recovery-codes/regenerate",
          body,
          { silentStatuses: [400, 401] }
        );
        setRecoveryCodes(out.recovery_codes);
        setInfo("New recovery codes created. Save them now — old ones no longer work.");
      }
      setAction(null);
      setConfirmPassword("");
      setConfirmCode("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that action.");
    } finally {
      setBusy(false);
    }
  };

  const enabled = Boolean(status?.enabled);

  return (
    <>
      <p style={{ margin: "0 0 8px" }}>
        <Link href="/me" className="text-muted" style={{ fontSize: 14 }}>
          ← Me
        </Link>
      </p>
      <h1 className="page-title">Security</h1>
      <p className="page-lead">
        Optional two-factor authentication with an authenticator app.
      </p>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Authenticator app</div>
          <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 14, lineHeight: 1.45 }}>
            Works with Google Authenticator, Authy, 1Password, and similar apps.
            After you turn this on, signing in asks for a code after your password.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span
              className="row-chip"
              style={{
                background: enabled ? "var(--success-bg)" : "var(--accent-soft)",
                color: enabled ? "var(--success)" : "var(--ink-muted)",
              }}
            >
              {enabled ? "On" : "Off"}
            </span>
            {enabled ? (
              <span className="text-muted" style={{ fontSize: 13 }}>
                {status?.recovery_codes_remaining ?? 0} recovery code
                {(status?.recovery_codes_remaining ?? 0) === 1 ? "" : "s"} left
              </span>
            ) : null}
          </div>

          {!enabled && !setup ? (
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void startSetup()}>
              {busy ? "Starting…" : "Turn on 2FA"}
            </button>
          ) : null}

          {enabled ? (
            <div className="btn-row">
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction("regen");
                  setConfirmPassword("");
                  setConfirmCode("");
                  setError(null);
                }}
              >
                New recovery codes
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction("disable");
                  setConfirmPassword("");
                  setConfirmCode("");
                  setError(null);
                }}
              >
                Turn off 2FA
              </button>
            </div>
          ) : null}
        </div>
      )}

      {setup ? (
        <div className="card stack-12" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Scan this QR code</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Open your authenticator app and scan the code, or enter the secret manually.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={setup.qr_data_url}
            alt="QR code for authenticator setup"
            width={180}
            height={180}
            style={{
              width: 180,
              height: 180,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "#fff",
              alignSelf: "flex-start",
            }}
          />
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="label-text">Manual secret</span>
            <input className="input" readOnly value={setup.secret} onFocus={(e) => e.target.select()} />
          </label>
          <form onSubmit={enable} className="stack-12">
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="label-text">Enter a code to confirm</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="123456"
              />
            </label>
            <div className="btn-row">
              <button className="btn btn-primary" disabled={busy || verifyCode.trim().length < 6} type="submit">
                {busy ? "Enabling…" : "Enable 2FA"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSetup(null);
                  setVerifyCode("");
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {action ? (
        <div className="card stack-12" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            {action === "disable" ? "Turn off 2FA" : "Generate new recovery codes"}
          </div>
          <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Confirm with your password, or an authenticator / recovery code.
          </p>
          <form onSubmit={runProtected} className="stack-12">
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="label-text">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="label-text">Or authenticator / recovery code</span>
              <input
                type="text"
                autoComplete="one-time-code"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                placeholder="Optional if using password"
              />
            </label>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || (!confirmPassword && !confirmCode.trim())}
              >
                {busy ? "Working…" : action === "disable" ? "Turn off" : "Generate"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={busy}
                onClick={() => setAction(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {recoveryCodes ? (
        <div className="card stack-12" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Recovery codes</div>
          <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>
            Store these somewhere safe. Each code works once if you lose your authenticator.
          </p>
          <ul
            style={{
              margin: 0,
              padding: "12px 16px",
              listStyle: "none",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 15,
              lineHeight: 1.7,
              background: "var(--accent-soft)",
              borderRadius: 8,
            }}
          >
            {recoveryCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(recoveryCodes.join("\n"));
              setInfo("Recovery codes copied.");
            }}
          >
            Copy codes
          </button>
        </div>
      ) : null}

      {error ? <div className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>{error}</div> : null}
      {info ? <div className="msg msg-success" role="status" style={{ marginBottom: 12 }}>{info}</div> : null}
    </>
  );
}
