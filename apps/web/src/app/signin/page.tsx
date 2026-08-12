"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiPost } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";

type SigninResult = {
  requires_2fa?: boolean;
  challenge_token?: string | null;
  id?: string;
  email?: string;
  display_name?: string;
  totp_enabled?: boolean;
};

function SigninInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/talk";
  const { setMe } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiPost<SigninResult>(
        "/auth/signin",
        { email: email.trim().toLowerCase(), password },
        { silentStatuses: [400, 401] }
      );
      if (result.requires_2fa && result.challenge_token) {
        setChallengeToken(result.challenge_token);
        setCode("");
        return;
      }
      if (!result.id || !result.email || !result.display_name) {
        throw new Error("Could not sign in.");
      }
      setMe({
        id: result.id,
        email: result.email,
        display_name: result.display_name,
        totp_enabled: result.totp_enabled,
      });
      router.replace(next || "/talk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onTwoFaSubmit(e: FormEvent) {
    e.preventDefault();
    if (!challengeToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const me = await apiPost<Me>(
        "/auth/signin/2fa",
        { challenge_token: challengeToken, code: code.trim() },
        { silentStatuses: [400, 401] }
      );
      setMe(me);
      router.replace(next || "/talk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify that code.");
    } finally {
      setSubmitting(false);
    }
  }

  if (challengeToken) {
    return (
      <div className="app-main" style={{ maxWidth: 420 }}>
        <h1 className="page-title">Check your authenticator</h1>
        <p className="page-lead">
          Enter the 6-digit code from your app, or one of your recovery codes.
        </p>
        <form onSubmit={onTwoFaSubmit} className="card stack-12" noValidate>
          <label className="field">
            <span className="label-text">Authentication code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              placeholder="123456 or ABCD-EFGH"
            />
          </label>
          {error ? <div className="msg msg-error" role="alert">{error}</div> : null}
          <button className="btn btn-primary btn-block" disabled={submitting || !code.trim()}>
            {submitting ? "Verifying…" : "Continue"}
          </button>
          <button
            className="btn btn-ghost btn-block"
            type="button"
            disabled={submitting}
            onClick={() => {
              setChallengeToken(null);
              setCode("");
              setError(null);
            }}
          >
            Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-main" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Welcome back</h1>
      <p className="page-lead">Your stories are waiting.</p>
      <form onSubmit={onPasswordSubmit} className="card stack-12" noValidate>
        <label className="field">
          <span className="label-text">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
          />
        </label>
        <label className="field">
          <span className="label-text">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="msg msg-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
          <Link href="/forgot-password">Forgot password?</Link>
        </p>
        <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
          New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>
        </p>
      </form>
    </div>
  );
}

export default function SigninPage() {
  return (
    <Suspense fallback={<div className="app-main"><p className="text-muted">Loading…</p></div>}>
      <SigninInner />
    </Suspense>
  );
}
