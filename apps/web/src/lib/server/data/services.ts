import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { services, type Target } from "../db/schema";
import { conflict, invalid, notFound } from "../errors";
import { writeAudit } from "./audit";

export type Service = {
  id: string;
  name: string;
  paths: string[];
  target: Target;
  cluster: string;
  namespace: string;
  critical: boolean;
  policy_override: Record<string, unknown> | null;
  created_at: string;
  archived_at: string | null;
};

export type ServiceInput = {
  name: string;
  paths?: string[];
  target?: Target;
  cluster?: string;
  namespace?: string;
  critical?: boolean;
  policy_override?: Record<string, unknown> | null;
};

const toService = (r: typeof services.$inferSelect): Service => ({
  id: r.id,
  name: r.name,
  paths: r.paths,
  target: r.target,
  cluster: r.cluster,
  namespace: r.namespace,
  critical: r.critical,
  policy_override: r.policyOverride ?? null,
  created_at: r.createdAt.toISOString(),
  archived_at: r.archivedAt?.toISOString() ?? null,
});

export const SERVICE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

function checkName(name: string) {
  if (!SERVICE_NAME_RE.test(name)) throw invalid(`Invalid service name "${name}". Use letters, digits, dots, dashes and underscores.`);
}

export async function listServices(ctx: OrgCtx, opts: { includeArchived?: boolean } = {}): Promise<Service[]> {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.orgId, ctx.orgId), opts.includeArchived ? undefined : isNull(services.archivedAt)))
    .orderBy(asc(services.name));
  return rows.map(toService);
}

export async function getService(ctx: OrgCtx, name: string, tx: Tx = db): Promise<Service | null> {
  const [r] = await tx
    .select()
    .from(services)
    .where(and(eq(services.orgId, ctx.orgId), eq(services.name, name)))
    .limit(1);
  return r ? toService(r) : null;
}

export async function createService(ctx: OrgCtx, input: ServiceInput): Promise<Service> {
  requireAdmin(ctx);
  checkName(input.name);
  const [r] = await db
    .insert(services)
    .values({
      orgId: ctx.orgId,
      name: input.name,
      paths: input.paths ?? [],
      target: input.target ?? "simulated",
      cluster: input.cluster ?? "",
      namespace: input.namespace ?? "",
      critical: input.critical ?? false,
      policyOverride: input.policy_override ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (!r) throw conflict(`Service ${input.name} already exists.`);
  await writeAudit(ctx, "service.create", input.name);
  return toService(r);
}

export async function updateService(ctx: OrgCtx, name: string, patch: Omit<Partial<ServiceInput>, "name">): Promise<Service> {
  requireAdmin(ctx);
  const [r] = await db
    .update(services)
    .set({
      ...(patch.paths !== undefined && { paths: patch.paths }),
      ...(patch.target !== undefined && { target: patch.target }),
      ...(patch.cluster !== undefined && { cluster: patch.cluster }),
      ...(patch.namespace !== undefined && { namespace: patch.namespace }),
      ...(patch.critical !== undefined && { critical: patch.critical }),
      ...(patch.policy_override !== undefined && { policyOverride: patch.policy_override }),
    })
    .where(and(eq(services.orgId, ctx.orgId), eq(services.name, name)))
    .returning();
  if (!r) throw notFound(`Service ${name} not found.`);
  await writeAudit(ctx, "service.update", name, { fields: Object.keys(patch) });
  return toService(r);
}

export async function archiveService(ctx: OrgCtx, name: string, archived = true): Promise<void> {
  requireAdmin(ctx);
  const [r] = await db
    .update(services)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(services.orgId, ctx.orgId), eq(services.name, name)))
    .returning({ id: services.id });
  if (!r) throw notFound(`Service ${name} not found.`);
  await writeAudit(ctx, archived ? "service.archive" : "service.unarchive", name);
}

/** Inserts or updates a service by name and un-archives it. Used by PUT /config and the seed. */
export async function upsertServiceByName(ctx: OrgCtx, input: ServiceInput, tx: Tx = db): Promise<{ service: Service; created: boolean }> {
  checkName(input.name);
  const values = {
    paths: input.paths ?? [],
    target: input.target ?? ("simulated" as Target),
    cluster: input.cluster ?? "",
    namespace: input.namespace ?? "",
    critical: input.critical ?? false,
    archivedAt: null,
  };
  const before = await getService(ctx, input.name, tx);
  const [r] = await tx
    .insert(services)
    .values({ orgId: ctx.orgId, name: input.name, ...values })
    .onConflictDoUpdate({ target: [services.orgId, services.name], set: values })
    .returning();
  return { service: toService(r), created: !before };
}
