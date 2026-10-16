import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

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

async function loadProfile(fbUser: FirebaseUser, forceRefresh = false): Promise<User | null> {
  const token = await fbUser.getIdTokenResult(forceRefresh);
  const snap = await getDoc(doc(db, "users", fbUser.uid));
  if (!snap.exists()) return null;
  const d = snap.data() as { name: string; email: string; role: "ADMIN" | "MEMBER"; avatarUrl?: string | null };
  return {
    id: fbUser.uid,
    name: d.name,
    email: d.email,
    // Authoritative role: custom claim set server-side; user document as fallback.
    role: token.claims.admin === true || d.role === "ADMIN" ? "ADMIN" : "MEMBER",
    avatarUrl: d.avatarUrl ?? null,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await loadProfile(fbUser, true));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      try {
        setUser(fbUser ? await loadProfile(fbUser) : null);
        setError(null);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      setUser(await loadProfile(cred.user));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(friendlyAuthError(msg));
      throw new Error(friendlyAuthError(msg));
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    setUser(null);
  }, []);

  return <Ctx.Provider value={{ user, loading, error, login, logout, refresh }}>{children}</Ctx.Provider>;
}

function friendlyAuthError(msg: string): string {
  if (msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password") || msg.includes("auth/user-not-found")) {
    return "Invalid email or password.";
  }
  if (msg.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";
  return "Login failed. Please try again.";
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
