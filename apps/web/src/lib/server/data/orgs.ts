import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { writeAudit } from "./audit";
import { environments, memberships, orgPolicies, orgs, type Plan, type Role } from "../db/schema";

export type Org = { id: string; slug: string; name: string; plan: Plan; created_at: string };
export type OrgWithRole = Org & { role: Role };

const toOrg = (r: typeof orgs.$inferSelect): Org => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  plan: r.plan,
  created_at: r.createdAt.toISOString(),
});

export const DEFAULT_ENVIRONMENTS = [
  { name: "production", protected: true },
  { name: "staging", protected: false },
];

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  const root = slugify(base);
  const rows = await tx
    .select({ slug: orgs.slug })
    .from(orgs)
    .where(sql`${orgs.slug} = ${root} or ${orgs.slug} like ${root + "-%"}`);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

/** Creates an org with its owner, the default environments and the default policy. */
export async function createOrgWithOwner(
  tx: Tx,
  input: { name: string; slug?: string; ownerId: string; plan?: Plan },
): Promise<Org> {
  const slug = input.slug ? slugify(input.slug) : await uniqueSlug(tx, input.name);
  const [org] = await tx
    .insert(orgs)
    .values({ name: input.name.trim() || slug, slug, plan: input.plan ?? "team" })
    .returning();
  await tx.insert(memberships).values({ orgId: org.id, userId: input.ownerId, role: "owner" });
  await tx.insert(environments).values(DEFAULT_ENVIRONMENTS.map((e) => ({ ...e, orgId: org.id })));
  await tx.insert(orgPolicies).values({ orgId: org.id, updatedBy: input.ownerId });
  return toOrg(org);
}

export async function getOrg(orgId: string): Promise<Org | null> {
  const [r] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
  return r ? toOrg(r) : null;
}

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const [r] = await db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  return r ? toOrg(r) : null;
}

/** Orgs the user belongs to, oldest membership first. */
export async function listOrgsForUser(userId: string): Promise<OrgWithRole[]> {
  const rows = await db
    .select({ org: orgs, role: memberships.role })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
  return rows.map((r) => ({ ...toOrg(r.org), role: r.role }));
}

export async function membershipRole(orgId: string, userId: string): Promise<Role | null> {
  const [r] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
    .limit(1);
  return r?.role ?? null;
}

export const ORG_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * Renames the org and/or changes its slug (owners and admins). The slug is the
 * `project` that GET /config reports, so CLIs pick the new value up on their next run.
 */
export async function updateOrg(ctx: OrgCtx, patch: { name?: string; slug?: string }): Promise<Org> {
  requireAdmin(ctx);
  const current = await getOrg(ctx.orgId);
  if (!current) throw notFound("Organization not found.");
  const name = patch.name?.trim();
  const slug = patch.slug?.trim().toLowerCase();
  if (name !== undefined && (name.length < 1 || name.length > 80)) throw invalid("The name needs 1 to 80 characters.");
  if (slug !== undefined && !ORG_SLUG_RE.test(slug)) throw invalid("Slugs use 1 to 40 lowercase letters, digits and dashes, and cannot start or end with a dash.");
  if (slug !== undefined && slug !== current.slug) {
    const [taken] = await db.select({ id: orgs.id }).from(orgs).where(and(eq(orgs.slug, slug), ne(orgs.id, ctx.orgId))).limit(1);
    if (taken) throw conflict(`The slug "${slug}" is already taken.`);
  }
  const set = { ...(name !== undefined && { name }), ...(slug !== undefined && { slug }) };
  if (Object.keys(set).length === 0) return current;
  let row: typeof orgs.$inferSelect | undefined;
  try {
    [row] = await db.update(orgs).set(set).where(eq(orgs.id, ctx.orgId)).returning();
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw conflict(`The slug "${slug}" is already taken.`);
    throw e;
  }
  const changes: Record<string, unknown> = {};
  if (name !== undefined && name !== current.name) changes.name = { from: current.name, to: name };
  if (slug !== undefined && slug !== current.slug) changes.slug = { from: current.slug, to: slug };
  if (Object.keys(changes).length) await writeAudit(ctx, "org.update", row!.slug, changes);
  return toOrg(row!);
}
