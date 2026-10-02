// Error kinds shared by the server (classification) and the client (error screens).
// Safe to import from client components: no server dependencies.
//
// Server Components cannot hand custom error objects to error.tsx. In production
// the client only receives `digest`, and Next keeps a digest that the thrown
// error already carries. So classified errors are thrown with a digest of the
// form "alror:<kind>:<ref>" (see src/lib/server/errors.ts), and error.tsx reads
// the kind back with kindOf(). Nothing sensitive goes into the digest.

export const ERROR_KINDS = ["database_unavailable", "cache_unavailable", "unauthorized", "not_found", "rate_limited", "unknown"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export type UnavailableKind = Extract<ErrorKind, "database_unavailable" | "cache_unavailable">;

const DIGEST_PREFIX = "alror:";

export const isUnavailable = (k: ErrorKind): k is UnavailableKind => k === "database_unavailable" || k === "cache_unavailable";

/** A stable digest for a classified error: "alror:<kind>:<short ref>". */
export function kindDigest(kind: ErrorKind): string {
  const ref = Math.random().toString(36).slice(2, 10);
  return `${DIGEST_PREFIX}${kind}:${ref}`;
}

/** Digest for the /dev/errors previews: the screens render as usual but don't poll or auto-recover. */
export const previewDigest = (kind: ErrorKind) => `${DIGEST_PREFIX}${kind}:preview`;
export const isPreviewDigest = (digest: string | undefined | null) => Boolean(digest?.startsWith(DIGEST_PREFIX) && digest.endsWith(":preview"));

/** The kind encoded in a digest, or null for Next's own hashed digests. */
export function kindFromDigest(digest: string | undefined | null): ErrorKind | null {
  if (!digest || !digest.startsWith(DIGEST_PREFIX)) return null;
  const kind = digest.slice(DIGEST_PREFIX.length).split(":")[0];
  return (ERROR_KINDS as readonly string[]).includes(kind) ? (kind as ErrorKind) : null;
}

// Node / driver signals that a connection could not be made or was lost.
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "CONNECT_TIMEOUT", // postgres.js
  "CONNECTION_CLOSED", // postgres.js
  "CONNECTION_ENDED", // postgres.js
  "CONNECTION_DESTROYED", // postgres.js
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
]);

const CONNECTION_TEXT =
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|CONNECT_TIMEOUT|CONNECTION_(?:CLOSED|ENDED|DESTROYED)|Connection is closed|Connection terminated|max retries per request|Stream isn't writeable|the database system is (?:starting up|shutting down)|too many clients/i;

/** True when a code or message looks like "could not reach the server". */
export function looksLikeConnectionFailure(code: unknown, message: unknown): boolean {
  if (typeof code === "string" && (CONNECTION_CODES.has(code) || code.startsWith("08"))) return true;
  return typeof message === "string" && CONNECTION_TEXT.test(message);
}

/** Best-effort guess at which store a connection failure came from, by text alone. */
export function storeFromText(text: string): UnavailableKind | null {
  if (/redis|ioredis|max retries per request|:6379\b|Stream isn't writeable/i.test(text)) return "cache_unavailable";
  if (/postgres|database|:5432\b|CONNECT_TIMEOUT|CONNECTION_(?:CLOSED|ENDED|DESTROYED)|too many clients/i.test(text)) return "database_unavailable";
  return null;
}

/**
 * The kind of an error that reached an error boundary. Uses the digest first
 * (works in production); in development the original message is also
 * available, so connection failures that were not classified on the server
 * are still recognised.
 */
export function kindOf(error: { message?: string; digest?: string } | null | undefined): ErrorKind {
  const fromDigest = kindFromDigest(error?.digest);
  if (fromDigest) return fromDigest;
  const message = error?.message ?? "";
  if (looksLikeConnectionFailure(undefined, message)) return storeFromText(message) ?? "database_unavailable";
  return "unknown";
}

/** Health payload of GET /api/v1/health. */
export type HealthCheck = { ok: boolean; latency_ms: number | null; error?: string };
export type Health = { status: "ok" | "degraded"; postgres: HealthCheck; redis: HealthCheck; version: string; checked_at: string };
