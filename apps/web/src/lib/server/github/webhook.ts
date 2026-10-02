import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { githubDeliveries } from "../db/schema";

export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
const events = new Set(["installation", "installation_repositories", "pull_request", "pull_request_review", "check_run", "check_suite", "status", "push"]);
export function verifySignature(body: Uint8Array, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

export async function acceptWebhook(request: Request): Promise<Response> {
  const secret = process.env.ALROR_GITHUB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "GitHub webhooks are not configured." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > MAX_WEBHOOK_BYTES) return new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_WEBHOOK_BYTES) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks);
  if (!verifySignature(body, request.headers.get("x-hub-signature-256"), secret)) return new Response(null, { status: 401 });
  const delivery = request.headers.get("x-github-delivery"), event = request.headers.get("x-github-event");
  if (!delivery || !/^[a-zA-Z0-9-]{1,100}$/.test(delivery) || !event) return new Response(null, { status: 400 });
  if (event === "ping" || !events.has(event)) return Response.json({ accepted: true, ignored: true });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf8"));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
  } catch { return new Response(null, { status: 400 }); }
  const installation = payload.installation as { id?: unknown } | undefined;
  const repository = payload.repository as { id?: unknown } | undefined;
  const numericId = (id: unknown) => (typeof id === "number" && Number.isSafeInteger(id) && id > 0) ? String(id) : null;
  await db.insert(githubDeliveries).values({ id: delivery, event, installationId: numericId(installation?.id), repositoryId: numericId(repository?.id), payload }).onConflictDoNothing();
  return Response.json({ accepted: true }, { status: 202 });
}
