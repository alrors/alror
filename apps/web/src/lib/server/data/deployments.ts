import "server-only";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { DeployEvent, Deployment, EventKind, Status, Verdict } from "@/lib/console/types";
import type { OrgCtx } from "../context";
import { db } from "../db";
import { deploymentEvents, deployments, environments, type DeploymentSource } from "../db/schema";
import { ApiError, conflict, invalid, notFound } from "../errors";
import { publish } from "../redis";
import { writeAudit } from "./audit";
import { goTime, orderPlan, orderRisk, orderVerdict } from "./go-json";
import { createNotification } from "./notifications";
import { getService } from "./services";

export const DEPLOYMENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const TERMINAL: Status[] = ["promoted", "rolled_back", "failed"];
export const isTerminal = (s: Status) => TERMINAL.includes(s);

type Row = typeof deployments.$inferSelect;

/**
 * Row -> Go-compatible JSON (struct key order, omitempty on ref and reason,
 * RFC3339Nano times), plus the optional `environment` and `source` extensions.
 */
export function toDeployment(r: Row, environment?: string | null): Deployment {
  return {
    id: r.id,
    service: r.service,
    image: r.image,
    ...(r.ref ? { ref: r.ref } : {}),
    risk: orderRisk(r.risk),
    plan: orderPlan(r.plan),
    status: r.status,
    step_index: r.stepIndex,
    weight: r.weight,
    ...(r.reason ? { reason: r.reason } : {}),
    created_at: goTime(r.createdAt),
    updated_at: goTime(r.updatedAt),
    ...(environment ? { environment } : {}),
    source: r.source,
  };
}

/** Deployment row plus its environment name. */
const withEnv = { d: deployments, env: environments.name };
const fromRow = (r: { d: Row; env: string | null }) => toDeployment(r.d, r.env);

type EventRow = typeof deploymentEvents.$inferSelect;

export function toEvent(r: EventRow): DeployEvent {
  return {
    at: goTime(r.at),
    kind: r.kind,
    message: r.message,
    ...(r.weight ? { weight: r.weight } : {}),
    ...(r.verdict ? { verdict: orderVerdict(r.verdict) } : {}),
  };
}

// ---------- Reads ----------

export type DeploymentFilter = {
  status?: Status | Status[];
  service?: string;
  environment?: string;
  since?: Date;
  until?: Date;
  /** matches id, service, image or ref */
  q?: string;
  ai?: boolean;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(ctx: OrgCtx, f: DeploymentFilter): SQL | undefined {
  const statuses = f.status === undefined ? [] : Array.isArray(f.status) ? f.status : [f.status];
  const q = f.q?.trim();
  return and(
    eq(deployments.orgId, ctx.orgId),
    statuses.length ? inArray(deployments.status, statuses) : undefined,
    f.service ? eq(deployments.service, f.service) : undefined,
    f.environment
      ? sql`${deployments.environmentId} in (select ${environments.id} from ${environments} where ${environments.orgId} = ${ctx.orgId} and ${environments.name} = ${f.environment})`
      : undefined,
    f.since ? gte(deployments.createdAt, f.since) : undefined,
    f.until ? lt(deployments.createdAt, f.until) : undefined,
    f.ai === undefined ? undefined : sql`coalesce((${deployments.risk}->>'ai_authored')::boolean, false) = ${f.ai}`,
    q
      ? or(
          ilike(deployments.id, `%${escapeLike(q)}%`),
          ilike(deployments.service, `%${escapeLike(q)}%`),
          ilike(deployments.image, `%${escapeLike(q)}%`),
          ilike(deployments.ref, `%${escapeLike(q)}%`),
        )
      : undefined,
  );
}

export type Page = {
  limit?: number;
  offset?: number;
  /** Cursor: only deployments older than this deployment id or RFC 3339 time. */
  before?: string;
};

async function beforeClause(ctx: OrgCtx, before: string | undefined): Promise<SQL | undefined> {
  if (!before) return undefined;
  if (DEPLOYMENT_ID_RE.test(before) && !/^\d{4}-\d{2}-\d{2}/.test(before)) {
    const [ref] = await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, before)))
      .limit(1);
    if (!ref) throw invalid(`before: unknown deployment ${before}.`);
    // Row comparison in SQL keeps Postgres' microsecond precision (a JS Date would truncate to ms).
    return sql`(${deployments.createdAt}, ${deployments.id}) < (select c.created_at, c.id from ${deployments} c where c.org_id = ${ctx.orgId} and c.id = ${before})`;
  }
  const t = new Date(before);
  if (Number.isNaN(t.getTime())) throw invalid("before must be a deployment id or an RFC 3339 time.");
  return lt(deployments.createdAt, t);
}

