import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { orgPlugins, pluginVotes, users, type Target } from "../db/schema";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { CATALOG, getCatalogItem, METRICS_PLUGINS, type CatalogItem, type ConfigField } from "../marketplace/catalog";
import { writeAudit } from "./audit";
import { getPolicy, updatePolicy, type MetricsConfig } from "./policy";

// Marketplace installs. Installing a plugin writes org_plugins and, for metrics
// providers and Slack, the matching org policy fields, so GET /api/v1/config and
// the CLI pick the change up. Secrets never land in org_plugins.config.
//
// Exported API (stable; the marketplace UI builds on it). Every function takes the
// OrgCtx first and throws ApiError (use actionError in server actions):
//   listInstalled(ctx) -> InstalledPlugin[]               installed rows (enabled or not), non-secret config
//   installPlugin(ctx, id, input) -> { created, enabled } install, or save config and (re-)enable; owners/admins.
//       input: { [field.key]: string }. Fields with storage "env" are ignored; an empty
//       Slack webhook keeps the stored one. Enabling a metrics provider disables the others.
//       Audit: plugin.install | plugin.configure | plugin.enable (+ policy.update)
//   disablePlugin(ctx, id)        keep settings, turn off, revert the policy; owners/admins. Audit plugin.disable
//   uninstallPlugin(ctx, id)      delete row, revert the policy; owners/admins. Audit plugin.uninstall
//   pluginVotesFor(ctx) -> { [id]: { count, mine } }      votes for planned items
//   togglePluginVote(ctx, id) -> { count, mine }          any signed-in member; planned items only. Audit plugin.vote | plugin.unvote
//   enabledTargets(ctx) -> TargetChoice[]                 simulated + enabled target plugins, with cluster/namespace defaults
//   apiPlugins(ctx)                                       the GET /api/v1/plugins body
//   maskSecret(value) -> string | null                    masked webhook for display
//   validateConfig(item, input), metricsFor(item, config) helpers (validation, policy.metrics mapping)
// Read the Slack webhook state with getPolicy(ctx).slack_webhook (never render it in full)
// and the active metrics provider with getPolicy(ctx).metrics.provider.

export type InstalledPlugin = {
  plugin_id: string;
  enabled: boolean;
  /** Non-secret settings only. */
  config: Record<string, string>;
  installed_by: string | null;
  installed_at: string;
  updated_at: string;
};

const SLACK_RE = /^https:\/\/hooks\.slack\.com\/[A-Za-z0-9/_-]+$/;
const MAX_VALUE = 2000;

export async function listInstalled(ctx: OrgCtx, tx: Tx = db): Promise<InstalledPlugin[]> {
  const rows = await tx
    .select({ p: orgPlugins, by: users.email })
    .from(orgPlugins)
    .leftJoin(users, eq(users.id, orgPlugins.installedBy))
    .where(eq(orgPlugins.orgId, ctx.orgId));
  return rows
    .filter((r) => getCatalogItem(r.p.pluginId))
    .map(({ p, by }) => ({
      plugin_id: p.pluginId,
      enabled: p.enabled,
      config: p.config ?? {},
      installed_by: by ?? null,
      installed_at: p.installedAt.toISOString(),
      updated_at: p.updatedAt.toISOString(),
    }));
}

/** "https://hooks.slack.com/services/T0/B0/abcd1234" -> "hooks.slack.com/services/••••••••1234". */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  let head = "";
  try {
    const u = new URL(value);
    head = u.host + u.pathname.split("/").slice(0, 2).join("/") + "/";
  } catch {
    /* not a URL: mask everything but the tail */
  }
  return `${head}••••••••${value.slice(-4)}`;
}

function requireItem(id: string): CatalogItem {
  const item = getCatalogItem(id);
  if (!item) throw notFound("No such plugin.");
  return item;
}

