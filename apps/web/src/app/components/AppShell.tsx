"use client";

import AppNav from "./AppNav";
import AppFooter from "./AppFooter";
import { ParticipantProvider, ParticipantLoadingGate } from "./ParticipantIdentity";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ParticipantProvider>
      <ParticipantLoadingGate>
        <div className="app-shell">
          <AppNav />
          <main className="app-main">{children}</main>
          <AppFooter />
        </div>
      </ParticipantLoadingGate>
    </ParticipantProvider>
  );
}
