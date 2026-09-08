"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { HeartPulse, LogOut, ShieldPlus } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

const NAV_LINKS = [
  { href: "/scan", label: "Scan" },
  { href: "/search", label: "Search" },
  { href: "/history", label: "History" },
  { href: "/about", label: "About" },
];

function displayName(
  meta: Record<string, unknown> | undefined,
  email: string | undefined,
): string {
  if (meta) {
    if (typeof meta.name === "string" && meta.name) return meta.name;
    if (typeof meta.full_name === "string" && meta.full_name)
      return meta.full_name;
  }
  return email?.split("@")[0] ?? "Account";
}

export function Navbar() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = displayName(user?.user_metadata, user?.email ?? undefined);
  const avatar =
    (user?.user_metadata?.avatar_url as string | undefined) ??
    (user?.user_metadata?.picture as string | undefined) ??
    null;
  const initial = (name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-background/90 backdrop-blur dark:border-white/10">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-600 text-white">
            <HeartPulse className="h-4 w-4" aria-hidden />
          </span>
          HealthRepo
        </Link>

        {/* Desktop nav */}
        <nav className="hidden flex-1 items-center gap-1 text-sm md:flex">
          {NAV_LINKS.map((l) => {
            const active =
              l.href === "/"
                ? pathname === "/"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  active
                    ? "bg-teal-600/10 text-teal-700 dark:text-teal-300"
                    : "text-zinc-600 hover:text-foreground dark:text-zinc-400"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          {/* About stays reachable on mobile (desktop has it in the nav) */}
          <Link
            href="/about"
            className="text-sm font-medium text-zinc-600 hover:text-foreground dark:text-zinc-400 md:hidden"
          >
            About
          </Link>

          {loading ? (
            <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-200 dark:bg-white/10" />
          ) : user ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-teal-600 text-sm font-semibold text-white"
              >
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatar}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  initial
                )}
              </button>

              {open && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-60 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-zinc-900"
                >
                  <div className="px-3 py-2">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {user.email}
                    </p>
                  </div>
                  <Link
                    href="/profile/health"
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                  >
                    <ShieldPlus className="h-4 w-4" aria-hidden />
                    Health profile
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={async () => {
                      setOpen(false);
                      await signOut();
                      router.push("/");
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
