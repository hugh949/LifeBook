"use client";

import AppNav from "./AppNav";
import { ParticipantProvider } from "./ParticipantIdentity";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ParticipantProvider>
      <div className="app-shell">
        <AppNav />
        <main className="app-main">{children}</main>
      </div>
    </ParticipantProvider>
  );
}
