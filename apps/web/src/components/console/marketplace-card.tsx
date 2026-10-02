import Link from "next/link";
import { ChevronUp } from "lucide-react";
import { MarketplaceLogo } from "@/components/console/marketplace-logo";
import { Pill } from "@/components/console/primitives";
import type { PluginCategory, PluginLogo, PluginStage } from "@/lib/server/marketplace/catalog";
import { cn } from "@/lib/site";

/**
 * installed / disabled: an installable plugin with an org_plugins row.
 * available: installable, not installed. builtin: always on. guide: runs outside
 * the workspace (CI, SDKs, CLI). planned: not built yet, votes only.
 */
export type MarketState = "installed" | "disabled" | "available" | "builtin" | "guide" | "planned";

/** The serialisable slice of a catalog item the list and cards render. */
export type MarketItem = {
  id: string;
  name: string;
  category: PluginCategory;
  categoryLabel: string;
  summary: string;
  publisher: string;
  version: string | null;
  stage: PluginStage;
  logo: PluginLogo;
  note?: string;
  /** Lower-cased haystack for the search box. */
  search: string;
  state: MarketState;
  /** What the org's policy uses right now (metrics provider, Slack webhook). */
  active: boolean;
  votes?: { count: number; mine: boolean };
};

/** State, stage and kind badges, shared by the cards and the detail header. */
export function MarketBadges({ item, className }: { item: Pick<MarketItem, "state" | "stage" | "category" | "active">; className?: string }) {
  const any = item.state === "installed" || item.state === "disabled" || item.state === "builtin" || item.state === "planned" || item.stage === "beta" || item.category === "libraries";
  if (!any) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {item.state === "installed" && <Pill tone="good">Installed</Pill>}
      {item.state === "disabled" && <Pill tone="idle">Disabled</Pill>}
      {item.state === "builtin" && <Pill className="text-con-fg2">Built in</Pill>}
      {item.state === "planned" && <Pill className="text-con-fg2">Planned</Pill>}
      {item.stage === "beta" && <Pill tone="warn">Beta</Pill>}
      {item.category === "libraries" && <Pill className="text-con-fg2">Library</Pill>}
    </span>
  );
}

function Votes({ votes }: { votes: NonNullable<MarketItem["votes"]> }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-mono text-[12px] tabular-nums", votes.mine ? "text-con-fg" : "text-con-fg3")}
      title={votes.mine ? "You voted for this" : "Votes from your organization"}
    >
      <ChevronUp size={13} strokeWidth={2} aria-hidden />
      {votes.count}
      <span className="sr-only">{votes.count === 1 ? "vote" : "votes"}</span>
    </span>
  );
}

/** One catalog entry in the grid. The whole card links to its detail page. */
export function MarketCard({ item, featured }: { item: MarketItem; featured?: boolean }) {
  return (
    <Link
      href={`/app/marketplace/${item.id}`}
      className={cn(
        "con-lift group flex min-w-0 flex-col rounded-lg border border-con-line bg-con-panel p-4 outline-none hover:border-con-line-hover focus-visible:border-con-line-hover",
        featured && "p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <MarketplaceLogo id={item.id} name={item.name} logo={item.logo} size={featured ? "lg" : "md"} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold text-con-fg">{item.name}</h3>
          <p className="truncate text-[12px] text-con-fg3">{item.categoryLabel}</p>
        </div>
      </div>
      <p className={cn("mt-3 text-[13px] leading-[1.5] text-con-fg2", featured ? "line-clamp-3" : "line-clamp-2")}>{item.summary}</p>
      <div className="mt-auto pt-3">
        <div className="min-h-[22px]">
          <MarketBadges item={item} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-con-line pt-3 text-[12px] text-con-fg3">
          <span className="truncate">
            {item.publisher}
            {item.version && <span className="font-mono"> · v{item.version}</span>}
            {item.note && <span> · {item.note}</span>}
          </span>
          {item.votes && <Votes votes={item.votes} />}
        </div>
      </div>
    </Link>
  );
}
