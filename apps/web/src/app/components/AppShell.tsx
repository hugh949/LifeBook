"use client";

import AppNav from "./AppNav";
import AppFooter from "./AppFooter";
import BottomNav from "./BottomNav";
import { ParticipantProvider, ParticipantLoadingGate } from "./ParticipantIdentity";
import { VoiceAgentProvider } from "./VoiceAgentContext";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ParticipantProvider>
      <VoiceAgentProvider>
        <ParticipantLoadingGate>
          <div className="app-shell has-bottom-nav">
            <AppNav />
            <main className="app-main">{children}</main>
            <AppFooter />
            <BottomNav />
          </div>
        </ParticipantLoadingGate>
      </VoiceAgentProvider>
    </ParticipantProvider>
  );
}
