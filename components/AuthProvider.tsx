"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  getCurrentUser,
  onAuthStateChange,
  ensureProfile,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut as signOutHelper,
} from "@/lib/supabase-auth";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithGoogle: typeof signInWithGoogle;
  signInWithEmail: typeof signInWithEmail;
  signUpWithEmail: typeof signUpWithEmail;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const unsubscribe = onAuthStateChange((nextUser, event) => {
      if (!mounted) return;
      setUser(nextUser);
      setLoading(false);
      if (nextUser && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        void ensureProfile(nextUser);
      }
    });

    // Belt and braces: resolve loading even if INITIAL_SESSION never arrives.
    getCurrentUser()
      .then((u) => {
        if (!mounted) return;
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut: async () => {
        await signOutHelper();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used within <AuthProvider>");
  return ctx;
}
