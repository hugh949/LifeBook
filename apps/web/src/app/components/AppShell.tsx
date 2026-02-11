"use client";

import AppNav from "./AppNav";
import AppFooter from "./AppFooter";
import { ParticipantProvider, ParticipantLoadingGate } from "./ParticipantIdentity";
import { VoiceAgentProvider } from "./VoiceAgentContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ParticipantProvider>
      <VoiceAgentProvider>
        <ParticipantLoadingGate>
          <div className="app-shell">
            <AppNav />
            <main className="app-main">{children}</main>
            <AppFooter />
          </div>
        </ParticipantLoadingGate>
      </VoiceAgentProvider>
    </ParticipantProvider>
  );
}
