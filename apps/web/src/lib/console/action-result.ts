import "server-only";
import { ApiError, classifyError } from "@/lib/server/errors";

export type { ActionResult } from "./action-types";

const OUTAGE: Record<"database_unavailable" | "cache_unavailable", string> = {
  database_unavailable: "Alror can't reach its database right now, so nothing was saved. Try again in a moment.",
  cache_unavailable: "Alror can't reach its cache (Redis) right now, so nothing was saved. Try again in a moment.",
};

/**
 * Turns a thrown error into a user-facing result. ApiErrors (validation,
 * permissions, conflicts) keep their message; a Postgres or Redis outage says
 * so; anything else is logged and shown as the fallback. Outages and unexpected
 * errors are marked `retryable`, so the toast offers Retry.
 */
export function actionError(e: unknown, fallback: string): { error: string; retryable?: boolean } {
  if (e instanceof ApiError) return e.status === 503 ? { error: e.message, retryable: true } : { error: e.message };
  const kind = classifyError(e);
  if (kind === "database_unavailable" || kind === "cache_unavailable") {
    console.error("[alror console]", fallback, `(${kind}):`, (e as Error).message);
    return { error: OUTAGE[kind], retryable: true };
  }
  console.error("[alror console]", fallback, e);
  return { error: fallback, retryable: true };
}

export const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
