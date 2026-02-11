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

/** No abort on initial load so Azure cold start (often 15–40s) can complete. Safety cap so we never block forever. */
const INITIAL_LOAD_MAX_WAIT_MS = 90000;

export const PARTICIPANT_STORAGE_KEY = STORAGE_KEY;

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
    apiGet<Participant[]>("/voice/participants")
      .then((list) => {
        if (cancelled) return;
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
        if (cancelled) return;
        setParticipants([]);
        setLoading(false);
        setListReady(true);
      });

    const safetyId = setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      setListReady(true);
    }, INITIAL_LOAD_MAX_WAIT_MS);

    return () => {
      cancelled = true;
      clearTimeout(safetyId);
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

/** Renders children only after the participant list has loaded. Shows full-page loading until then. */
export function ParticipantLoadingGate({ children }: { children: React.ReactNode }) {
  const { listReady, loading } = useParticipantIdentity();
  if (!listReady) {
    return (
      <div
        className="app-shell"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: 24,
          textAlign: "center",
        }}
        role="status"
        aria-live="polite"
      >
        <p style={{ fontSize: 18, color: "var(--ink)", margin: "0 0 8px" }}>
          Loading participants…
        </p>
        <p style={{ fontSize: 14, color: "var(--ink-muted)", margin: 0 }}>
          {loading ? "Connecting…" : "Almost ready."}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
