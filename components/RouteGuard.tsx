"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { FullSpinner } from "@/components/Spinner";

/** Route prefixes that require a signed-in user. */
const PROTECTED = ["/scan", "/history", "/complaint", "/profile"];

const isProtected = (pathname: string) =>
  PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const needsAuth = isProtected(pathname);

  useEffect(() => {
    if (loading) return;

    if (needsAuth && !user) {
      const next = encodeURIComponent(pathname + window.location.search);
      router.replace(`/login?next=${next}`);
    } else if (pathname === "/login" && user) {
      const target = new URLSearchParams(window.location.search).get("next");
      router.replace(target || "/");
    }
  }, [loading, user, pathname, needsAuth, router]);

  // Block protected content until auth is known / the redirect lands.
  if (needsAuth && loading) return <FullSpinner label="Checking your session…" />;
  if (needsAuth && !user) return <FullSpinner label="Redirecting to sign in…" />;
  if (pathname === "/login" && user) return <FullSpinner label="Signing you in…" />;

  return <>{children}</>;
}
