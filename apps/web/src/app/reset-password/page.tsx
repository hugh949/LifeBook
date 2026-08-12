"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";

type ResetOut = {
  ok: boolean;
  me: Me;
};

function ResetPasswordInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";
  const { setMe } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This reset link is missing a token. Request a new one from Forgot password.");
      return;
    }
    setSubmitting(true);
    try {
      const out = await apiPost<ResetOut>(
        "/auth/reset-password",
        { token, password },
        { silentStatuses: [400] }
      );
      setMe(out.me);
      router.replace("/talk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="app-main" style={{ maxWidth: 420 }}>
        <h1 className="page-title">Reset password</h1>
        <div className="card stack-12">
          <div className="msg msg-error" role="alert">
            This reset link is incomplete. Request a new one.
          </div>
          <Link className="btn btn-primary btn-block" href="/forgot-password">
            Forgot password
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-main" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Choose a new password</h1>
      <p className="page-lead">Pick something only you know. You&rsquo;ll be signed in after saving.</p>
      <form onSubmit={onSubmit} className="card stack-12" noValidate>
        <label className="field">
          <span className="label-text">New password (at least 8 characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span className="label-text">Confirm password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error ? <div className="msg msg-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Saving…" : "Save new password"}
        </button>
        <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
          <Link href="/signin">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="app-main"><p className="text-muted">Loading…</p></div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
