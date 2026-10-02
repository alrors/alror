"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronRight, RefreshCw, RotateCw } from "lucide-react";
import { Spinner } from "@/components/console/loader";
import { buttonClass } from "@/components/console/primitives";
import { ErrorReference } from "@/components/errors/error-reference";
import { ErrorView, errorLink } from "@/components/errors/error-view";
import { WorkspaceUnavailable } from "@/components/errors/workspace-unavailable";
import { isPreviewDigest, isUnavailable, kindOf, type ErrorKind, type Health, type UnavailableKind } from "@/lib/error-kind";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  /** Next 16: re-fetches and re-renders the segment. */
  retry?: () => void;
  /** Older name, clears the boundary without re-fetching. */
  reset?: () => void;
};

type Scope = "site" | "console" | "admin";

/**
 * For errors the server did not classify (a raw driver error thrown by a page's
 * data loading arrives in production as a bare digest), ask /api/v1/health once:
 * if a store is down, that is the real story.
 */
function useProbedKind(kind: ErrorKind): UnavailableKind | null {
  const [probed, setProbed] = useState<UnavailableKind | null>(null);
  useEffect(() => {
    if (kind !== "unknown") return;
    let live = true;
    fetch("/api/v1/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then((h) => {
        if (!live || h.status === "ok") return;
        setProbed(!h.postgres.ok ? "database_unavailable" : "cache_unavailable");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind]);
  return probed;
}

const COPY: Record<Scope, { title: string; body: string }> = {
  site: {
    title: "Something went wrong",
    body: "This page ran into an unexpected error. Trying again usually works. If it keeps happening, send the error reference below to whoever runs your Alror instance.",
  },
  console: {
    title: "Something went wrong loading this page",
    body: "The rest of the console is still available. Try again, or reload the page if the problem persists. If it keeps happening, share the error reference with your Alror admin.",
  },
  admin: {
    title: "Something went wrong loading this page",
    body: "The rest of the admin area is still available. Try again, or reload the page. The server log has the full error under the reference below.",
  },
};

export function RouteError({ error, retry, reset, scope }: RouteErrorProps & { scope: Scope }) {
  const kind = kindOf(error);
  const probed = useProbedKind(kind);
  const [pending, start] = useTransition();
  const again = () => start(() => (retry ?? reset)?.());

  useEffect(() => {
    console.error(error);
  }, [error]);

  const unavailable = isUnavailable(kind) ? kind : probed;
  if (unavailable) {
    return (
      <WorkspaceUnavailable
        kind={unavailable}
        variant={scope === "site" ? "page" : "panel"}
        digest={error.digest}
        onRecover={again}
        preview={isPreviewDigest(error.digest)}
      />
    );
  }

  const variant = scope === "site" ? "page" : "panel";
  const home = scope === "admin" ? "/admin" : "/app";

  if (kind === "unauthorized") {
    return (
      <ErrorView
        variant={variant}
        eyebrow="401"
        title="Your session has ended"
        actions={
          <a href="/login" className={buttonClass.primary}>
            Sign in again
          </a>
        }
        footer={<ErrorReference digest={error.digest} />}
      >
        <p>For your security, sessions end after a week without activity or when you sign out elsewhere. Sign in to pick up where you left off.</p>
      </ErrorView>
    );
  }

  if (kind === "rate_limited") {
    return (
      <ErrorView
        variant={variant}
        eyebrow="429"
        title="Too many requests"
        actions={
          <button type="button" onClick={again} disabled={pending} className={buttonClass.primary}>
            {pending ? <Spinner size={13} /> : <RotateCw size={13} />}
            Try again
          </button>
        }
        footer={<ErrorReference digest={error.digest} />}
      >
        <p>Alror is limiting requests from you for a moment. Wait a few seconds, then try again.</p>
      </ErrorView>
    );
  }

  const copy = COPY[scope];
  const dev = process.env.NODE_ENV !== "production";
  return (
    <ErrorView
      variant={variant}
      eyebrow="Error"
      title={copy.title}
      actions={
        <>
          <button type="button" onClick={again} disabled={pending} className={buttonClass.primary}>
            {pending ? <Spinner size={13} /> : <RotateCw size={13} />}
            Try again
          </button>
          {scope === "site" ? (
            <Link href="/" className={buttonClass.secondary}>
              Go to the home page
            </Link>
          ) : (
            <button type="button" onClick={() => window.location.reload()} className={buttonClass.secondary}>
              <RefreshCw size={13} />
              Reload page
            </button>
          )}
        </>
      }
      links={
        <>
          <Link href={home} className={errorLink}>
            {scope === "admin" ? "Admin overview" : "Console overview"}
          </Link>
          {scope !== "admin" && (
            <Link href="/app/deployments" className={errorLink}>
              Deployments
            </Link>
          )}
          <a href="/api/v1/health" target="_blank" rel="noreferrer" className={errorLink}>
            Service health
          </a>
        </>
      }
      aside={
        dev && (error.message || error.stack) ? (
          <details className="group rounded-lg border border-con-line bg-con-panel">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
              <ChevronRight size={14} className="text-con-fg3 transition-transform duration-150 group-open:rotate-90" />
              Error details
              <span className="ml-auto text-[11px] uppercase tracking-[0.06em] text-con-fg3">Development only</span>
            </summary>
            <div className="border-t border-con-line px-4 py-3">
              <p className="break-words font-mono text-[12px] text-con-fg">{error.message}</p>
              {error.stack && (
                <pre className="con-scroll mt-3 max-h-64 overflow-auto whitespace-pre font-mono text-[11px] leading-relaxed text-con-fg3">{error.stack}</pre>
              )}
            </div>
          </details>
        ) : undefined
      }
      footer={<ErrorReference digest={error.digest} />}
    >
      <p>{copy.body}</p>
    </ErrorView>
  );
}
