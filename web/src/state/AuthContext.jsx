import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setAuthToken, getAuthToken, refreshSession, logoutRequest, setOnUnauthorized } from '../api/client.js';

const PROFILE_KEY = 'novapos.profile';
const AuthContext = createContext(null);

const ROLE_RANK = { owner: 3, manager: 2, cashier: 1 };

function readProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  // The access token lives in memory only; the browser keeps an httpOnly
  // refresh cookie that silently restores the session on boot.
  const [session, setSession] = useState(() => {
    const profile = readProfile();
    if (profile) {
      setAuthToken('pending-refresh'); // optimistic; replaced on boot refresh
    }
    return profile;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await refreshSession();
      if (!alive) return;
      if (data?.token && data?.user) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify({ user: data.user, tenant: data.tenant }));
        setSession({ user: data.user, tenant: data.tenant });
      } else {
        setAuthToken(null);
        localStorage.removeItem(PROFILE_KEY);
        setSession(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setOnUnauthorized(() => {
      localStorage.removeItem(PROFILE_KEY);
      setAuthToken(null);
      window.location.href = '/login';
    });
  }, []);

  const login = useCallback((data) => {
    setAuthToken(data.token);
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ user: data.user, tenant: data.tenant })
    );
    setSession({ user: data.user, tenant: data.tenant });
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    localStorage.removeItem(PROFILE_KEY);
    setSession(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const { user, tenant } = await api('/auth/me');
    setSession((prev) => {
      const next = { ...prev, user, tenant };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const rank = ROLE_RANK[session?.user?.role] ?? 0;
  const perms = session?.user?.perms ?? [];

  const value = useMemo(
    () => ({
      token: getAuthToken(),
      user: session?.user ?? null,
      tenant: session?.tenant ?? null,
      login,
      logout,
      refreshMe,
      can: (minRole) => rank >= minRole,
      hasPerm: (perm) => perms.includes(perm),
      isOwner: rank === 3,
    }),
    [session, login, logout, refreshMe, rank, perms]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
