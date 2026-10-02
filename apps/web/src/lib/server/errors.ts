// Errors that map onto the API error shape {"error":{"code","message"}}, and the
// classifier that turns anything thrown into an ErrorKind (src/lib/error-kind.ts).

import { env } from "./env";
import { kindDigest, kindFromDigest, looksLikeConnectionFailure, storeFromText, type ErrorKind, type UnavailableKind } from "../error-kind";

export type ErrorCode =
  | "bad_request"
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "ambiguous"
  | "unknown_service"
  | "unknown_environment"
  | "rate_limited"
  | "unavailable"
  | "internal";

export class ApiError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (m: string, details?: unknown) => new ApiError(400, "bad_request", m, details);
export const invalid = (m: string, details?: unknown) => new ApiError(422, "invalid", m, details);
export const unauthorized = (m = "Authentication required.") => new ApiError(401, "unauthorized", m);
export const forbidden = (m = "You do not have permission to do that.") => new ApiError(403, "forbidden", m);
export const notFound = (m = "Not found.") => new ApiError(404, "not_found", m);
export const conflict = (m: string) => new ApiError(409, "conflict", m);

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export const UNAVAILABLE_MESSAGE: Record<UnavailableKind, string> = {
  database_unavailable: "Alror can't reach its database (PostgreSQL).",
  cache_unavailable: "Alror can't reach its cache (Redis).",
};

/**
 * Thrown when Postgres or Redis cannot be reached. It carries a digest of the
 * form "alror:<kind>:<ref>", which Next forwards to error.tsx unchanged (even in
 * production, where the message is stripped), so the boundary can show the
 * "workspace unavailable" screen instead of a generic error.
 */
export class ServiceUnavailableError extends Error {
  readonly digest: string;
  constructor(
    public readonly kind: UnavailableKind,
    cause?: unknown,
    /** Only for the /dev/errors previews (previewDigest). */
    digest?: string,
  ) {
    super(UNAVAILABLE_MESSAGE[kind], { cause });
    this.name = "ServiceUnavailableError";
    this.digest = digest ?? kindDigest(kind);
  }
}

const portOf = (url: string, fallback: number): number => {
  try {
    return Number(new URL(url).port) || fallback;
  } catch {
    return fallback;
  }
};

type Loose = { code?: unknown; message?: unknown; name?: unknown; port?: unknown; address?: unknown; cause?: unknown; errors?: unknown; digest?: unknown };

/** The error, its causes and (for AggregateError, e.g. localhost resolving to ::1 and 127.0.0.1) its members. */
function chain(e: unknown, depth = 0, out: Loose[] = []): Loose[] {
  if (!e || typeof e !== "object" || depth > 5 || out.length > 20) return out;
  const x = e as Loose;
  out.push(x);
  if (Array.isArray(x.errors)) for (const m of x.errors) chain(m, depth + 1, out);
  if (x.cause) chain(x.cause, depth + 1, out);
  return out;
}

/**
 * Maps anything thrown to an ErrorKind. Connection failures are attributed to
 * Postgres or Redis by the port they targeted (compared with DATABASE_URL and
 * REDIS_URL), then by driver error names and text; `hint` decides when nothing
 * else does (e.g. a session lookup that touches both stores).
 */
export function classifyError(e: unknown, hint: UnavailableKind = "database_unavailable"): ErrorKind {
  if (e instanceof ApiError) {
    if (e.status === 401) return "unauthorized";
    if (e.status === 404) return "not_found";
    if (e.status === 429) return "rate_limited";
    if (e.status === 503) return hint;
    return "unknown";
  }
  const dbPort = portOf(env.databaseUrl(), 5432);
  const redisPort = portOf(env.redisUrl(), 6379);
  let connection = false;
  let store: UnavailableKind | null = null;
  for (const x of chain(e)) {
    const known = typeof x.digest === "string" ? kindFromDigest(x.digest) : null;
    if (known) return known;
    const name = typeof x.name === "string" ? x.name : "";
    if (name === "MaxRetriesPerRequestError") return "cache_unavailable";
    if (!looksLikeConnectionFailure(x.code, x.message)) continue;
    connection = true;
    const port = Number(x.port);
    if (port === redisPort) return "cache_unavailable";
    if (port === dbPort) return "database_unavailable";
    store ??= storeFromText(`${name} ${String(x.message ?? "")} ${String(x.address ?? "")}`);
  }
  if (connection) return store ?? hint;
  return "unknown";
}

/** Rethrows connection failures as ServiceUnavailableError (classified digest); anything else unchanged. */
export function rethrowClassified(e: unknown, hint?: UnavailableKind): never {
  if (e instanceof ServiceUnavailableError) throw e;
  const kind = classifyError(e, hint);
  if (kind === "database_unavailable" || kind === "cache_unavailable") throw new ServiceUnavailableError(kind, e);
  throw e;
}