/** Deployments newest first (created_at desc, id desc). Default limit 50, max 5000. */
export async function listDeployments(ctx: OrgCtx, f: DeploymentFilter = {}, page: Page = {}): Promise<Deployment[]> {
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 5000);
  const rows = await db
    .select(withEnv)
    .from(deployments)
    .leftJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(where(ctx, f), await beforeClause(ctx, page.before)))
    .orderBy(desc(deployments.createdAt), desc(deployments.id))
    .limit(limit)
    .offset(Math.max(page.offset ?? 0, 0));
  return rows.map(fromRow);
}

export async function countDeployments(ctx: OrgCtx, f: DeploymentFilter = {}): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(deployments).where(where(ctx, f));
  return r?.n ?? 0;
}

/** One page of deployments plus the total, for paged tables. */
export async function pageDeployments(ctx: OrgCtx, f: DeploymentFilter, page: number, per: number) {
  const [items, total] = await Promise.all([
    listDeployments(ctx, f, { limit: per, offset: (Math.max(page, 1) - 1) * per }),
    countDeployments(ctx, f),
  ]);
  return { items, total };
}

/**
 * Exact id or unique prefix. Returns null when nothing matches and throws
 * 409 `ambiguous` when a prefix matches more than one deployment.
 */
export async function getDeployment(ctx: OrgCtx, idOrPrefix: string): Promise<Deployment | null> {
  if (!DEPLOYMENT_ID_RE.test(idOrPrefix)) return null;
  const [exact] = await db
    .select(withEnv)
    .from(deployments)
    .leftJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, idOrPrefix)))
    .limit(1);
  if (exact) return fromRow(exact);
  const rows = await db
    .select(withEnv)
    .from(deployments)
    .leftJoin(environments, eq(environments.id, deployments.environmentId))
    .where(and(eq(deployments.orgId, ctx.orgId), sql`${deployments.id} like ${escapeLike(idOrPrefix) + "%"}`))
    .orderBy(asc(deployments.id))
    .limit(2);
  if (rows.length > 1) throw new ApiError(409, "ambiguous", `"${idOrPrefix}" matches more than one deployment; use more characters.`);
  return rows[0] ? fromRow(rows[0]) : null;
}

/** Like getDeployment, but 404s. */
export async function mustGetDeployment(ctx: OrgCtx, idOrPrefix: string): Promise<Deployment> {
  const d = await getDeployment(ctx, idOrPrefix);
  if (!d) throw notFound(`Deployment ${idOrPrefix} not found.`);
  return d;
}

async function ownedId(ctx: OrgCtx, id: string): Promise<boolean> {
  if (!DEPLOYMENT_ID_RE.test(id)) return false;
  const [r] = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, id)))
    .limit(1);
  return Boolean(r);
}

/** Events of one deployment in order, or null when the deployment is not in this org. */
export async function listEvents(ctx: OrgCtx, id: string): Promise<DeployEvent[] | null> {
  if (!(await ownedId(ctx, id))) return null;
  const rows = await db
    .select()
    .from(deploymentEvents)
    .where(eq(deploymentEvents.deploymentId, id))
    .orderBy(asc(deploymentEvents.id));
  return rows.map(toEvent);
}

