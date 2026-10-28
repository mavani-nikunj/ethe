import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setToken } from './api';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  instituteId: string | null;
  authoritySlot?: string;
  designation?: string;
  mobile?: string;
  departmentIds?: string[];
  courseIds?: string[];
  mustChangePassword?: boolean;
  institute?: {
    id: string;
    name: string;
    code: string;
    logoUrl?: string;
    primaryColor?: string;
    status: string;
  } | null;
};

type Ctx = {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthCtx = createContext<Ctx>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await get<SessionUser>('/auth/me');
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const res = await post<{ accessToken: string; mustChangePassword: boolean; user: SessionUser }>(
          '/auth/login',
          { email, password },
        );
        setToken(res.accessToken);
        setUser({ ...res.user, mustChangePassword: res.mustChangePassword });
        return { ...res.user, mustChangePassword: res.mustChangePassword };
      },
      logout() {
        setToken(null);
        setUser(null);
      },
      refresh,
    }),
    [user, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
