import type { Metadata } from "next";
import { MarketplaceBrowser, type MarketShow } from "@/components/console/marketplace-browser";
import { requireSession } from "@/lib/console/auth";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { PLUGIN_CATEGORIES } from "@/lib/server/marketplace/catalog";
import { loadMarket } from "./state";

export const metadata: Metadata = { title: "Marketplace" };

const FEATURED = ["prometheus", "slack", "github-actions", "kubernetes"];
const SHOWS: MarketShow[] = ["all", "installed", "available", "planned"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function MarketplacePage({ searchParams }: PageProps<"/app/marketplace">) {
  const sp = await searchParams;
  const session = await requireSession();
  const { items } = await loadMarket(ctxFor(session));
  const admin = isAdminRole(session.role);

  const category = PLUGIN_CATEGORIES.some((c) => c.value === one(sp.category)) ? one(sp.category) : "";
  const show = SHOWS.includes(one(sp.show) as MarketShow) ? (one(sp.show) as MarketShow) : "all";
  const installed = items.filter((i) => i.state === "installed" || i.state === "builtin").length;

  return (
    <div className="space-y-6">
      <div className="con-fade-up flex flex-col gap-1">
        <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Marketplace</h1>
        <p className="max-w-3xl text-[14px] text-con-fg2">
          Plugins connect Alror to your metrics, deploy targets, alerts and CI; libraries let you call Alror from code.
        </p>
        <p className="text-[13px] text-con-fg3">
          {installed} active in {session.org.name}, built-ins included
          {admin ? "" : ". Owners and admins install and configure plugins; you can browse and vote for planned ones."}
        </p>
      </div>
      <MarketplaceBrowser
        items={items}
        categories={PLUGIN_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
        featured={FEATURED}
        initial={{ q: one(sp.q).slice(0, 80), category, show }}
      />
    </div>
  );
}