/** Events for many deployments, keyed by id. Ids outside the org are silently dropped. */
export async function eventsFor(ctx: OrgCtx, ids: string[]): Promise<Map<string, DeployEvent[]>> {
  const out = new Map<string, DeployEvent[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return out;
  const rows = await db
    .select({ e: deploymentEvents })
    .from(deploymentEvents)
    .innerJoin(deployments, eq(deployments.id, deploymentEvents.deploymentId))
    .where(and(eq(deployments.orgId, ctx.orgId), inArray(deploymentEvents.deploymentId, ids)))
    .orderBy(asc(deploymentEvents.id));
  for (const { e } of rows) out.get(e.deploymentId)?.push(toEvent(e));
  return out;
}

/** Rollbacks per service since a time (for risk scoring), like the Go FS store. */
export async function recentRollbacks(ctx: OrgCtx, since: Date): Promise<Record<string, number>> {
  const rows = await db
    .select({ service: deployments.service, n: sql<number>`count(*)::int` })
    .from(deployments)
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.status, "rolled_back"), gt(deployments.updatedAt, since)))
    .groupBy(deployments.service);
  return Object.fromEntries(rows.map((r) => [r.service, r.n]));
}

// ---------- Writes ----------

export type DeploymentInput = Omit<Deployment, "created_at" | "updated_at" | "environment" | "source"> & {
  created_at?: string;
  updated_at?: string;
  /** Environment name; defaults to production on insert and is left unchanged on update when absent. */
  environment?: string;
  source?: DeploymentSource;
};

export type WriteOpts = {
  /** Create the terminal-status notification and audit row (default true). */
  sideEffects?: boolean;
  /** PUT semantics: 404 unless the deployment already exists in this org. */
  mustExist?: boolean;
  /** Where the write came from when the body has no `source` (X-Alror-Source header). */
  sourceHint?: DeploymentSource;
  /**
   * Trusted callers only (the seed): keep the given created_at/updated_at.
   * Otherwise the server owns updated_at (now) and created_at defaults to now.
   */
  trustTimestamps?: boolean;
};

const TERMINAL_COPY: Record<string, { title: (d: Deployment) => string; kind: string }> = {
  promoted: { kind: "deployment.promoted", title: (d) => `${d.service} promoted to 100%` },
  rolled_back: { kind: "deployment.rolled_back", title: (d) => `${d.service} rolled back` },
  failed: { kind: "deployment.failed", title: (d) => `${d.service} deployment failed` },
};

function parseTime(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const t = new Date(v);
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() < 1971) return fallback; // Go zero time
  return t;
}

/** Default source when neither the body nor the X-Alror-Source header names one. */
function defaultSource(ctx: OrgCtx): DeploymentSource {
  return ctx.actor.type === "user" ? "console" : "cli";
}

/**
 * Inserts or updates a deployment by id. The service must exist in the org
 * (422 unknown_service) and a named environment too (422 unknown_environment).
 * The server sets updated_at = now() on every write; created_at comes from the
 * client on insert (now() when missing) and never changes afterwards. A
 * transition into a terminal status creates a notification and an audit row.
 * Publishes deployment.updated.
 */
