import "server-only";
import { notFound } from "next/navigation";
import type { NextRequest } from "next/server";
import { cache } from "react";
import { loadSession } from "../auth/accounts";
import { getSession, SESSION_COOKIE } from "../auth/session";
import { ApiError } from "../errors";
import { isPlatformAdmin, toAdmin, type AdminCtx } from "./access";

// Next.js glue for the admin guard (pages, layouts, actions and route handlers).
// The allow-list itself lives in ./access, which has no Next.js imports.

/**
 * Guard for admin pages, layouts and server actions. Anyone who is not a
 * platform admin (signed out, or a regular user) gets a 404, so the route is
 * not revealed. Deduplicated per request.
 */
export const requirePlatformAdmin = cache(async (): Promise<AdminCtx> => {
  const s = await getSession();
  if (!s || !isPlatformAdmin(s.user.email)) notFound();
  return toAdmin(s);
});

/** Guard for admin route handlers: same rule, as a contract-shaped 404. */
export async function adminFromRequest(req: NextRequest): Promise<AdminCtx> {
  const s = await loadSession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (!s || !isPlatformAdmin(s.user.email)) throw new ApiError(404, "not_found", "Not found.");
  // Same-origin check for cookie-authenticated writes.
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) throw new ApiError(403, "forbidden", "Cross-origin request rejected.");
    }
  }
  return toAdmin(s);
}

