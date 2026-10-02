"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { ErrorReference } from "@/components/errors/error-reference";
import { ErrorView, errorLink } from "@/components/errors/error-view";
import { AlrorLoader, Spinner } from "@/components/console/loader";
import { buttonClass, Dot } from "@/components/console/primitives";
import type { Health, HealthCheck, UnavailableKind } from "@/lib/error-kind";

const POLL_MS = 10_000;
/** After asking the page to recover, give it this long before polling again. */
const SETTLE_MS = 6_000;

type Probe = { health: Health | null; reachable: boolean };

async function probe(): Promise<Probe> {
  try {
    const res = await fetch("/api/v1/health", { cache: "no-store", headers: { accept: "application/json" } });
    return { health: (await res.json()) as Health, reachable: true };
  } catch {
    return { health: null, reachable: false };
  }
}

/**
 * Polls GET /api/v1/health every 10 s (and on demand). Calls onHealthy once the
 * stores answer again; if the page is still here a few seconds later (the retry
 * failed), polling resumes.
 */
export function useHealthPoll(onHealthy: () => void, { enabled = true, simulate }: { enabled?: boolean; simulate?: Health } = {}) {
  const [result, setResult] = useState<Probe | null>(null);
  const [checking, setChecking] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onHealthyRef = useRef(onHealthy);
  const checkRef = useRef<() => void>(() => {});
  useEffect(() => {
    onHealthyRef.current = onHealthy;
  }, [onHealthy]);

  const check = useCallback(async () => {
    const later = (ms: number, fn: () => void) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(fn, ms);
    };
    if (timer.current) clearTimeout(timer.current);
    setNextAt(null);
    setChecking(true);
    const r = simulate ? { health: { ...simulate, checked_at: new Date().toISOString() }, reachable: true } : await probe();
    setResult(r);
    setChecking(false);
    if (r.health?.status === "ok") {
      setRecovering(true);
      onHealthyRef.current();
      later(SETTLE_MS, () => {
        setRecovering(false);
        setNextAt(Date.now() + POLL_MS);
        later(POLL_MS, () => checkRef.current());
      });
      return;
    }
    setNextAt(Date.now() + POLL_MS);
    setNow(Date.now());
    later(POLL_MS, () => checkRef.current());
  }, [simulate]);

  useEffect(() => {
    checkRef.current = () => void check();
  }, [check]);

  useEffect(() => {
    if (!enabled) return;
    timer.current = setTimeout(() => void check(), 0);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, check]);

  // One-second clock for the countdown; only runs while a check is scheduled.
  useEffect(() => {
    if (nextAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [nextAt]);

  const seconds = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  return { result, checking, recovering, seconds, check };
}

const down: HealthCheck = { ok: false, latency_ms: null, error: "ECONNREFUSED" };
const up: HealthCheck = { ok: true, latency_ms: 2 };
const SIMULATED: Record<UnavailableKind, Health> = {
  database_unavailable: { status: "degraded", postgres: down, redis: up, version: "preview", checked_at: "" },
  cache_unavailable: { status: "degraded", postgres: up, redis: down, version: "preview", checked_at: "" },
};

const COPY: Record<UnavailableKind | "both", { title: string; what: string }> = {
  database_unavailable: {
    title: "Alror can't reach its database",
    what: "Deployments, services, policies and settings live in PostgreSQL, so this page can't load until the connection is back. Nothing is lost by waiting, and this page reconnects on its own.",
  },
  cache_unavailable: {
    title: "Alror can't reach its cache (Redis)",
    what: "Sessions, live updates and the job queue run through Redis. Until it answers, Alror can't confirm who you are, so the console is paused. This page reconnects on its own.",
  },
  both: {
    title: "Alror can't reach its database or cache",
    what: "Neither PostgreSQL nor Redis is answering, which usually means the local services are stopped. This page reconnects on its own once they are back.",
  },
};

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border border-con-line font-mono text-[11px] text-con-fg3">{n}</span>
      <div className="min-w-0 text-[13px] leading-relaxed text-con-fg2">{children}</div>
    </li>
  );
}

const code = "whitespace-nowrap rounded border border-con-line bg-con-panel px-1.5 py-0.5 font-mono text-[12px] text-con-fg";