function requireInstallable(item: CatalogItem): void {
  if (item.kind === "planned") throw conflict(`${item.name} is planned and cannot be installed yet. Vote for it instead.`);
  if (item.kind === "builtin") throw conflict(`${item.name} is built in and always available.`);
  if (item.kind === "guide") throw conflict(`${item.name} runs outside the workspace; follow its setup steps instead.`);
}

/**
 * Validates submitted values against the plugin's schema. Returns the non-secret
 * config to store and, separately, a policy secret (Slack webhook) when one was given.
 * Fields with storage "env" are never read from the input.
 */
export function validateConfig(
  item: CatalogItem,
  input: Record<string, unknown>,
  opts: { policySecretSet?: boolean } = {},
): { config: Record<string, string>; policySecret?: string } {
  const config: Record<string, string> = {};
  let policySecret: string | undefined;
  for (const f of item.fields) {
    if (f.storage === "env") continue;
    const raw = typeof input[f.key] === "string" ? (input[f.key] as string).trim() : input[f.key] == null ? "" : String(input[f.key]).trim();
    if (raw.length > MAX_VALUE) throw invalid(`${f.label}: at most ${MAX_VALUE} characters.`);
    if (!raw) {
      if (f.storage === "policy" && opts.policySecretSet) continue; // keep the stored secret
      if (f.required) throw invalid(`${f.label} is required.`);
      continue;
    }
    const value = checkValue(item, f, raw);
    if (f.storage === "policy") policySecret = value;
    else config[f.key] = value;
  }
  return { config, policySecret };
}

function checkValue(item: CatalogItem, f: ConfigField, raw: string): string {
  switch (f.type) {
    case "url": {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw invalid(`${f.label}: enter a full URL, e.g. http://prometheus:9090.`);
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") throw invalid(`${f.label}: use http or https.`);
      if (u.username || u.password) throw invalid(`${f.label}: do not put credentials in the URL.`);
      return raw.replace(/\/+$/, "");
    }
    case "select":
      if (!f.options?.some((o) => o.value === raw)) throw invalid(`${f.label}: pick one of the listed options.`);
      return raw;
    case "number":
      if (!Number.isFinite(Number(raw))) throw invalid(`${f.label}: enter a number.`);
      return String(Number(raw));
    case "secret":
      if (item.id === "slack" && !SLACK_RE.test(raw)) throw invalid(`${f.label}: Slack webhooks start with https://hooks.slack.com/.`);
      return raw;
    default:
      if (/[\r\n]/.test(raw) && !f.mono) throw invalid(`${f.label}: one line only.`);
      return raw;
  }
}

/** The policy.metrics block a metrics plugin's config stands for. */
export function metricsFor(item: CatalogItem, config: Record<string, string>): MetricsConfig {
  const queries: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) if (k.startsWith("query_") && v) queries[k.slice(6)] = v.replace(/\s*\n\s*/g, " ");
  const url = item.id === "datadog" ? config.site : config.url;
  return { provider: item.metricsProvider ?? item.id, ...(url ? { url } : {}), ...(Object.keys(queries).length ? { queries } : {}) };
}

const SYNTHETIC: MetricsConfig = { provider: "synthetic" };

/** Undo what an enabled plugin set in the policy (metrics back to synthetic, Slack webhook cleared). */
async function revertPolicy(ctx: OrgCtx, item: CatalogItem, tx: Tx, reason: string) {
  if (item.category === "metrics" && item.metricsProvider) {
    const p = await getPolicy(ctx, tx);
    if (p.metrics.provider === item.metricsProvider) {
      await updatePolicy(ctx, { metrics: SYNTHETIC }, { tx, authorized: true, auditMeta: { source: "marketplace", plugin: item.id, reason } });
    }
  }
  if (item.id === "slack") {
    await updatePolicy(ctx, { slack_webhook: null }, { tx, authorized: true, auditMeta: { source: "marketplace", plugin: item.id, reason } });
  }
}

/**
 * Installs a plugin, or saves its configuration (and re-enables it) when it is
 * already installed. Owners and admins only.
 */
