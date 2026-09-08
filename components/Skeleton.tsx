/** Base shimmer block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-zinc-200 dark:bg-white/10 ${className}`}
    />
  );
}

/** Matches a history / browse product card. */
export function ProductCardSkeleton() {
  return (
    <li className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-16 rounded-full" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </li>
  );
}

/** Matches a search result row. */
export function ResultRowSkeleton() {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-zinc-200 p-3 dark:border-white/10">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </li>
  );
}
