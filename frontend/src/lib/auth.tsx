import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { get, post } from "./api";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  avatarUrl?: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ user: User }>("/api/auth/me");
      setUser(data.user);
      setError(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const data = await post<{ user: User }>("/api/auth/login", { email, password });
      setUser(data.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg);
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    await post("/api/auth/logout", {});
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, error, login, logout, refresh }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
