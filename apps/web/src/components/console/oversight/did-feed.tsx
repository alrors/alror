// "What Alror did": automatic merges, review routing, promotions, rollbacks and policy
// changes, newest first, grouped by day, each with a one-line reason and its explanation page.

import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleCheck, CircleX, GitMerge, GitPullRequest, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { PAD_X, Panel, PanelLink } from "@/components/console/overview/ui";
import { ago, hm } from "@/lib/console/format";
import { groupByDay, type DidItem, type DidKind } from "@/lib/console/oversight";
import { cn } from "@/lib/site";

const KIND: Record<DidKind, { Icon: typeof CircleCheck; tone: string; label: string }> = {
  auto_merge: { Icon: GitMerge, tone: "text-con-good", label: "Auto-merge" },
  review_routed: { Icon: GitPullRequest, tone: "text-con-warn", label: "Routed to review" },
  promoted: { Icon: CircleCheck, tone: "text-con-good", label: "Promotion" },
  auto_rollback: { Icon: RotateCcw, tone: "text-con-warn", label: "Automatic rollback" },
  stopped: { Icon: CircleX, tone: "text-con-bad", label: "Stopped rollout" },
  gate_policy: { Icon: ShieldCheck, tone: "text-con-fg2", label: "Merge policy" },
  rollout_policy: { Icon: SlidersHorizontal, tone: "text-con-fg2", label: "Rollout policy" },
};

function PageButton({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  const cls = "inline-grid h-8 w-8 place-items-center rounded-md border text-con-fg2 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover sm:h-7 sm:w-7";
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

export function WhatAlrorDid({
  items,
  now,
  page,
  pages,
  prevHref,
  nextHref,
}: {
  items: DidItem[];
  now: number;
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  const groups = groupByDay(items, now);
  return (
    <Panel
      label="What Alror did"
      flush
      title="What Alror did"
      tip="Automatic merges, pull requests routed to review, promotions, automatic rollbacks, stopped rollouts and policy changes, from stored release events, merge-gate decisions and the audit log. Each links to why it happened."
      aside={
        <div className="flex items-center gap-1">
          <PanelLink href="/app/deployments">Releases</PanelLink>
          <PanelLink href="/app/github">Pull requests</PanelLink>
        </div>
      }
    >
      {items.length === 0 ? (
        <p className={cn("border-t border-con-row py-6 text-[13px] leading-relaxed text-con-fg3", PAD_X)}>
          Nothing yet. Promotions, rollbacks and merge decisions appear here once Alror makes them.
        </p>
      ) : (
        <div key={page} className="con-fade border-t border-con-row pb-2">
          {groups.map((g) => (
            <section key={g.day} aria-label={g.day}>
              <h3 className={cn("pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-con-fg3", PAD_X)}>{g.day}</h3>
              <ol>
                {g.items.map((it, i) => {
                  const k = KIND[it.kind];
                  const body = (
                    <>
                      <span className="relative flex w-5 shrink-0 justify-center self-stretch">
                        {i < g.items.length - 1 && <span aria-hidden className="absolute bottom-[-12px] top-6 w-px bg-con-row" />}
                        <span className="relative mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-con-line bg-con-panel" title={k.label}>
                          <k.Icon size={11} className={k.tone} strokeWidth={2.25} aria-label={k.label} />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-con-fg">{it.title}</span>
                        <span className="line-clamp-2 break-words text-[12px] leading-relaxed text-con-fg3">{it.reason}</span>
                      </span>
                      <time dateTime={it.at} title={`${hm(it.at)} UTC`} className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-con-fg3">
                        {ago(it.at, now)}
                      </time>
                    </>
                  );
                  const cls = cn("con-ease flex items-start gap-3 py-2.5", PAD_X);
                  return (
                    <li key={it.key}>
                      {it.href ? (
                        <Link href={it.href} className={cn(cls, "hover:bg-con-hover")}>
                          {body}
                        </Link>
                      ) : (
                        <div className={cls}>{body}</div>
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
        <nav aria-label="What Alror did pages" className={cn("flex items-center justify-between gap-3 border-t border-con-row py-2.5", PAD_X)}>
          <span className="text-[12px] tabular-nums text-con-fg3" aria-live="polite">
            Page {page} of {pages}
          </span>
          <span className="flex items-center gap-1.5">
            <PageButton href={prevHref} label="Newer">
              <ChevronLeft size={14} />
            </PageButton>
            <PageButton href={nextHref} label="Older">
              <ChevronRight size={14} />
            </PageButton>
          </span>
        </nav>
      )}
    </Panel>
  );
}
