"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

const STORAGE_KEY = "lifebook_participant_id";

type Participant = { id: string; label: string; has_voice_profile?: boolean; recall_passphrase_set?: boolean };

type ContextValue = {
  participantId: string | null;
  participantLabel: string | null;
  participants: Participant[];
  setParticipantId: (id: string | null) => void;
  refreshParticipants: (selectId?: string | null) => void;
  loading: boolean;
};

const ParticipantContext = createContext<ContextValue | null>(null);

export function useParticipantIdentity(): ContextValue {
  const ctx = useContext(ParticipantContext);
  if (!ctx) {
    return {
      participantId: null,
      participantLabel: null,
      participants: [],
      setParticipantId: () => {},
      refreshParticipants: () => {},
      loading: true,
    };
  }
  return ctx;
}

export function ParticipantProvider({ children }: { children: React.ReactNode }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyParticipants = useCallback((list: Participant[], selectId?: string | null) => {
    const seenIds = new Set<string>();
    const unique = list.filter((p) => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    setParticipants(unique);
    if (selectId !== undefined) {
      const id = selectId && unique.some((p) => p.id === selectId) ? selectId : (selectId || "");
      setParticipantIdState(id || null);
      if (typeof window !== "undefined") {
        if (id) localStorage.setItem(STORAGE_KEY, id);
        else localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  const refreshParticipants = useCallback((selectId?: string | null) => {
    setLoading(true);
    apiGet<Participant[]>("/voice/participants")
      .then((list) => {
        applyParticipants(list, selectId);
        if (selectId === undefined) {
          const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
          const unique = list.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
          const id = stored && unique.some((p) => p.id === stored) ? stored : "";
          setParticipantIdState(id || null);
          if (typeof window !== "undefined") {
            if (id) localStorage.setItem(STORAGE_KEY, id);
            else localStorage.removeItem(STORAGE_KEY);
          }
        }
      })
      .catch(() => setParticipants([]))
      .finally(() => setLoading(false));
  }, [applyParticipants]);

  useEffect(() => {
    let cancelled = false;
    const timeoutMs = 12000;
    const timeoutId = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
    }, timeoutMs);
    apiGet<Participant[]>("/voice/participants")
      .then((list) => {
        if (cancelled) return;
        applyParticipants(list);
        const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        const unique = list.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
        const id = stored && unique.some((p) => p.id === stored) ? stored : "";
        setParticipantIdState(id || null);
        if (typeof window !== "undefined") {
          if (id) localStorage.setItem(STORAGE_KEY, id);
          else localStorage.removeItem(STORAGE_KEY);
        }
      })
      .catch(() => {
        if (!cancelled) setParticipants([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
        clearTimeout(timeoutId);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [applyParticipants]);

  const setParticipantId = useCallback((id: string | null) => {
    setParticipantIdState(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const participantLabel = participantId
    ? participants.find((p) => p.id === participantId)?.label ?? null
    : null;

  const value: ContextValue = {
    participantId,
    participantLabel,
    participants,
    setParticipantId,
    refreshParticipants,
    loading,
  };

  return (
    <ParticipantContext.Provider value={value}>
      {children}
    </ParticipantContext.Provider>
  );
}
