"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";

export type Me = {
  id: string;
  email: string;
  display_name: string;
  created_at?: string;
  totp_enabled?: boolean;
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signout: () => Promise<void>;
  setMe: (me: Me | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      me: null,
      loading: true,
      refresh: async () => {},
      signout: async () => {},
      setMe: () => {},
    };
  }
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      // 401 is the normal "signed out" answer here; don't spam the console for it.
      const m = await apiGet<Me>("/auth/me", { silentStatuses: [401] });
      setMeState(m);
    } catch {
      setMeState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signout = useCallback(async () => {
    try {
      await apiPost("/auth/signout", {});
    } catch {
      /* ignore */
    }
    setMeState(null);
    router.push("/signin");
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value: AuthState = {
    me,
    loading,
    refresh,
    signout,
    setMe: setMeState,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