export async function upsertDeployment(ctx: OrgCtx, input: DeploymentInput, opts: WriteOpts = {}): Promise<{ deployment: Deployment; created: boolean }> {
  if (!DEPLOYMENT_ID_RE.test(input.id)) throw invalid("Deployment id must match [A-Za-z0-9_-]{1,128}.");
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ orgId: deployments.orgId, status: deployments.status, environmentId: deployments.environmentId })
      .from(deployments)
      .where(eq(deployments.id, input.id))
      .for("update")
      .limit(1);
    const mine = prev && prev.orgId === ctx.orgId ? prev : undefined;
    if (opts.mustExist && !mine) throw notFound(`Deployment ${input.id} not found.`);
    if (prev && !mine) throw conflict(`Deployment id ${input.id} is already in use.`);

    const svc = await getService(ctx, input.service, tx);
    if (!svc || svc.archived_at) throw new ApiError(422, "unknown_service", `Unknown service "${input.service}". Add it to the org config first.`);

    let environmentId = mine?.environmentId;
    let environmentName: string | null = null;
    if (input.environment !== undefined || !environmentId) {
      const name = input.environment || "production";
      let [env] = await tx
        .select({ id: environments.id, name: environments.name })
        .from(environments)
        .where(and(eq(environments.orgId, ctx.orgId), eq(environments.name, name)))
        .limit(1);
      if (!env && !input.environment) {
        [env] = await tx.select({ id: environments.id, name: environments.name }).from(environments).where(eq(environments.orgId, ctx.orgId)).limit(1);
      }
      if (!env) throw new ApiError(422, "unknown_environment", `Unknown environment "${name}".`);
      environmentId = env.id;
      environmentName = env.name;
    } else {
      const [env] = await tx.select({ name: environments.name }).from(environments).where(eq(environments.id, environmentId)).limit(1);
      environmentName = env?.name ?? null;
    }

    const explicitSource = input.source ?? opts.sourceHint;
    const values = {
      serviceId: svc.id,
      environmentId,
      service: svc.name,
      image: input.image,
      ref: input.ref ?? "",
      status: input.status,
      stepIndex: input.step_index,
      weight: input.weight,
      reason: input.reason ?? "",
      risk: input.risk,
      plan: input.plan,
      updatedAt: opts.trustTimestamps ? parseTime(input.updated_at, now) : now,
      ...(explicitSource && mine ? { source: explicitSource } : {}),
    };
    const [row] = await tx
      .insert(deployments)
      .values({
        id: input.id,
        orgId: ctx.orgId,
        ...values,
        source: explicitSource ?? defaultSource(ctx),
        createdByUser: ctx.actor.userId ?? null,
        createdByKey: ctx.actor.keyId ?? null,
        createdAt: parseTime(input.created_at, now),
      })
      .onConflictDoUpdate({ target: deployments.id, set: values, setWhere: eq(deployments.orgId, ctx.orgId) })
      .returning();
    if (!row) throw conflict(`Deployment id ${input.id} is already in use.`);
    const deployment = toDeployment(row, environmentName);

    const becameTerminal = isTerminal(deployment.status) && (!mine || !isTerminal(mine.status));
    if (becameTerminal && opts.sideEffects !== false) {
      const copy = TERMINAL_COPY[deployment.status];
      await createNotification(
        ctx.orgId,
        {
          kind: copy.kind,
          title: copy.title(deployment),
          body: deployment.reason || `${deployment.image} · risk ${deployment.risk?.score ?? 0} (${deployment.risk?.level ?? "unknown"})`,
          href: `/app/deployments/${deployment.id}`,
        },
        tx,
      );
      await writeAudit(ctx, `deployment.${deployment.status}`, deployment.id, { service: deployment.service, image: deployment.image }, tx);
    }
    return { deployment, created: !mine };
  });

  await publish(ctx.orgId, { type: "deployment.updated", deployment: result.deployment });
  return result;
}

/** Appends one event to a deployment in this org. Publishes deployment.event. */
export async function appendEvent(
  ctx: OrgCtx,
  id: string,
  e: { at?: string; kind: EventKind; message: string; weight?: number; verdict?: Verdict | null },
): Promise<DeployEvent> {
  if (!(await ownedId(ctx, id))) throw notFound(`Deployment ${id} not found.`);
  const [row] = await db
    .insert(deploymentEvents)
    .values({
      deploymentId: id,
      at: parseTime(e.at, new Date()),
      kind: e.kind,
      message: e.message ?? "",
      weight: e.weight ?? null,
      verdict: e.verdict ?? null,
    })
    .returning();
  const event = toEvent(row);
  await publish(ctx.orgId, { type: "deployment.event", deployment_id: id, event });
  return event;
}
