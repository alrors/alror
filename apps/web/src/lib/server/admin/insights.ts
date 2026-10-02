import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { assertAdmin, type AdminCtx } from "./access";
import { isoTime, likeEscape, num, str, strOrNull, UUID_RE } from "./util";

// Read-only instance views: marketplace adoption, feedback inbox and the audit log across orgs.

// ---------- Plugins ----------

export type PluginInstallStat = { plugin_id: string; installs: number; enabled: number; orgs: string[]; last_installed: string | null };
export type PluginVoteStat = { plugin_id: string; votes: number; orgs: number };

/** Whether the marketplace tables (migration 0003) exist yet. */
async function marketplaceReady(): Promise<boolean> {
  const [r] = await db.execute<{ a: string | null; b: string | null }>(
    sql`select to_regclass('public.org_plugins')::text as a, to_regclass('public.plugin_votes')::text as b`,
  );
  return Boolean(r?.a && r?.b);
}

export async function pluginStats(admin: AdminCtx): Promise<{ ready: boolean; installs: PluginInstallStat[]; votes: PluginVoteStat[] }> {
  assertAdmin(admin);
  if (!(await marketplaceReady())) return { ready: false, installs: [], votes: [] };
  const [installs, votes] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select p.plugin_id, count(*)::int as installs, count(*) filter (where p.enabled)::int as enabled,
        array_agg(o.slug order by o.slug) as orgs, max(p.installed_at) as last_installed
      from org_plugins p join orgs o on o.id = p.org_id
      group by p.plugin_id order by count(*) desc, p.plugin_id`),
    db.execute<Record<string, unknown>>(sql`
      select plugin_id, count(*)::int as votes, count(distinct org_id)::int as orgs
      from plugin_votes group by plugin_id order by count(*) desc, plugin_id`),
  ]);
  return {
    ready: true,
    installs: installs.map((r) => ({
      plugin_id: str(r.plugin_id),
      installs: num(r.installs),
      enabled: num(r.enabled),
      orgs: Array.isArray(r.orgs) ? (r.orgs as string[]) : str(r.orgs).replace(/^\{|\}$/g, "").split(",").filter(Boolean),
      last_installed: isoTime(r.last_installed),
    })),
    votes: votes.map((r) => ({ plugin_id: str(r.plugin_id), votes: num(r.votes), orgs: num(r.orgs) })),
  };
}

// ---------- Feedback ----------

export type AdminFeedback = {
  id: string;
  org_id: string;
  org: string;
  user_email: string | null;
  user_name: string | null;
  message: string;
  page: string;
  created_at: string;
};

export async function listFeedbackAdmin(
  admin: AdminCtx,
  opts: { orgId?: string; q?: string; days?: number; page: number; per: number },
): Promise<{ items: AdminFeedback[]; total: number }> {
  assertAdmin(admin);
  const orgId = opts.orgId && UUID_RE.test(opts.orgId) ? opts.orgId : undefined;
  const q = (opts.q ?? "").trim().slice(0, 100).toLowerCase();
  const pattern = `%${likeEscape(q)}%`;
  const filter = sql`where true
    ${orgId ? sql`and f.org_id = ${orgId}` : sql``}
    ${q ? sql`and (lower(f.message) like ${pattern} or lower(f.page) like ${pattern} or lower(coalesce(u.email, '')) like ${pattern})` : sql``}
    ${opts.days ? sql`and f.created_at > now() - make_interval(days => ${opts.days})` : sql``}`;
  const offset = (Math.max(opts.page, 1) - 1) * opts.per;
  const [rows, [c]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select f.id, f.org_id, o.slug, u.email, u.name, f.message, f.page, f.created_at
      from feedback f join orgs o on o.id = f.org_id left join users u on u.id = f.user_id
      ${filter} order by f.created_at desc, f.id limit ${opts.per} offset ${offset}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from feedback f left join users u on u.id = f.user_id ${filter}`),
  ]);
  return {
    total: num(c?.n),
    items: rows.map((r) => ({
      id: str(r.id),
      org_id: str(r.org_id),
      org: str(r.slug),
      user_email: strOrNull(r.email),
      user_name: strOrNull(r.name),
      message: str(r.message),
      page: str(r.page),
      created_at: isoTime(r.created_at) ?? "",
    })),
  };
}

// ---------- Audit ----------

export type AdminAuditRow = {
  id: number;
  org_id: string;
  org: string;
  actor_type: string;
  actor_label: string;
  action: string;
  target: string;
  meta: Record<string, unknown>;
  at: string;
};

export const AUDIT_CATEGORY_RE = /^[a-z_]{1,32}$/;

export async function listAuditAdmin(
  admin: AdminCtx,
  opts: { orgId?: string; category?: string; q?: string; page: number; per: number },
): Promise<{ items: AdminAuditRow[]; total: number }> {
  assertAdmin(admin);
  const orgId = opts.orgId && UUID_RE.test(opts.orgId) ? opts.orgId : undefined;
  const cat = opts.category && AUDIT_CATEGORY_RE.test(opts.category) ? opts.category : undefined;
  const q = (opts.q ?? "").trim().slice(0, 100).toLowerCase();
  const pattern = `%${likeEscape(q)}%`;
  const filter = sql`where true
    ${orgId ? sql`and a.org_id = ${orgId}` : sql``}
    ${cat ? sql`and a.action like ${`${cat}.%`}` : sql``}
    ${q ? sql`and (lower(a.actor_label) like ${pattern} or lower(a.target) like ${pattern} or a.action like ${pattern})` : sql``}`;
  const offset = (Math.max(opts.page, 1) - 1) * opts.per;
  const [rows, [c]] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select a.*, o.slug from audit_log a join orgs o on o.id = a.org_id
      ${filter} order by a.id desc limit ${opts.per} offset ${offset}`),
    db.execute<{ n: number }>(sql`select count(*)::int as n from audit_log a ${filter}`),
  ]);
  return {
    total: num(c?.n),
    items: rows.map((r) => ({
      id: num(r.id),
      org_id: str(r.org_id),
      org: str(r.slug),
      actor_type: str(r.actor_type),
      actor_label: str(r.actor_label),
      action: str(r.action),
      target: str(r.target),
      meta: (typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta) as Record<string, unknown>,
      at: isoTime(r.at) ?? "",
    })),
  };
}
