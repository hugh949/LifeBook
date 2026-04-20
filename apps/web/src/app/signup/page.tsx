"use client";

import { useState, FormEvent, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiPost } from "@/lib/api";
import { useAuth, Me } from "@/app/components/AuthContext";

function SignupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/talk";
  const { setMe } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const me = await apiPost<Me>(
        "/auth/signup",
        {
          display_name: displayName.trim(),
          email: email.trim().toLowerCase(),
          password,
        },
        // 400 = invalid email / blank name (we display the server message), 409 = email taken.
        { silentStatuses: [400, 409] }
      );
      setMe(me);
      router.replace(next || "/talk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-main" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Start your LifeBook</h1>
      <p className="page-lead">Your stories are private by default. Share only when you choose.</p>
      <form onSubmit={onSubmit} className="card stack-12" noValidate>
        <label className="field">
          <span className="label-text">Your name</span>
          <input
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={120}
          />
        </label>
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
          <span className="label-text">Password (at least 8 characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <div className="msg msg-error" role="alert">{error}</div> : null}
        <button className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Creating…" : "Create account"}
        </button>
        <p className="text-muted center" style={{ margin: 0, fontSize: 14 }}>
          Already have an account? <Link href={`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link>
        </p>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="app-main"><p className="text-muted">Loading…</p></div>}>
      <SignupInner />
    </Suspense>
  );
}
