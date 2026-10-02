"use client";

import { useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { COLORS, Sparkline } from "@/components/console/charts";
import { SegmentedSelector, Selector } from "@/components/console/selector";
import { ago, statusLabel } from "@/lib/console/format";
import type { ServiceTile, TileState } from "@/lib/console/overview";
import { cn } from "@/lib/site";
import { Panel, PanelLink } from "./ui";

const STATE: Record<TileState, { label: string; bar: string; rank: number }> = {
  attention: { label: "Needs attention", bar: COLORS.bad, rank: 0 },
  rolling: { label: "Rolling out", bar: COLORS.info, rank: 1 },
  healthy: { label: "Healthy", bar: "#5c5c5c", rank: 2 },
  idle: { label: "No releases", bar: "#2e2e2e", rank: 3 },
};

const MOBILE_LIMIT = 6;

type Filter = "all" | "attention" | "healthy";
type Sort = "status" | "deploys" | "rollbacks" | "recent" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "status", label: "Status" },
  { value: "recent", label: "Last release" },
  { value: "deploys", label: "Most deploys" },
  { value: "rollbacks", label: "Rollback rate" },
  { value: "name", label: "Name" },
];

function sortTiles(list: ServiceTile[], by: Sort): ServiceTile[] {
  const last = (t: ServiceTile) => (t.last ? Date.parse(t.last) : 0);
  const cmp: Record<Sort, (a: ServiceTile, b: ServiceTile) => number> = {
    status: (a, b) => STATE[a.state].rank - STATE[b.state].rank || Number(b.critical) - Number(a.critical) || last(b) - last(a),
    recent: (a, b) => last(b) - last(a),
    deploys: (a, b) => b.deploys30 - a.deploys30,
    rollbacks: (a, b) => (b.rollbackRate ?? -1) - (a.rollbackRate ?? -1) || b.bad30 - a.bad30,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...list].sort((a, b) => cmp[by](a, b) || a.name.localeCompare(b.name));
}

function Tile({ t, now }: { t: ServiceTile; now: number }) {
  const s = STATE[t.state];
  const rate = t.rollbackRate === null ? "n/a" : `${Math.round(t.rollbackRate * 100)}%`;
  return (
    <Link
      href={`/app/services/${encodeURIComponent(t.name)}`}
      className="con-lift group @container relative flex min-w-0 flex-col overflow-hidden rounded-md border border-con-line bg-con-bg py-3 pl-4 pr-3.5 outline-none hover:border-con-line-hover focus-visible:border-con-line-hover group-data-[density=compact]/ov:py-2.5"
      aria-label={`${t.name}: ${s.label}`}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.bar }} />
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-[13px] font-medium text-con-fg">{t.name}</span>
        {t.critical && <span className="shrink-0 rounded-[4px] border border-con-line px-1 text-[10px] uppercase tracking-wide text-con-fg3">Critical</span>}
      </div>
      <div className="mt-0.5 truncate text-[11.5px] text-con-fg3">
        {t.state === "rolling" ? (
          <span className="text-con-info">Rolling out</span>
        ) : t.last ? (
          <>
            {t.lastStatus === "rolled_back" || t.lastStatus === "failed" ? <span className="text-con-bad">{statusLabel[t.lastStatus]}</span> : statusLabel[t.lastStatus ?? "promoted"]}
            {" · "}
            {ago(t.last, now)}
          </>
        ) : (
          "No releases yet"
        )}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-3">
        <dl className="flex gap-3.5 text-[11px] text-con-fg3">
          <div>
            <dt className="whitespace-nowrap">Deploys</dt>
            <dd className="mt-0.5 font-mono text-[13px] tabular-nums text-con-fg">{t.deploys30}</dd>
          </div>
          <div>
            <dt className="whitespace-nowrap">Rolled back</dt>
            <dd className={cn("mt-0.5 font-mono text-[13px] tabular-nums", t.bad30 > 0 ? "text-con-fg" : "text-con-fg2")}>{rate}</dd>
          </div>
        </dl>
        <Sparkline values={t.daily} area={false} className="hidden h-7 w-16 shrink-0 @[12rem]:block" color={t.state === "attention" ? COLORS.bad : COLORS.neutral} dot={t.state === "attention" ? COLORS.bad : COLORS.neutralLight} label={`${t.name}: deploys per day, last 30 days`} />
      </div>
    </Link>
  );
}

export function ServicesGrid({ tiles, now, archived }: { tiles: ServiceTile[]; now: number; archived: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("status");
  const [all, setAll] = useState(false);
  const attention = tiles.filter((t) => t.state === "attention").length;
  const healthy = tiles.filter((t) => t.state === "healthy").length;
  const shown = sortTiles(
    tiles.filter((t) => (filter === "all" ? true : filter === "attention" ? t.state === "attention" : t.state === "healthy")),
    sort,
  );
  return (
    <Panel
      widget="services"
      label="Service health"
      title="Service health"
      tip={`Every active service${archived ? ` (${archived} archived not shown)` : ""}. The bar shows its state: red when its latest release did not promote or it rolled back in the last 7 days, blue while rolling out. Deploys, rolled-back share and the trend line cover the last 30 days.`}
      aside={
        <>
          <SegmentedSelector
            aria-label="Filter services"
            size="sm"
            value={filter}
            onValueChange={(v) => setFilter(v as Filter)}
            items={[
              { value: "all", label: <>All <span className="font-mono text-con-fg3">{tiles.length}</span></> },
              { value: "attention", label: <>Attention <span className="font-mono text-con-fg3">{attention}</span></> },
              { value: "healthy", label: <>Healthy <span className="font-mono text-con-fg3">{healthy}</span></> },
            ]}
          />
          <Selector aria-label="Sort services" size="sm" prefix="Sort" align="end" className="hidden w-[150px] sm:inline-flex" value={sort} onValueChange={(v) => setSort(v as Sort)} options={SORTS} />
        </>
      }
    >
      {tiles.length === 0 ? (
        <div className="flex items-center gap-3 py-4 text-[13px] text-con-fg3">
          <Layers size={16} />
          No services yet. Add one to start shipping verified rollouts.
        </div>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-con-fg3">{filter === "attention" ? "No service needs attention right now." : "No service is in this state."}</p>
      ) : (
        <div className="@container">
          <div className="grid grid-cols-1 gap-3 group-data-[density=compact]/ov:gap-2 @lg:grid-cols-2 @xl:grid-cols-3">
          {shown.map((t, i) => (
            // Narrow screens show the first tiles until "Show all"; wider panels show every tile.
            <div key={t.name} className={cn("min-w-0", !all && i >= MOBILE_LIMIT && "hidden @lg:block")}>
              <Tile t={t} now={now} />
            </div>
          ))}
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        {shown.length > MOBILE_LIMIT ? (
          <button type="button" onClick={() => setAll((a) => !a)} aria-expanded={all} className="rounded px-1 text-[12px] text-con-fg2 hover:text-con-fg sm:hidden">
            {all ? "Show fewer" : `Show all ${shown.length}`}
          </button>
        ) : (
          <span />
        )}
        <PanelLink href="/app/services">All services</PanelLink>
      </div>
    </Panel>
  );
}
