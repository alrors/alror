import { sql } from "drizzle-orm";
import { db } from "@/lib/server/db";
import { redis } from "@/lib/server/redis";
import type { Health, HealthCheck } from "@/lib/error-kind";
import pkg from "../../../../../package.json";

// Liveness of the stores the console needs. No auth: it reveals only whether
// Postgres and Redis answer, and how fast. 200 when both are up, 503 otherwise.
// The console's "workspace unavailable" screen polls it to recover by itself.

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 1500;

/** A short reason: the first error code in the cause chain (drizzle wraps driver errors), else the message. */
function reason(e: unknown): string {
  for (let x = e as { code?: unknown; cause?: unknown; errors?: unknown[]; message?: string } | undefined, i = 0; x && i < 6; i++) {
    if (typeof x.code === "string") return x.code;
    if ((x as { name?: unknown }).name === "MaxRetriesPerRequestError") return "not connected";
    x = (x.cause ?? x.errors?.[0]) as typeof x;
  }
  return (e as Error)?.message?.split("\n")[0] || "unreachable";
}

async function check(run: () => Promise<unknown>): Promise<HealthCheck> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
      }),
    ]);
    return { ok: true, latency_ms: Math.round(performance.now() - started) };
  } catch (e) {
    return { ok: false, latency_ms: null, error: reason(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const [postgres, cache] = await Promise.all([check(() => db.execute(sql`select 1`)), check(() => redis().ping())]);
  const ok = postgres.ok && cache.ok;
  const body: Health = {
    status: ok ? "ok" : "degraded",
    postgres,
    redis: cache,
    version: process.env.ALROR_VERSION || pkg.version,
    checked_at: new Date().toISOString(),
  };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
