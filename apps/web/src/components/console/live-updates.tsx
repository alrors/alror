"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "@/lib/site";

const EVENTS = ["deployment.updated", "deployment.event", "job.updated"] as const;
const MIN_GAP_MS = 1500;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
/** Short blips (a dev server restart, a dropped proxy connection) never show the banner. */
const SHOW_AFTER_MS = 3000;
const BACK_ONLINE_MS = 2600;

/* ------------------------------ Connection store ------------------------------ */

export type SyncState = "connecting" | "live" | "reconnecting" | "offline";

export type SyncSnapshot = {
  state: SyncState;
  /** When the next reconnect attempt is due (reconnecting only). */
  retryAt: number | null;
  attempt: number;
  /** The degraded state has lasted long enough to tell the user. */
  visible: boolean;
  /** Just recovered after a visible outage: "back online" or "resumed". */
  recovered: "online" | "resumed" | null;
};

const INITIAL: SyncSnapshot = { state: "connecting", retryAt: null, attempt: 0, visible: false, recovered: null };
let snap: SyncSnapshot = INITIAL;
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncSnapshot>) => {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnap = () => snap;
const getServerSnap = () => INITIAL;

/** The live-updates connection state, for the banner and the top bar indicator. */
export function useSyncStatus(): SyncSnapshot {
  return useSyncExternalStore(subscribe, getSnap, getServerSnap);
}

let retryNowImpl: () => void = () => {};
/** Reconnect immediately instead of waiting for the backoff timer. */
export const retryLiveUpdates = () => retryNowImpl();

/** 1 s, 2 s, 4 s … capped at 30 s, with ±20% jitter so many tabs don't reconnect in step. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

const PREVIEWS = ["offline", "reconnecting", "back"] as const;

/* -------------------------------- Live updates -------------------------------- */

/**
 * Subscribes to /api/v1/stream (session cookie auth) and refreshes the current
 * view when deployments or jobs change. Refreshes are throttled, and paused
 * while the tab is hidden (one catch-up refresh happens when it becomes visible).
 *
 * Connection state: connecting → live; on an error the stream is closed and
 * retried with exponential backoff (1 s to 30 s, jitter); while the browser is
 * offline it waits for the `online` event. A degraded state that lasts more than
 * a few seconds shows a slim banner under the top bar (rendered here) and a
 * status label in the top bar. After a visible outage the view refreshes once to
 * catch up on missed events.
 */
export function LiveUpdates() {
  const router = useRouter();
  useEffect(() => {
    // Development previews: ?preview-sync=offline|reconnecting|back (see /dev/errors).
    if (process.env.NODE_ENV !== "production") {
      const preview = new URLSearchParams(window.location.search).get("preview-sync");
      if ((PREVIEWS as readonly string[]).includes(preview ?? "")) {
        const tick =
          preview === "reconnecting"
            ? setInterval(() => {
                if (snap.retryAt && snap.retryAt <= Date.now()) set({ retryAt: Date.now() + 8000 });
              }, 1000)
            : null;
        if (preview === "offline") set({ state: "offline", visible: true, retryAt: null });
        if (preview === "reconnecting") set({ state: "reconnecting", visible: true, attempt: 4, retryAt: Date.now() + 8000 });
        if (preview === "back") set({ state: "live", visible: false, recovered: "online" });
        retryNowImpl = () => set({ retryAt: Date.now() + 8000 });
        return () => {
          if (tick) clearInterval(tick);
          set(INITIAL);
        };
      }
    }
    if (typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let attempt = 0;
    let disposed = false;
    let wasOffline = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let backTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let missed = false;

    const refresh = () => {
      if (document.visibilityState !== "visible") {
        missed = true;
        return;
      }
      const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        last = Date.now();
        router.refresh();
      }, wait);
    };

    const clear = (t: ReturnType<typeof setTimeout> | null) => {
      if (t) clearTimeout(t);
      return null;
    };

    /** Enter a degraded state; the banner appears only if it lasts (offline shows at once). */
    const degrade = (patch: Partial<SyncSnapshot>, immediate = false) => {
      backTimer = clear(backTimer);
      set({ ...patch, recovered: null, visible: snap.visible || immediate });
      if (!snap.visible && !showTimer) {
        showTimer = setTimeout(() => {
          showTimer = null;
          if (snap.state === "reconnecting" || snap.state === "offline") set({ visible: true });
        }, SHOW_AFTER_MS);
      }
    };

    const close = () => {
      if (!es) return;
      es.onopen = null;
      es.onerror = null;
      es.close();
      es = null;
    };

    const scheduleRetry = () => {
      attempt += 1;
      const delay = backoffDelay(attempt);
      retryTimer = clear(retryTimer);
      retryTimer = setTimeout(connect, delay);
      degrade({ state: "reconnecting", retryAt: Date.now() + delay, attempt });
    };

    function connect() {
      if (disposed) return;
      retryTimer = clear(retryTimer);
      close();
      if (!navigator.onLine) {
        wasOffline = true;
        degrade({ state: "offline", retryAt: null }, true);
        return;
      }
      if (snap.state !== "connecting") set({ state: "reconnecting", retryAt: null });
      const source = new EventSource("/api/v1/stream");
      es = source;
      for (const type of EVENTS) source.addEventListener(type, refresh);
      source.onopen = () => {
        const shown = snap.visible;
        const hadOutage = attempt > 0 || wasOffline;
        showTimer = clear(showTimer);
        attempt = 0;
        set({ state: "live", retryAt: null, attempt: 0, visible: false, recovered: shown ? (wasOffline ? "online" : "resumed") : null });
        wasOffline = false;
        if (shown) {
          backTimer = clear(backTimer);
          backTimer = setTimeout(() => set({ recovered: null }), BACK_ONLINE_MS);
        }
        // Catch up on anything that changed while the stream was down.
        if (hadOutage) refresh();
      };
      source.onerror = () => {
        // EventSource would retry on its own at a fixed interval; take over with backoff.
        close();
        if (!navigator.onLine) {
          wasOffline = true;
          degrade({ state: "offline", retryAt: null }, true);
        } else scheduleRetry();
      };
    }

    retryNowImpl = () => {
      if (disposed) return;
      connect();
    };

    const onOnline = () => {
      attempt = 0;
      connect();
    };
    const onOffline = () => {
      close();
      retryTimer = clear(retryTimer);
      wasOffline = true;
      degrade({ state: "offline", retryAt: null }, true);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (missed) {
        missed = false;
        refresh();
      }
      // A long-hidden tab may have been throttled past its retry time.
      if (snap.state === "reconnecting" && snap.retryAt && snap.retryAt < Date.now()) connect();
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    connect();

    return () => {
      disposed = true;
      close();
      clear(retryTimer);
      clear(showTimer);
      clear(backTimer);
      clear(refreshTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      retryNowImpl = () => {};
      set(INITIAL);
    };
  }, [router]);
  return <SyncBanner />;
}

/* ---------------------------------- Banner ---------------------------------- */

function useSecondsUntil(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [at]);
  if (at === null) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

const retryBtn =
  "rounded text-con-fg underline decoration-con-line-hover underline-offset-4 transition-colors duration-150 hover:decoration-con-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-con-line-hover";

/**
 * Slim status line under the top bar, only while live updates are degraded,
 * plus a short "back online" confirmation that fades out. Static icons, no
 * pulsing; the fade is skipped under prefers-reduced-motion.
 */
export function SyncBanner() {
  const s = useSyncStatus();
  const seconds = useSecondsUntil(s.state === "reconnecting" ? s.retryAt : null);
  const degraded = s.visible && (s.state === "offline" || s.state === "reconnecting");
  const back = s.recovered !== null && s.state === "live";
  if (!degraded && !back) return null;

  let icon = <RefreshCw size={13} className="shrink-0 text-con-warn" />;
  let text: React.ReactNode;
  if (back) {
    icon = <CircleCheck size={13} className="shrink-0 text-con-good" />;
    text = s.recovered === "online" ? "Back online. The page is up to date." : "Live updates resumed. The page is up to date.";
  } else if (s.state === "offline") {
    icon = <WifiOff size={13} className="shrink-0 text-con-fg2" />;
    text = "You're offline; changes will appear when you reconnect.";
  } else {
    text = (
      <>
        Live updates paused,{" "}
        <span className="tabular-nums">{seconds === null || seconds === 0 ? "reconnecting…" : `reconnecting in ${seconds}s`}</span>
        <span aria-hidden className="text-con-fg3">
          {" "}
          ·{" "}
        </span>
        <button type="button" onClick={retryLiveUpdates} className={retryBtn}>
          Retry now
        </button>
      </>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-9 shrink-0 items-center justify-center gap-2 border-b border-con-line bg-con-panel px-4 py-1.5 text-center text-[13px] text-con-fg2",
        back ? "con-sync-fade" : "con-fade",
      )}
    >
      {icon}
      <span role="status" aria-live="polite">
        {text}
      </span>
    </div>
  );
}

/** Top bar label while live updates are degraded: a static dot plus "Reconnecting" or "Offline". */
export function SyncIndicator() {
  const s = useSyncStatus();
  if (!s.visible || (s.state !== "offline" && s.state !== "reconnecting")) return null;
  const offline = s.state === "offline";
  return (
    <button
      type="button"
      onClick={offline ? undefined : retryLiveUpdates}
      title={offline ? "You're offline" : "Live updates paused. Click to retry now."}
      className="con-fade inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-con-line px-2.5 text-[12px] text-con-fg2 transition-colors duration-150 hover:border-con-line-hover hover:text-con-fg"
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", offline ? "bg-con-fg3" : "bg-con-warn")} />
      <span className="hidden sm:inline">{offline ? "Offline" : "Reconnecting"}</span>
      <span className="sr-only sm:hidden">{offline ? "Offline" : "Reconnecting"}</span>
    </button>
  );
}
