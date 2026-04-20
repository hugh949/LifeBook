"use client";

import Link from "next/link";
import { useAuth } from "./AuthContext";

export default function AppNav() {
  const { me, signout } = useAuth();
  return (
    <header className="app-nav" role="banner">
      <Link href="/talk" className="brand" aria-label="LifeBook home">
        LifeBook
      </Link>
      <div style={{ flex: 1 }} />
      {me ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              color: "var(--ink-muted)",
              maxWidth: 140,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={me.display_name}
          >
            {me.display_name}
          </span>
          <button
            type="button"
            className="btn-link"
            onClick={() => void signout()}
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </header>
  );
}
