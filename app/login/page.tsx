"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HeartPulse, Loader2, Mail } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

type Mode = "signin" | "signup";

function nextTarget(): string {
  if (typeof window === "undefined") return "/";
  return new URLSearchParams(window.location.search).get("next") || "/";
}

export default function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      // Supabase says "Unsupported provider: provider is not enabled" when the
      // Google provider hasn't been configured — meaningless to an end user.
      setError(
        /provider is not enabled|unsupported provider/i.test(error.message)
          ? "Google sign-in isn’t set up yet. Please use your email and password below."
          : error.message,
      );
      setBusy(false);
    }
    // On success the browser redirects to Google.
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        const { error } = await signInWithEmail(email, password);
        if (error) throw error;
        router.replace(nextTarget());
      } else {
        if (!name.trim()) throw new Error("Please enter your name.");
        const { data, error } = await signUpWithEmail(name, email, password);
        if (error) throw error;
        if (data.session) {
          router.replace(nextTarget());
        } else {
          setNotice(
            "Almost there — check your email to confirm your account, then sign in.",
          );
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-600 text-white shadow-sm shadow-teal-600/30">
          <HeartPulse className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-3 text-xl font-bold tracking-tight">HealthRepo</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {mode === "signin"
            ? "Sign in to scan products and keep your history."
            : "Create an account to save your scans and complaints."}
        </p>
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-white/15 dark:bg-white/[0.04] dark:text-zinc-100 dark:hover:bg-white/[0.08]"
      >
        <GoogleGlyph />
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
        or continue with email
        <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <Field
            label="Name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={setName}
            placeholder="Your name"
          />
        )}
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          required
        />
        <Field
          label="Password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
          required
        />

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 rounded-lg bg-teal-600/10 px-3 py-2 text-xs text-teal-800 dark:text-teal-200">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </form>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        {mode === "signin" ? (
          <>
            Don&rsquo;t have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError(null);
                setNotice(null);
              }}
              className="font-semibold text-teal-700 dark:text-teal-300"
            >
              Sign Up
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                setError(null);
                setNotice(null);
              }}
              className="font-semibold text-teal-700 dark:text-teal-300"
            >
              Sign In
            </button>
          </>
        )}
      </p>

      <Link
        href="/"
        className="text-center text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        Back to home
      </Link>
    </main>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        className="rounded-xl border border-zinc-300 bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-zinc-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 dark:border-white/15"
      />
    </label>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 3-2.26 5.54-4.78 7.25l7.73 6c4.51-4.18 7.09-10.36 7.09-17.72z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
