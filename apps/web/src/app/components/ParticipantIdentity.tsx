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
  /** True once the participant list has been successfully loaded (or we gave up after retries). Enables nav. */
  listReady: boolean;
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
    listReady: false,
  };
  }
  return ctx;
}

const FETCH_ABORT_MS = 10000;
const RETRY_DELAY_MS = 2000;
const MAX_WAIT_MS = 22000;

export function ParticipantProvider({ children }: { children: React.ReactNode }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantId, setParticipantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listReady, setListReady] = useState(false);

  const applyParticipants = useCallback((list: Participant[], selectId?: string | null) => {
    const seenIds = new Set<string>();
    const unique = list.filter((p) => {
      if (seenIds.has(p.id)) return false;
      seenIds.add(p.id);
      return true;
    });
    setParticipants(unique);
    if (selectId !== undefined) {
      const raw = (selectId ?? "").trim();
      const id = raw && unique.some((p) => (p.id || "").trim() === raw) ? raw : "";
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
          const stored = (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null)?.trim() ?? "";
          const unique = list.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
          const id = stored && unique.some((p) => (p.id || "").trim() === stored) ? stored : "";
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
    let attempt = 0;

    const runFetch = (): void => {
      if (cancelled) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_ABORT_MS);
      apiGet<Participant[]>("/voice/participants", { signal: controller.signal })
        .then((list) => {
          if (cancelled) return;
          clearTimeout(timeoutId);
          applyParticipants(list);
          const stored = (typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null)?.trim() ?? "";
          const unique = list.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
          const id = stored && unique.some((p) => (p.id || "").trim() === stored) ? stored : "";
          setParticipantIdState(id || null);
          if (typeof window !== "undefined") {
            if (id) localStorage.setItem(STORAGE_KEY, id);
            else localStorage.removeItem(STORAGE_KEY);
          }
          setLoading(false);
          setListReady(true);
        })
        .catch(() => {
          clearTimeout(timeoutId);
          if (cancelled) return;
          if (attempt === 0) {
            attempt = 1;
            setTimeout(runFetch, RETRY_DELAY_MS);
          } else {
            setParticipants([]);
            setLoading(false);
            setListReady(true);
          }
        });
    };

    runFetch();
    const forceReadyId = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setListReady(true);
    }, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      clearTimeout(forceReadyId);
    };
  }, [applyParticipants]);

  const setParticipantId = useCallback((id: string | null) => {
    const normalized = (id ?? "").trim() || null;
    setParticipantIdState(normalized);
    if (typeof window !== "undefined") {
      if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
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
    listReady,
  };

  return (
    <ParticipantContext.Provider value={value}>
      {children}
    </ParticipantContext.Provider>
  );
}
