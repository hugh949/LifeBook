"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiPost } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";

function SigninInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/talk";
  const { setMe } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Normalize on the client so what the user sees in the field equals what we send.
      // The server also normalizes, but this avoids silent mismatch if the user capitalizes
      // the first letter or pastes a leading space.
      const me = await apiPost<Me>(
        "/auth/signin",
        { email: email.trim().toLowerCase(), password },
        { silentStatuses: [400, 401] }
      );
      setMe(me);
      router.replace(next || "/talk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-main" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Welcome back</h1>
      <p className="page-lead">Your stories are waiting.</p>
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
