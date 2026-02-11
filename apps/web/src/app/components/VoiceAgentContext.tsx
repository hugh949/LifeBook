"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

type VoiceAgentContextValue = {
  /** True when the voice agent is actively listening (session connected). */
  isListening: boolean;
  setIsListening: (value: boolean) => void;
};

const VoiceAgentContext = createContext<VoiceAgentContextValue | null>(null);

export function useVoiceAgent(): VoiceAgentContextValue {
  const ctx = useContext(VoiceAgentContext);
  if (!ctx) {
    return {
      isListening: false,
      setIsListening: () => {},
    };
  }
  return ctx;
}

export function VoiceAgentProvider({ children }: { children: React.ReactNode }) {
  const [isListening, setIsListening] = useState(false);
  return (
    <VoiceAgentContext.Provider value={{ isListening, setIsListening }}>
      {children}
    </VoiceAgentContext.Provider>
  );
}
