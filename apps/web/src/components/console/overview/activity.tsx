// Merged activity feed: releases, rollbacks, jobs and org changes, grouped by day.

import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck, CircleX, Cog, Layers, Package, Rocket, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { ago, hm } from "@/lib/console/format";
import { dayGroup, type ActivityItem, type ActivityKind } from "@/lib/console/overview";
import { cn } from "@/lib/site";
import { PAD_X, Panel, PanelLink } from "./ui";

const KIND: Record<ActivityKind, { Icon: typeof Rocket; tone: string }> = {
  release: { Icon: Rocket, tone: "text-con-info" },
  promoted: { Icon: CircleCheck, tone: "text-con-good" },
  rolled_back: { Icon: RotateCcw, tone: "text-con-warn" },
  failed: { Icon: CircleX, tone: "text-con-bad" },
  job: { Icon: Server, tone: "text-con-fg2" },
  policy: { Icon: ShieldCheck, tone: "text-con-fg2" },
  plugin: { Icon: Package, tone: "text-con-fg2" },
  service: { Icon: Layers, tone: "text-con-fg2" },
  environment: { Icon: Cog, tone: "text-con-fg2" },
};

const ROW_H = { comfortable: 54, compact: 46 };
const HEAD_H = 28;

function PageButton({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "inline-grid h-8 w-8 place-items-center rounded-md border sm:h-7 sm:w-7 text-con-fg2 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover";
  return href ? (
    <Link href={href} scroll={false} aria-label={label} className={cn(cls, "border-con-line hover:border-con-line-hover hover:bg-con-hover hover:text-con-fg")}>
      {children}
    </Link>
  ) : (
    <span aria-disabled="true" aria-label={label} className={cn(cls, "cursor-not-allowed border-con-line/60 text-con-fg3/50")}>
      {children}
    </span>
  );
}

export function ActivityFeed({
  items,
  now,
  admin,
  page,
  pages,
  per,
  total,
  prevHref,
  nextHref,
}: {
  items: ActivityItem[];
  now: number;
  admin: boolean;
  page: number;
  pages: number;
  per: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const compact = per >= 10;
  const rowH = compact ? ROW_H.compact : ROW_H.comfortable;
  const from = total ? (page - 1) * per + 1 : 0;
  const to = Math.min(total, (page - 1) * per + items.length);
  const groups = new Map<string, ActivityItem[]>();
  for (const it of items) {
    const g = dayGroup(it.at, now);
    groups.set(g, [...(groups.get(g) ?? []), it]);
  }
  return (
    <Panel
      widget="activity"
      label="Activity"
      flush
      title="Activity"
      tip={admin ? "Releases, rollbacks, runner jobs, and policy, marketplace, service and environment changes from the audit log, newest first." : "Releases, rollbacks and runner jobs, newest first."}
      aside={
        <div className="flex items-center gap-1">
          <PanelLink href="/app/deployments">Releases</PanelLink>
          <PanelLink href="/app/jobs">Jobs</PanelLink>
          {admin && <PanelLink href="/app/settings/audit">Audit log</PanelLink>}
        </div>
      }
    >
      {items.length === 0 ? (
        <p className={cn("border-t border-con-row py-6 text-[13px] text-con-fg3", PAD_X)}>Nothing has happened yet. Releases and changes show up here as they happen.</p>
      ) : (
        <div key={page} className="con-fade border-t border-con-row pb-2" style={{ minHeight: pages > 1 ? per * rowH + 3 * HEAD_H + 8 : undefined }}>
          {[...groups.entries()].map(([g, list]) => (
            <section key={g} aria-label={g}>
              <h3 className={cn("pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-con-fg3", PAD_X)}>{g}</h3>
              <ol>
                {list.map((it, i) => {
                  const k = KIND[it.kind];
                  const body = (
                    <>
                      <span className="relative flex w-5 shrink-0 justify-center self-stretch">
                        {i < list.length - 1 && <span aria-hidden className="absolute bottom-[-10px] top-6 w-px bg-con-row" />}
                        <span className="relative mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-con-line bg-con-panel">
                          <k.Icon size={11} className={k.tone} strokeWidth={2.25} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-con-fg">{it.title}</span>
                        {it.detail && <span className="block truncate text-[12px] text-con-fg3">{it.detail}</span>}
                      </span>
                      <time dateTime={it.at} title={`${hm(it.at)} UTC`} className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-con-fg3">
                        {ago(it.at, now)}
                      </time>
                    </>
                  );
                  const cls = cn("con-ease flex items-start gap-3 py-2", PAD_X);
                  const style = { height: rowH };
                  return (
                    <li key={it.key}>
                      {it.href ? (
                        <Link href={it.href} style={style} className={cn(cls, "hover:bg-con-hover")}>
                          {body}
                        </Link>
                      ) : (
                        <div style={style} className={cls}>
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
      {pages > 1 && (
        <nav aria-label="Activity pages" className={cn("flex items-center justify-between gap-3 border-t border-con-row py-2.5", PAD_X)}>
          <span className="text-[12px] tabular-nums text-con-fg3" aria-live="polite">
            {from}–{to} of {total.toLocaleString("en-US")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="mr-1 text-[12px] tabular-nums text-con-fg3">
              Page {page} of {pages}
            </span>
            <PageButton href={prevHref} label="Newer activity">
              <ChevronLeft size={14} />
            </PageButton>
            <PageButton href={nextHref} label="Older activity">
              <ChevronRight size={14} />
            </PageButton>
          </span>
        </nav>
      )}
    </Panel>
  );
}
