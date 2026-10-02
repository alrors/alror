import "server-only";
import type { OrgCtx } from "@/lib/server/context";
import { listInstalled, pluginVotesFor, type InstalledPlugin, type VoteState } from "@/lib/server/data/plugins";
import { getPolicy, type OrgPolicy } from "@/lib/server/data/policy";
import { CATALOG, categoryLabel, type CatalogItem } from "@/lib/server/marketplace/catalog";
import type { MarketItem, MarketState } from "@/components/console/marketplace-card";

/** Where an item stands for this org, from the catalog plus org_plugins and the policy. */
export function stateOf(item: CatalogItem, row: InstalledPlugin | undefined): MarketState {
  if (item.kind === "planned") return "planned";
  if (item.kind === "builtin") return "builtin";
  if (item.kind === "guide") return "guide";
  if (!row) return "available";
  return row.enabled ? "installed" : "disabled";
}

/** True when the item is what the org's policy currently uses (metrics provider, Slack webhook). */
export function inUse(item: CatalogItem, row: InstalledPlugin | undefined, policy: OrgPolicy): boolean {
  if (item.category === "metrics" && item.metricsProvider) return (policy.metrics.provider || "synthetic") === item.metricsProvider;
  if (item.id === "slack") return Boolean(row?.enabled && policy.slack_webhook);
  return false;
}

export function toMarketItem(item: CatalogItem, row: InstalledPlugin | undefined, policy: OrgPolicy, votes: Record<string, VoteState>): MarketItem {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    categoryLabel: categoryLabel(item.category),
    summary: item.summary,
    publisher: item.publisher,
    version: item.version,
    stage: item.stage,
    logo: item.logo,
    note: item.note,
    search: [item.name, item.id, item.summary, categoryLabel(item.category), item.keywords ?? ""].join(" ").toLowerCase(),
    state: stateOf(item, row),
    active: inUse(item, row, policy),
    votes: item.kind === "planned" ? (votes[item.id] ?? { count: 0, mine: false }) : undefined,
  };
}

/** Everything the marketplace list needs, in one round trip per source. */
export async function loadMarket(ctx: OrgCtx) {
  const [installed, policy, votes] = await Promise.all([listInstalled(ctx), getPolicy(ctx), pluginVotesFor(ctx)]);
  const rows = new Map(installed.map((r) => [r.plugin_id, r]));
  return { items: CATALOG.map((item) => toMarketItem(item, rows.get(item.id), policy, votes)), rows, policy, votes };
}
