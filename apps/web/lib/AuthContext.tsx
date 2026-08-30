"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AuthError, AuthUser, clearStoredToken, fetchMe, getStoredToken, login as loginApi, register as registerApi, storeToken } from "./auth";
import { setAuthToken } from "./apiClient";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredToken();
    if (stored) {
      setToken(stored);
      setAuthToken(stored);
      fetchMe(stored)
        .then(setUser)
        .catch((err) => {
          // Fixed 2026-08-31: this used to wipe the stored token on ANY
          // fetchMe() failure — including a transient network blip, a
          // CORS misconfig, or NEXT_PUBLIC_XANO_AUTH_ME_PATH being wrong
          // for this workspace (flagged as unconfirmed in auth.ts's own
          // module docstring). All of those are recoverable; none of
          // them mean the token itself is invalid. That made a page
          // refresh look exactly like "the session wasn't saved, log in
          // again" even though the token in localStorage was fine the
          // whole time. Only an actual 401/403 from Xano means the
          // token itself is bad — everything else should keep the
          // token and let the user retry (e.g. hit Refresh) instead of
          // silently forcing a real re-login.
          if (err instanceof AuthError && (err.status === 401 || err.status === 403)) {
            clearStoredToken();
            setAuthToken(null);
            setToken(null);
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const doLogin = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { authToken } = await loginApi(email, password);
      storeToken(authToken);
      setAuthToken(authToken);
      setToken(authToken);
      setUser(await fetchMe(authToken));
    } catch (err: any) {
      setError(err.message || String(err));
      throw err;
    }
  }, []);

  const doRegister = useCallback(async (name: string, email: string, password: string) => {
    setError(null);
    try {
      const { authToken } = await registerApi(name, email, password);
      storeToken(authToken);
      setAuthToken(authToken);
      setToken(authToken);
      setUser(await fetchMe(authToken));
    } catch (err: any) {
      setError(err.message || String(err));
      throw err;
    }
  }, []);

  const doLogout = useCallback(() => {
    clearStoredToken();
    setAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, error, login: doLogin, register: doRegister, logout: doLogout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
