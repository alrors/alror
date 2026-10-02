import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { OrgCtx } from "../context";
import { env } from "../env";
import { classifyError, ServiceUnavailableError } from "../errors";
import { SESSION_TTL_SECONDS } from "../redis";
import { ctxFor, loadSession, type SessionContext } from "./accounts";

// Next.js glue for console sessions: the alror_sid cookie and request-scoped lookups.

export const SESSION_COOKIE = "alror_sid";

/**
 * The validated session for this request, or null. Deduplicated per render.
 * When Redis or Postgres cannot be reached it throws ServiceUnavailableError
 * instead of returning null: a store outage must not look like "signed out"
 * (which would bounce everyone to /login).
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  try {
    return await loadSession(sid);
  } catch (e) {
    // Sessions are read from Redis first, so an unattributed connection failure is the cache.
    const kind = classifyError(e, "cache_unavailable");
    console.error("[alror] session lookup failed:", (e as Error).message);
    if (kind === "database_unavailable" || kind === "cache_unavailable") throw new ServiceUnavailableError(kind, e);
    return null;
  }
});

/** Console guard for pages, layouts and actions: redirects to /login when signed out. */
export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) {
    const target = safeNext((await headers()).get("x-alror-console-path"));
    redirect(target === "/app" ? "/login" : `/login?next=${encodeURIComponent(target)}`);
  }
  return s;
}

/** Org-scoped context for data-layer calls from the console. */
export async function requireCtx(): Promise<OrgCtx> {
  return ctxFor(await requireSession());
}

export async function setSessionCookie(sid: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: env.secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentSid(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Best-effort client IP for rate limiting. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/** Only allow redirects back into the console after login. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/app";
  if (!/^\/app(\/[A-Za-z0-9_\-/]*)?$/.test(next)) return "/app";
  return next;
}
