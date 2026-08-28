"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AuthUser, clearStoredToken, fetchMe, getStoredToken, login as loginApi, register as registerApi, storeToken } from "./auth";
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
        .catch(() => {
          // Stored token is stale/invalid — clear it rather than leaving
          // the UI stuck believing it's authenticated.
          clearStoredToken();
          setAuthToken(null);
          setToken(null);
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
