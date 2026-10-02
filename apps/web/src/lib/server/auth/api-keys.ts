import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireAdmin, type Actor, type OrgCtx } from "../context";
import { db } from "../db";
import { apiKeys, orgs, SCOPES, users, type Scope } from "../db/schema";
import { invalid, notFound } from "../errors";
import { writeAudit } from "../data/audit";
import { base62, sha256Hex } from "./crypto";

export const KEY_PREFIX = "alr_live_";
export const KEY_RE = /^alr_live_[0-9A-Za-z]{32}$/;

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  /** Email of the user who created the key, when known. */
  created_by?: string | null;
};

const toKey = (r: typeof apiKeys.$inferSelect, createdBy?: string | null): ApiKey => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scopes: r.scopes,
  created_at: r.createdAt.toISOString(),
  last_used_at: r.lastUsedAt?.toISOString() ?? null,
  revoked_at: r.revokedAt?.toISOString() ?? null,
  ...(createdBy !== undefined ? { created_by: createdBy } : {}),
});

export function newToken(): string {
  return KEY_PREFIX + base62(32);
}

/**
 * Creates an API key. The token is returned exactly once; only its sha256 is
 * stored. Owners/admins only (the seed passes `authorized`).
 */
export async function createApiKey(
  ctx: OrgCtx,
  input: { name: string; scopes: Scope[] },
  opts: { authorized?: boolean } = {},
): Promise<{ key: ApiKey; token: string }> {
  if (!opts.authorized) requireAdmin(ctx);
  const name = input.name.trim().slice(0, 80);
  if (!name) throw invalid("Give the key a name.");
  const scopes = [...new Set(input.scopes)];
  if (scopes.length === 0 || scopes.some((s) => !SCOPES.includes(s))) throw invalid(`Scopes must be some of: ${SCOPES.join(", ")}.`);
  const token = newToken();
  const [row] = await db
    .insert(apiKeys)
    .values({ orgId: ctx.orgId, name, prefix: token.slice(0, 12), keyHash: sha256Hex(token), scopes, createdBy: ctx.actor.userId ?? null })
    .returning();
  await writeAudit(ctx, "api_key.create", row.prefix, { key_id: row.id, name, scopes });
  return { key: toKey(row, ctx.actor.type === "user" ? ctx.actor.label : null), token };
}

export async function listApiKeys(ctx: OrgCtx, opts: { includeRevoked?: boolean } = {}): Promise<ApiKey[]> {
  const rows = await db
    .select({ k: apiKeys, by: users.email })
    .from(apiKeys)
    .leftJoin(users, eq(users.id, apiKeys.createdBy))
    .where(and(eq(apiKeys.orgId, ctx.orgId), opts.includeRevoked ? undefined : isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => toKey(r.k, r.by ?? null));
}

export async function revokeApiKey(ctx: OrgCtx, id: string): Promise<void> {
  requireAdmin(ctx);
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, ctx.orgId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning();
  if (!row) throw notFound("API key not found.");
  await writeAudit(ctx, "api_key.revoke", row.prefix, { key_id: row.id, name: row.name });
}

export type KeyAuth = { ctx: OrgCtx; org: { id: string; slug: string; name: string } };

/**
 * Resolves a bearer token to its org and scopes. Returns null for malformed,
 * unknown or revoked keys. last_used_at is bumped at most once a minute.
 */
export async function authenticateApiKey(token: string): Promise<KeyAuth | null> {
  if (!KEY_RE.test(token)) return null;
  const [r] = await db
    .select({ key: apiKeys, org: orgs })
    .from(apiKeys)
    .innerJoin(orgs, eq(orgs.id, apiKeys.orgId))
    .where(and(eq(apiKeys.keyHash, sha256Hex(token)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!r) return null;
  if (!r.key.lastUsedAt || Date.now() - r.key.lastUsedAt.getTime() > 60_000) {
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(and(eq(apiKeys.id, r.key.id), sql`(${apiKeys.lastUsedAt} is null or ${apiKeys.lastUsedAt} < now() - interval '1 minute')`));
  }
  const actor: Actor = { type: "api_key", id: r.key.id, label: `${r.key.name} (${r.key.prefix}…)`, keyId: r.key.id, scopes: r.key.scopes };
  return { ctx: { orgId: r.org.id, actor }, org: { id: r.org.id, slug: r.org.slug, name: r.org.name } };
}
