import type { NextRequest } from "next/server";
import { route } from "@/lib/server/api/http";
import { clientIp } from "@/lib/server/auth/session";
import { authenticateAlertToken } from "@/lib/server/data/alert-settings";
import { ingestAlerts } from "@/lib/server/data/incidents";
import { ApiError, badRequest, notFound, unauthorized } from "@/lib/server/errors";
import { rateLimitHit, rateLimitPeek } from "@/lib/server/redis";
import { ALERT_SOURCES, AlertPayloadError, isAlertSource, normalizeAlerts } from "@/lib/incidents/normalize";

// Alert intake: Alertmanager, Datadog, Sentry or generic JSON webhooks.
// Authenticated with the org's alert webhook secret (Settings -> Integrations),
// sent as X-Alror-Token, Authorization: Bearer alrwh_…, or ?token= for tools
// that cannot set headers. See docs/platform-contract.md ("Alert intake").

type Ctx = { params: Promise<{ source: string }> };

/** Requests per org per minute. */
const ORG_LIMIT = 120;
/** Requests without a valid secret per client IP per minute. */
const BAD_TOKEN_LIMIT = 30;
const WINDOW_SECONDS = 60;
const MAX_BODY_BYTES = 1024 * 1024;

function tokenOf(req: NextRequest): string {
  const header = req.headers.get("x-alror-token")?.trim();
  if (header) return header;
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (m) return m[1];
  return req.nextUrl.searchParams.get("token")?.trim() ?? "";
}

const limited = (what: string, retry: number) =>
  new ApiError(429, "rate_limited", `Too many ${what}. Try again in ${retry} seconds.`, { retry_after: retry });

export const POST = route<Ctx>(async (req, { params }) => {
  const { source } = await params;
  if (!isAlertSource(source)) throw notFound(`Unknown alert source "${source}". Use one of: ${ALERT_SOURCES.join(", ")}.`);

  const ipKey = `rl:alerts:ip:${await clientIp()}`;
  const ip = await rateLimitPeek(ipKey, BAD_TOKEN_LIMIT);
  if (!ip.allowed) throw limited("requests with an invalid alert secret", ip.retryAfter);

  const token = tokenOf(req);
  const auth = token ? await authenticateAlertToken(token) : null;
  if (!auth) {
    await rateLimitHit(ipKey, BAD_TOKEN_LIMIT, WINDOW_SECONDS);
    throw unauthorized(token ? "Invalid or revoked alert secret." : "Send the alert secret as X-Alror-Token, Authorization: Bearer, or ?token=.");
  }

  const rl = await rateLimitHit(`rl:alerts:${auth.orgId}`, ORG_LIMIT, WINDOW_SECONDS);
  if (!rl.allowed) throw limited("alerts for this organization", rl.retryAfter);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw badRequest("Alert payload is larger than 1 MB.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }

  let alerts;
  try {
    alerts = normalizeAlerts(source, body);
  } catch (e) {
    if (e instanceof AlertPayloadError) throw new ApiError(422, "invalid", e.message);
    throw e;
  }

  const results = await ingestAlerts(auth.orgId, source, alerts);
  return Response.json({ source, received: alerts.length, results }, { status: 202 });
});
