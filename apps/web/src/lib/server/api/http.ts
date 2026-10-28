import "server-only";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ctxFor, loadSession, type SessionContext } from "../auth/accounts";
import { authenticateApiKey } from "../auth/api-keys";
import { SESSION_COOKIE } from "../auth/session";
import { requireScope, type OrgCtx } from "../context";
import type { Scope } from "../db/schema";
import { ApiError, badRequest, classifyError, ERROR_FIX, errorDocsUrl, forbidden, UNAVAILABLE_MESSAGE, unauthorized } from "../errors";

export type Auth = {
  ctx: OrgCtx;
  org: { id: string; slug: string; name: string };
  via: "api_key" | "session";
  session?: SessionContext;
};

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The caller's X-Request-Id when well formed, else a new one. */
export function requestId(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && REQUEST_ID.test(given) ? given : `req_${randomBytes(8).toString("hex")}`;
}

/** The contract's error body: {"error":{"code","message","fix","docs_url","request_id","details"?}}. */
export function errorResponse(e: ApiError, reqId?: string): Response {
  const headers: Record<string, string> = {};
  const retry = (e.details as { retry_after?: number } | undefined)?.retry_after;
  if (e.status === 429 && retry) headers["Retry-After"] = String(retry);
  if (e.status === 503) headers["Retry-After"] = "10";
  if (e.status === 401) headers["WWW-Authenticate"] = 'Bearer realm="alror"';
  if (reqId) headers["X-Request-Id"] = reqId;
  return Response.json(
    {
      error: {
        code: e.code,
        message: e.message,
        fix: e.fix ?? ERROR_FIX[e.code],
        docs_url: errorDocsUrl(e.code),
        ...(reqId ? { request_id: reqId } : {}),
        ...(e.details !== undefined && e.status !== 429 ? { details: e.details } : {}),
      },
    },
    { status: e.status, headers },
  );
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Same-origin check for cookie-authenticated writes (SameSite=Lax already blocks most CSRF). */
function checkOrigin(req: NextRequest) {
  if (!UNSAFE.has(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw forbidden("Cross-origin request rejected.");
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw forbidden("Bad Origin header.");
  }
}

/**
 * Authenticates a request by Bearer API key or the console session cookie.
 * `sessionOnly` rejects keys (e.g. /stream).
 */
export async function authenticate(req: NextRequest, opts: { sessionOnly?: boolean } = {}): Promise<Auth> {
  const header = req.headers.get("authorization");
  if (header) {
    if (opts.sessionOnly) throw forbidden("This endpoint needs a console session, not an API key.");
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) throw unauthorized("Malformed Authorization header; use: Bearer alr_live_…");
    const auth = await authenticateApiKey(m[1]);
    if (!auth) throw unauthorized("Invalid or revoked API key.");
    return { ctx: auth.ctx, org: auth.org, via: "api_key" };
  }
  const session = await loadSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw unauthorized();
  checkOrigin(req);
  return { ctx: ctxFor(session), org: { id: session.org.id, slug: session.org.slug, name: session.org.name }, via: "session", session };
}

/** Authenticates and checks one scope. */
export async function authorize(req: NextRequest, scope: Scope | null, opts: { sessionOnly?: boolean } = {}): Promise<Auth> {
  const auth = await authenticate(req, opts);
  if (scope) requireScope(auth.ctx, scope);
  return auth;
}

/** Reads and validates a JSON body. 400 on malformed JSON, 422 on schema errors. */
export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return parse(schema, raw);
}

export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const issues = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw new ApiError(422, "invalid", first ? `${first.path || "body"}: ${first.message}` : "Invalid request.", issues);
  }
  return r.data;
}

/** The X-Alror-Source header the CLI sends (cli | ci | runner), if valid. */
export function sourceHint(req: NextRequest): "cli" | "ci" | "runner" | undefined {
  const v = req.headers.get("x-alror-source")?.trim().toLowerCase();
  return v === "cli" || v === "ci" || v === "runner" ? v : undefined;
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

/**
 * Wraps a route handler: ApiErrors become contract-shaped errors, a Postgres or
 * Redis outage a 503 `unavailable` (with Retry-After), anything else a logged 500.
 */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const id = requestId(req);
    let res: Response;
    try {
      res = await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e, id);
      const kind = classifyError(e);
      if (kind === "database_unavailable" || kind === "cache_unavailable") {
        console.error(`[alror] ${id} ${req.method} ${req.nextUrl.pathname} failed: ${kind}:`, (e as Error).message);
        return errorResponse(new ApiError(503, "unavailable", `${UNAVAILABLE_MESSAGE[kind]} Try again shortly.`, { reason: kind }), id);
      }
      console.error(`[alror] ${id} ${req.method} ${req.nextUrl.pathname} failed:`, e);
      return errorResponse(new ApiError(500, "internal", "Internal server error."), id);
    }
    // Streams and responses with immutable headers keep theirs.
    try {
      if (!res.headers.has("X-Request-Id")) res.headers.set("X-Request-Id", id);
    } catch {
      // immutable headers (e.g. a proxied response): nothing to add
    }
    return res;
  };
}
