/**
 * Supabase authentication helpers.
 *
 * All of these wrap the single shared client from `lib/supabase.ts` — do not
 * create another `createClient(...)`, or GoTrue will warn about multiple
 * instances and sessions can desync.
 */

import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

const siteUrl = () =>
  typeof window !== "undefined" ? window.location.origin : "";

/** Start the Google OAuth redirect flow. The browser navigates away on success. */
export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: siteUrl() },
  });
}

export function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export function signUpWithEmail(name: string, email: string, password: string) {
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      // Read by the `handle_new_user` trigger to seed the profiles row.
      data: { name: name.trim(), full_name: name.trim() },
      emailRedirectTo: siteUrl(),
    },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

/** Server-verified current user (network call). Null when signed out. */
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

/**
 * Subscribe to auth changes. Fires `INITIAL_SESSION` once on subscribe.
 * Returns an unsubscribe function.
 */
export function onAuthStateChange(
  cb: (user: User | null, event: AuthChangeEvent) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) =>
    cb(session?.user ?? null, event),
  );
  return () => data.subscription.unsubscribe();
}

/**
 * Make sure a row exists in `profiles` for this user. The DB trigger normally
 * handles this on sign-up; this is an idempotent, RLS-safe fallback that also
 * covers OAuth users and installs where the trigger is missing.
 */
export async function ensureProfile(user: User): Promise<void> {
  try {
    const meta = user.user_metadata ?? {};
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? null,
        name:
          (typeof meta.name === "string" && meta.name) ||
          (typeof meta.full_name === "string" && meta.full_name) ||
          null,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
  } catch {
    /* non-fatal — the trigger usually wins the race anyway */
  }
}
