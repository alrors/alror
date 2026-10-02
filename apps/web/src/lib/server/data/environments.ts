import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db } from "../db";
import { environments } from "../db/schema";
import { conflict, invalid } from "../errors";
import { writeAudit } from "./audit";

export type Environment = { id: string; name: string; protected: boolean };

const toEnv = (r: typeof environments.$inferSelect): Environment => ({ id: r.id, name: r.name, protected: r.protected });

export async function listEnvironments(ctx: OrgCtx): Promise<Environment[]> {
  const rows = await db.select().from(environments).where(eq(environments.orgId, ctx.orgId)).orderBy(asc(environments.name));
  return rows.map(toEnv);
}

export async function getEnvironment(ctx: OrgCtx, name: string): Promise<Environment | null> {
  const [r] = await db
    .select()
    .from(environments)
    .where(and(eq(environments.orgId, ctx.orgId), eq(environments.name, name)))
    .limit(1);
  return r ? toEnv(r) : null;
}

/** The environment a deployment lands in when none is named: production, else the first one. */
export async function defaultEnvironment(ctx: OrgCtx): Promise<Environment | null> {
  return (await getEnvironment(ctx, "production")) ?? (await listEnvironments(ctx))[0] ?? null;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export async function createEnvironment(ctx: OrgCtx, input: { name: string; protected?: boolean }): Promise<Environment> {
  requireAdmin(ctx);
  if (!NAME_RE.test(input.name)) throw invalid("Environment names use lowercase letters, digits and dashes.");
  const [r] = await db
    .insert(environments)
    .values({ orgId: ctx.orgId, name: input.name, protected: input.protected ?? false })
    .onConflictDoNothing()
    .returning();
  if (!r) throw conflict(`Environment ${input.name} already exists.`);
  await writeAudit(ctx, "environment.create", input.name);
  return toEnv(r);
}

export async function setEnvironmentProtected(ctx: OrgCtx, name: string, value: boolean): Promise<void> {
  requireAdmin(ctx);
  await db
    .update(environments)
    .set({ protected: value })
    .where(and(eq(environments.orgId, ctx.orgId), eq(environments.name, name)));
  await writeAudit(ctx, "environment.update", name, { protected: value });
}