export async function installPlugin(ctx: OrgCtx, id: string, input: Record<string, unknown>): Promise<{ created: boolean; enabled: boolean }> {
  requireAdmin(ctx);
  const item = requireItem(id);
  requireInstallable(item);
  return db.transaction(async (tx) => {
    const policy = await getPolicy(ctx, tx);
    const [existing] = await tx
      .select()
      .from(orgPlugins)
      .where(and(eq(orgPlugins.orgId, ctx.orgId), eq(orgPlugins.pluginId, id)))
      .limit(1);
    const { config, policySecret } = validateConfig(item, input, { policySecretSet: item.id === "slack" && Boolean(policy.slack_webhook) });
    const now = new Date();
    await tx
      .insert(orgPlugins)
      .values({ orgId: ctx.orgId, pluginId: id, enabled: true, config, installedBy: ctx.actor.userId ?? null, installedAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [orgPlugins.orgId, orgPlugins.pluginId], set: { enabled: true, config, updatedAt: now } });

    const meta = { source: "marketplace", plugin: id };
    if (item.category === "metrics") {
      // One metrics provider at a time: enabling this one disables the others.
      const others = METRICS_PLUGINS.filter((p) => p.id !== id).map((p) => p.id);
      for (const other of others) {
        const [off] = await tx
          .update(orgPlugins)
          .set({ enabled: false, updatedAt: now })
          .where(and(eq(orgPlugins.orgId, ctx.orgId), eq(orgPlugins.pluginId, other), eq(orgPlugins.enabled, true)))
          .returning({ id: orgPlugins.pluginId });
        if (off) await writeAudit(ctx, "plugin.disable", other, { reason: `replaced by ${id}` }, tx);
      }
      await updatePolicy(ctx, { metrics: metricsFor(item, config) }, { tx, authorized: true, auditMeta: meta });
    }
    if (item.id === "slack" && policySecret) {
      await updatePolicy(ctx, { slack_webhook: policySecret }, { tx, authorized: true, auditMeta: meta });
    }

    const action = !existing ? "plugin.install" : existing.enabled ? "plugin.configure" : "plugin.enable";
    const changed = existing ? Object.keys({ ...existing.config, ...config }).filter((k) => existing.config?.[k] !== config[k]) : Object.keys(config);
    await writeAudit(ctx, action, id, { fields: changed, ...(policySecret ? { secret_updated: true } : {}) }, tx);
    return { created: !existing, enabled: true };
  });
}

async function installedRow(ctx: OrgCtx, id: string, tx: Tx) {
  const [row] = await tx
    .select()
    .from(orgPlugins)
    .where(and(eq(orgPlugins.orgId, ctx.orgId), eq(orgPlugins.pluginId, id)))
    .limit(1);
  if (!row) throw notFound("This plugin is not installed.");
  return row;
}

/** Keeps the plugin and its settings but turns it off and reverts its policy change. */
export async function disablePlugin(ctx: OrgCtx, id: string): Promise<void> {
  requireAdmin(ctx);
  const item = requireItem(id);
  await db.transaction(async (tx) => {
    const row = await installedRow(ctx, id, tx);
    if (!row.enabled) return;
    await tx
      .update(orgPlugins)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(orgPlugins.orgId, ctx.orgId), eq(orgPlugins.pluginId, id)));
    await revertPolicy(ctx, item, tx, "disabled");
    await writeAudit(ctx, "plugin.disable", id, {}, tx);
  });
}

/** Removes the plugin and its settings, and reverts its policy change. */
export async function uninstallPlugin(ctx: OrgCtx, id: string): Promise<void> {
  requireAdmin(ctx);
  const item = requireItem(id);
  await db.transaction(async (tx) => {
    const row = await installedRow(ctx, id, tx);
    await tx.delete(orgPlugins).where(and(eq(orgPlugins.orgId, ctx.orgId), eq(orgPlugins.pluginId, id)));
    if (row.enabled) await revertPolicy(ctx, item, tx, "uninstalled");
    await writeAudit(ctx, "plugin.uninstall", id, { was_enabled: row.enabled }, tx);
  });
}

