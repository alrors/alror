"use client";

import { startTransition, useActionState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { kindOf } from "@/lib/error-kind";
import { cn } from "@/lib/site";

/**
 * Console toasts for action results. Anywhere in the console (client code):
 *
 *   import { toast } from "@/components/console/shell-toast";
 *   toast.success("Key revoked.");
 *   toast.error("Could not revoke the key.");
 *
 * or, with a server action state ({ ok, message, error }):
 *
 *   useActionToast(state, { success: "Saved." });
 *
 * Failures marked `retryable` (outages, unexpected errors; see actionError in
 * src/lib/console/action-result.ts) get a Retry button that re-submits the last
 * form data, via useRetryableAction:
 *
 *   const [state, submit, pending, retry] = useRetryableAction(save, undefined);
 *   useActionToast(state, { success: "Saved.", retry });
 *   <form action={submit}>…</form>
 *
 * <ShellToaster /> is mounted once by the console layout.
 */

export type ToastTone = "success" | "error" | "info";
export type ToastAction = { label: string; onClick: () => void };
export type ToastItem = { id: number; tone: ToastTone; title: string; description?: string; duration: number; action?: ToastAction };
export type ToastOptions = { description?: string; duration?: number; action?: ToastAction };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const MAX = 4;

function push(tone: ToastTone, title: string, opts: ToastOptions = {}): number {
  const id = nextId++;
  // Toasts with an action stay long enough to use it.
  const duration = opts.duration ?? (opts.action ? 10_000 : tone === "error" ? 6000 : 3500);
  items = [...items, { id, tone, title, description: opts.description, duration, action: opts.action }].slice(-MAX);
  emit();
  return id;
}

export function dismissToast(id: number) {
  const before = items.length;
  items = items.filter((t) => t.id !== id);
  if (items.length !== before) emit();
}

export const toast = Object.assign((title: string, opts?: ToastOptions) => push("info", title, opts), {
  success: (title: string, opts?: ToastOptions) => push("success", title, opts),
  error: (title: string, opts?: ToastOptions) => push("error", title, opts),
  info: (title: string, opts?: ToastOptions) => push("info", title, opts),
  dismiss: dismissToast,
});

type ResultLike = { ok?: boolean; message?: string; error?: string; retryable?: boolean } | undefined | null;

/** Error toast for a failed action; a Retry button when the failure is retryable and a retry is given. */
export function toastActionError(error: string, opts: { retryable?: boolean; retry?: () => void } = {}) {
  return toast.error(error, opts.retryable && opts.retry ? { action: { label: "Retry", onClick: opts.retry } } : undefined);
}

/**
 * Shows a toast whenever a server action state object changes: an error toast for
 * `error` (with Retry when the result is `retryable` and `retry` is given), a
 * success toast for `ok` (using `message`, or the `success` fallback).
 */
export function useActionToast(state: ResultLike, opts: { success?: string; retry?: () => void } = {}) {
  const seen = useRef<ResultLike>(state);
  const retryRef = useRef(opts.retry);
  useEffect(() => {
    retryRef.current = opts.retry;
  }, [opts.retry]);
  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toastActionError(state.error, { retryable: state.retryable, retry: retryRef.current && (() => retryRef.current?.()) });
    else if (state.ok) {
      const msg = state.message ?? opts.success;
      if (msg) toast.success(msg);
    }
  }, [state, opts.success]);
}

const THROWN: Record<string, string> = {
  database_unavailable: "Alror can't reach its database right now, so nothing was saved. Try again in a moment.",
  cache_unavailable: "Alror can't reach its cache (Redis) right now, so nothing was saved. Try again in a moment.",
};

/**
 * useActionState plus retry(), which re-submits the last FormData. Use `submit`
 * as the form action.
 *
 * An action that throws because Postgres or Redis is down (e.g. in its session
 * check, before its own try/catch) becomes a retryable `{ error }` result here,
 * so the page stays put and the toast offers Retry. The kind comes from the
 * error digest, which survives production builds. Other throws still reach the
 * error boundary.
 */
export function useRetryableAction<S>(action: (prev: Awaited<S>, fd: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const last = useRef<FormData | null>(null);
  const [state, dispatch, pending] = useActionState(async (prev: Awaited<S>, fd: FormData): Promise<Awaited<S>> => {
    try {
      return await action(prev, fd);
    } catch (e) {
      const message = THROWN[kindOf(e as { message?: string; digest?: string })];
      if (!message) throw e;
      return { error: message, retryable: true } as Awaited<S>;
    }
  }, initial);
  const submit = useCallback(
    (fd: FormData) => {
      last.current = fd;
      dispatch(fd);
    },
    [dispatch],
  );
  const retry = useCallback(() => {
    const fd = last.current;
    if (fd) startTransition(() => dispatch(fd));
  }, [dispatch]);
  return [state, submit, pending, retry] as const;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
// Stable references: useSyncExternalStore needs the same value until the list changes.
const EMPTY: ToastItem[] = [];
const serverSnapshot = () => EMPTY;

const ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_TONE = { success: "text-con-fg", error: "text-con-bad", info: "text-con-fg2" } as const;

function ToastCard({ t }: { t: ToastItem }) {
  const Icon = ICON[t.tone];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(t.id), t.duration);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <li
      role={t.tone === "error" ? "alert" : "status"}
      onMouseEnter={stop}
      onMouseLeave={start}
      className="con-fade-up pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-con-line bg-con-panel px-3.5 py-3 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.7)]"
    >
      <Icon size={16} className={cn("mt-px shrink-0", ICON_TONE[t.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-con-fg">{t.title}</p>
        {t.description && <p className="mt-0.5 text-[12px] leading-snug text-con-fg2">{t.description}</p>}
        {t.action && (
          <button
            type="button"
            onClick={() => {
              dismissToast(t.id);
              t.action?.onClick();
            }}
            className="mt-2 inline-flex h-7 items-center rounded-md border border-con-line-hover px-2.5 text-[12px] font-medium text-con-fg transition-colors duration-150 hover:bg-con-hover"
          >
            {t.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss"
        className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-con-fg3 transition-colors duration-150 hover:bg-con-row hover:text-con-fg"
      >
        <X size={13} />
      </button>
    </li>
  );
}

/** Renders the toast stack (bottom right). Mount once. */
export function ShellToaster() {
  const list = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2"
    >
      {list.map((t) => (
        <ToastCard key={t.id} t={t} />
      ))}
    </ol>
  );
}