function StoreRow({ name, check, pending }: { name: string; check: HealthCheck | undefined; pending: boolean }) {
  const state = !check ? (pending ? "Checking" : "Not checked yet") : check.ok ? "Connected" : "Unreachable";
  const tone = !check ? "idle" : check.ok ? "good" : "bad";
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-[13px] text-con-fg">{name}</span>
      <span className="flex min-w-0 items-center gap-2 text-[12px] text-con-fg2">
        <Dot tone={tone} />
        <span className="shrink-0">{state}</span>
        {check?.ok && check.latency_ms !== null && <span className="font-mono text-con-fg3">{check.latency_ms} ms</span>}
        {check && !check.ok && check.error && <span className="truncate font-mono text-con-fg3">{check.error}</span>}
      </span>
    </div>
  );
}

/**
 * Shown instead of a generic error when Postgres or Redis is unreachable: what
 * it means, what to check, the live state of both stores and an automatic retry.
 */
export function WorkspaceUnavailable({
  kind,
  variant = "page",
  digest,
  onRecover,
  autoCheck = true,
  preview = false,
}: {
  kind: UnavailableKind;
  variant?: "page" | "panel";
  digest?: string | null;
  /** Called when the health check passes: retry() in an error boundary, router.refresh() elsewhere. */
  onRecover: () => void;
  autoCheck?: boolean;
  /** /dev/errors preview: simulated health (the stores are actually fine), never recovers. */
  preview?: boolean;
}) {
  const simulate = preview ? SIMULATED[kind] : undefined;
  const { result, checking, recovering, seconds, check } = useHealthPoll(onRecover, { enabled: autoCheck, simulate });
  const h = result?.health ?? null;
  // Trust the live check over the original error once it has answered.
  const live: UnavailableKind | "both" =
    h && !h.postgres.ok && !h.redis.ok ? "both" : h && !h.postgres.ok ? "database_unavailable" : h && !h.redis.ok ? "cache_unavailable" : kind;
  const copy = COPY[live];
  const envVar = live === "cache_unavailable" ? "REDIS_URL" : "DATABASE_URL";
  const busy = checking || recovering;

  const status = recovering
    ? "Connection is back. Reloading…"
    : checking
      ? "Checking the connection…"
      : result && !result.reachable
        ? `The Alror server didn't answer. Checking again in ${seconds ?? 10}s`
        : seconds !== null
          ? `Checking again in ${seconds}s`
          : autoCheck
            ? "Checking the connection…"
            : "Preview: automatic checks are off.";

  return (
    <ErrorView
      variant={variant}
      eyebrow="503"
      mark={busy ? <AlrorLoader size={40} /> : undefined}
      title={copy.title}
      actions={
        <>
          <button type="button" onClick={() => void check()} disabled={busy} className={buttonClass.primary}>
            {busy ? <Spinner size={13} /> : <RotateCw size={13} />}
            Retry now
          </button>
          <a href="/api/v1/health" target="_blank" rel="noreferrer" className={buttonClass.secondary}>
            Health check
            <ArrowUpRight size={13} className="text-con-fg3" />
          </a>
        </>
      }
      links={
        variant === "page" ? (
          <Link href="/" className={errorLink}>
            Go to the home page
          </Link>
        ) : undefined
      }
      aside={
        <div className="space-y-6">
          <section aria-label="Connection status" className="overflow-hidden rounded-lg border border-con-line bg-con-panel">
            <div className="divide-y divide-con-line">
              <StoreRow name="PostgreSQL" check={h?.postgres} pending={checking} />
              <StoreRow name="Redis" check={h?.redis} pending={checking} />
            </div>
          </section>
          <section aria-labelledby="unavailable-checks">
            <h2 id="unavailable-checks" className="text-[13px] font-medium text-con-fg">
              What to check
            </h2>
            <ol className="mt-3 space-y-3">
              <Step n={1}>
                Start the local services from the <span className="font-mono text-[12px]">web</span> directory: <code className={code}>docker compose up -d</code>
              </Step>
              <Step n={2}>
                Make sure <code className={code}>{envVar}</code>
                {live === "both" && (
                  <>
                    {" "}
                    and <code className={code}>REDIS_URL</code>
                  </>
                )}{" "}
                in <span className="font-mono text-[12px]">.env.local</span> (or the server&apos;s environment) point at a running server.
              </Step>
              <Step n={3}>
                {live === "cache_unavailable"
                  ? "If Redis was reset, sessions went with it: you'll be asked to sign in again once it's back."
                  : "If it runs elsewhere, check that this server can reach it and that it isn't at its connection limit."}
              </Step>
            </ol>
          </section>
        </div>
      }
      footer={
        <ErrorReference digest={digest}>
          <span role="status" aria-live="polite" className="tabular-nums">
            {status}
          </span>
        </ErrorReference>
      }
    >
      <p>{copy.what}</p>
    </ErrorView>
  );
}
