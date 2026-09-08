"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STYLE: Record<ToastKind, { cls: string; icon: React.ReactNode }> = {
  success: {
    cls: "border-green-500/30 bg-green-50 text-green-800 dark:bg-green-950/60 dark:text-green-200",
    icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden />,
  },
  error: {
    cls: "border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200",
    icon: (
      <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" aria-hidden />
    ),
  },
  info: {
    cls: "border-zinc-300 bg-white text-zinc-800 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100",
    icon: <Info className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback(
    (id: number) => setItems((list) => list.filter((t) => t.id !== id)),
    [],
  );

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = (idRef.current += 1);
      setItems((list) => [...list, { id, kind, message }]);
      window.setTimeout(() => remove(id), 3500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m) => toast(m, "success"),
      error: (m) => toast(m, "error"),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[70] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg ${STYLE[t.kind].cls}`}
          >
            {STYLE[t.kind].icon}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => remove(t.id)}
              aria-label="Dismiss"
              className="-m-1 rounded p-1 opacity-60 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast() must be used within <ToastProvider>");
  return ctx;
}
