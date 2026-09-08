import { Loader2 } from "lucide-react";

/** Inline spinner + optional label. Use anywhere a small "working" hint is needed. */
export function Spinner({
  label,
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-2 text-sm text-zinc-500 ${className}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label ? label : <span className="sr-only">Loading</span>}
    </span>
  );
}

/** Centered, full-height spinner for whole-view loading / redirect states. */
export function FullSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-sm text-zinc-500">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