// ---------- Votes for planned items ----------

export type VoteState = { count: number; mine: boolean };

export async function pluginVotesFor(ctx: OrgCtx): Promise<Record<string, VoteState>> {
  const uid = ctx.actor.userId ?? "00000000-0000-0000-0000-000000000000";
  const rows = await db
    .select({
      plugin: pluginVotes.pluginId,
      n: sql<number>`count(*)::int`,
      mine: sql<boolean>`bool_or(${pluginVotes.userId} = ${uid})`,
    })
    .from(pluginVotes)
    .where(eq(pluginVotes.orgId, ctx.orgId))
    .groupBy(pluginVotes.pluginId);
  return Object.fromEntries(rows.map((r) => [r.plugin, { count: r.n, mine: Boolean(r.mine) }]));
}

/** Adds or removes the signed-in user's "I want this" vote. Any member can vote. */
export async function togglePluginVote(ctx: OrgCtx, id: string): Promise<VoteState> {
  const item = requireItem(id);
  if (item.kind !== "planned") throw conflict("Only planned items take votes.");
  const userId = ctx.actor.userId;
  if (ctx.actor.type !== "user" || !userId) throw forbidden("Voting needs a signed-in user.");
  return db.transaction(async (tx) => {
    const added = await tx.insert(pluginVotes).values({ orgId: ctx.orgId, pluginId: id, userId }).onConflictDoNothing().returning({ id: pluginVotes.pluginId });
    if (added.length === 0) {
      await tx.delete(pluginVotes).where(and(eq(pluginVotes.orgId, ctx.orgId), eq(pluginVotes.pluginId, id), eq(pluginVotes.userId, userId)));
    }
    await writeAudit(ctx, added.length ? "plugin.vote" : "plugin.unvote", id, {}, tx);
    const [c] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pluginVotes)
      .where(and(eq(pluginVotes.orgId, ctx.orgId), eq(pluginVotes.pluginId, id)));
    return { count: c?.n ?? 0, mine: added.length > 0 };
  });
}

// ---------- Derived views ----------

export type TargetChoice = { target: Target; name: string; beta: boolean; defaults: { cluster?: string; namespace?: string } };

/** Deploy targets the console offers for services: simulated plus every enabled target plugin. */
export async function enabledTargets(ctx: OrgCtx): Promise<TargetChoice[]> {
  const installed = await listInstalled(ctx);
  const out: TargetChoice[] = [{ target: "simulated", name: "Simulated", beta: false, defaults: {} }];
  for (const row of installed) {
    const item = getCatalogItem(row.plugin_id);
    if (!row.enabled || !item?.target || item.target === "simulated") continue;
    out.push({
      target: item.target,
      name: item.name,
      beta: item.stage === "beta",
      defaults: { cluster: row.config.default_cluster || undefined, namespace: row.config.default_namespace || undefined },
    });
  }
  return out;
}

/** What GET /api/v1/plugins returns: installed plugins (no secrets) and what they add up to. */
export async function apiPlugins(ctx: OrgCtx) {
  const [installed, policy, targets] = await Promise.all([listInstalled(ctx), getPolicy(ctx), enabledTargets(ctx)]);
  return {
    plugins: installed.map((r) => {
      const item = getCatalogItem(r.plugin_id)!;
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        version: item.version,
        stage: item.stage,
        enabled: r.enabled,
        config: r.config,
        ...(item.id === "slack" ? { webhook_set: Boolean(policy.slack_webhook) } : {}),
        installed_by: r.installed_by,
        installed_at: r.installed_at,
        updated_at: r.updated_at,
      };
    }),
    metrics_provider: policy.metrics.provider || "synthetic",
    targets: targets.map((t) => t.target),
  };
}

export const catalogIds = () => CATALOG.map((p) => p.id);
