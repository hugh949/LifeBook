"use client";

import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "./AuthContext";
import { VoiceAgentProvider } from "./VoiceAgentContext";
import AppNav from "./AppNav";
import BottomNav from "./BottomNav";

const PUBLIC_PATH_PATTERNS: RegExp[] = [
  /^\/signin$/,
  /^\/signup$/,
  /^\/s(?:\/|$)/,
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((r) => r.test(pathname));
}

function AuthedChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage = isPublic(pathname || "");
  const { loading } = useAuth();

  if (publicPage) {
    // Public pages (signin/signup/share) render without the authed chrome
    return <div className="app-shell">{children}</div>;
  }

  if (loading) {
    return (
      <div
        className="app-shell"
        role="status"
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <p style={{ fontSize: 16, color: "var(--ink-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="app-shell has-bottom-nav">
      <AppNav />
      <main className="app-main">{children}</main>
      <BottomNav />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <VoiceAgentProvider>
        <AuthedChrome>{children}</AuthedChrome>
      </VoiceAgentProvider>
    </AuthProvider>
  );
}
