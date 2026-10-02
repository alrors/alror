import "server-only";
import { writeAudit } from "../data/audit";
import type { Tx } from "../db";
import { db } from "../db";
import { redis } from "../redis";
import type { AdminCtx } from "./access";

// Every admin mutation is recorded twice:
//  1. an audit_log row in the affected org (actor = the admin, action "admin.*"),
//     so the org's own owners see it in /app/settings/audit;
//  2. an entry in the instance log (Redis list admin:log, newest first, capped),
//     which also covers changes whose org no longer exists (deleting an org
//     cascades to its audit rows).

export const ADMIN_LOG_KEY = "admin:log";
export const ADMIN_LOG_MAX = 1000;

export type AdminLogEntry = {
  at: string;
  actor: string;
  action: string;
  target: string;
  org_id: string | null;
  org: string | null;
  meta: Record<string, unknown>;
};

export async function recordAdminAction(
  admin: AdminCtx,
  input: { action: string; target: string; orgs: { id: string; slug: string }[]; meta?: Record<string, unknown>; tx?: Tx; skipOrgAudit?: boolean },
): Promise<void> {
  const meta = { ...(input.meta ?? {}), platform_admin: admin.email };
  if (!input.skipOrgAudit) {
    for (const o of input.orgs) await writeAudit({ orgId: o.id, actor: admin.actor }, input.action, input.target, meta, input.tx ?? db);
  }
  const at = new Date().toISOString();
  const entries: AdminLogEntry[] = (input.orgs.length ? input.orgs : [null]).map((o) => ({
    at,
    actor: admin.email,
    action: input.action,
    target: input.target,
    org_id: o?.id ?? null,
    org: o?.slug ?? null,
    meta: input.meta ?? {},
  }));
  try {
    const r = redis();
    await r.lpush(ADMIN_LOG_KEY, ...entries.map((e) => JSON.stringify(e)));
    await r.ltrim(ADMIN_LOG_KEY, 0, ADMIN_LOG_MAX - 1);
  } catch (e) {
    // The org audit row is the system of record; the instance log is best effort.
    console.error("[alror admin] instance log write failed:", (e as Error).message);
  }
}

export async function readAdminLog(page: number, per: number): Promise<{ items: AdminLogEntry[]; total: number }> {
  try {
    const r = redis();
    const start = (Math.max(page, 1) - 1) * per;
    const [total, raw] = await Promise.all([r.llen(ADMIN_LOG_KEY), r.lrange(ADMIN_LOG_KEY, start, start + per - 1)]);
    const items = raw.flatMap((s) => {
      try {
        return [JSON.parse(s) as AdminLogEntry];
      } catch {
        return [];
      }
    });
    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}
