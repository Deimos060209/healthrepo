import Link from "next/link";
import { ArrowLeft } from "lucide-react";

interface PageHeaderProps {
  title: string;
  backHref?: string;
  backLabel?: string;
}

export function PageHeader({
  title,
  backHref = "/",
  backLabel = "Home",
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3">
      <Link
        href={backHref}
        className="inline-flex items-center gap-2 text-sm text-zinc-600 hover:text-foreground dark:text-zinc-400"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {backLabel}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
