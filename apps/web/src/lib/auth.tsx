'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionLost, refreshSession, setAccessToken, setSessionHint } from './api';
import type { Me } from './types';

interface AuthState {
  me: Me | null;
  loading: boolean;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<Me | null>;
  can: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const reload = useCallback(async () => {
    try {
      const next = await api.get<Me>('/auth/me');
      setMe(next);
      return next;
    } catch {
      setMe(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The access token is held in memory only, so a fresh page load restores the session from the refresh cookie.
      if (await refreshSession()) await reload();
      if (!cancelled) setLoading(false);
    })();
    const off = onSessionLost(() => setMe(null));
    return () => {
      cancelled = true;
      off();
    };
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string, rememberMe = false) => {
      const res = await api.post<{ accessToken: string }>('/auth/login', { email, password, rememberMe }, { noRetry: true });
      setAccessToken(res.accessToken);
      setSessionHint(true);
      queryClient.clear();
      const next = await reload();
      if (!next) throw new Error('Could not load your profile.');
      return next;
    },
    [queryClient, reload],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { noRetry: true });
    } finally {
      setAccessToken(null);
      setSessionHint(false);
      setMe(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ me, loading, login, logout, reload, can: (...permissions) => permissions.every((p) => me?.permissions.includes(p) ?? false) }),
    [me, loading, login, logout, reload],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
