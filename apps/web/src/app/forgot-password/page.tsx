"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { apiPost } from "@/lib/api";

type ForgotOut = {
  ok: boolean;
  message: string;
  dev_reset_url?: string | null;
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForgotOut | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const out = await apiPost<ForgotOut>(
        "/auth/forgot-password",
        { email: email.trim().toLowerCase() },
        { silentStatuses: [400] }
      );
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start a password reset.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-main" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Forgot password</h1>
      <p className="page-lead">We&rsquo;ll send a reset link to your email if an account exists.</p>

      {result ? (
        <div className="card stack-12">
          <div className="msg msg-success" role="status">{result.message}</div>
          {result.dev_reset_url ? (
            <div className="stack-8">
              <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
                Local mode (no email server): use this link to finish resetting.
              </p>
              <Link className="btn btn-primary btn-block" href={result.dev_reset_url}>
                Open reset link
              </Link>
            </div>
          ) : null}
          <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
            <Link href="/signin">Back to sign in</Link>
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="card stack-12" noValidate>
          <label className="field">
            <span className="label-text">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              autoFocus
            />
          </label>
          {error ? <div className="msg msg-error" role="alert">{error}</div> : null}
          <button className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
          <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
            <Link href="/signin">Back to sign in</Link>
          </p>
        </form>
      )}
    </div>
  );
}
