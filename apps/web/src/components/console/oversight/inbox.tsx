"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClock, ArrowUpRight, CircleAlert, CircleCheck, GitPullRequest, OctagonAlert, RotateCcw, Siren, Timer, TriangleAlert, X } from "lucide-react";
import { LaneRollback } from "@/components/console/overview/lane-rollback";
import { useLocalValue } from "@/components/console/overview/store";
import { Count, GHOST_BUTTON, PAD_X, Panel, SMALL_BUTTON } from "@/components/console/overview/ui";
import { ago } from "@/lib/console/format";
import type { InboxItem, InboxKind, InboxLink } from "@/lib/console/oversight";
import type { Severity } from "@/lib/console/overview";
import { cn } from "@/lib/site";

// Dismissals and snoozes are per viewer and kept in this browser (no server state).
// An item's key includes its occurrence, so a dismissed item returns when something new happens.
const KEY = "alror.oversight.inbox.v1";
const SNOOZE_MS = 24 * 3_600_000;
const DISMISS_MS = 30 * 24 * 3_600_000;
const LIMIT = 6;

const SEV: Record<Severity, { label: string; text: string; bar: string; Icon: typeof CircleAlert }> = {
  critical: { label: "Critical", text: "text-con-bad", bar: "bg-con-bad", Icon: OctagonAlert },
  high: { label: "High", text: "text-con-warn", bar: "bg-con-warn", Icon: TriangleAlert },
  medium: { label: "Medium", text: "text-con-fg2", bar: "bg-con-fg3", Icon: CircleAlert },
};
const KIND_ICON: Partial<Record<InboxKind, typeof CircleAlert>> = {
  pull_review: GitPullRequest,
  pull_waiting: GitPullRequest,
  pull_error: GitPullRequest,
  stalled: Timer,
  queued: Timer,
  rollback_job_failed: RotateCcw,
  incident: Siren,
};

function parse(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const all = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(all).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return {};
  }
}

/** Hides `key` for `ms` from now and drops expired entries. */
function withHidden(current: Record<string, number>, key: string, ms: number): string {
  const t = Date.now();
  const kept = Object.fromEntries(Object.entries(current).filter(([, until]) => until > t));
  return JSON.stringify({ ...kept, [key]: t + ms });
}

function ItemLink({ link, className }: { link: InboxLink; className: string }) {
  return link.external ? (
    <a href={link.href} target="_blank" rel="noreferrer" className={className}>
      {link.label}
      <ArrowUpRight size={12} />
    </a>
  ) : (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  );
}

export function NeedsYou({ items, now, canRollBack }: { items: InboxItem[]; now: number; canRollBack: boolean }) {
  const [raw, setRaw] = useLocalValue(KEY);
  const all = useMemo(() => parse(raw), [raw]);
  // Expiry is checked against the request time, so the server and client renders agree.
  const hidden = useMemo(() => new Set(Object.entries(all).filter(([, until]) => until > now).map(([k]) => k)), [all, now]);
  const visible = items.filter((it) => !hidden.has(it.key));
  const hiddenCount = items.length - visible.length;
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? visible : visible.slice(0, LIMIT);
  const critical = visible.filter((i) => i.severity === "critical").length;

  const hide = (key: string, ms: number) => setRaw(withHidden(all, key, ms));

  return (
    <Panel
      label="Needs you"
      flush
      title={
        <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-con-fg">
          Needs you
          {visible.length > 0 && <Count className={critical ? "bg-con-bad/15 text-con-bad" : undefined}>{visible.length}</Count>}
        </h2>
      }
      tip="Pull requests the merge gate sent to a person or has waited on too long, open incidents from your alerts, releases whose rollback is unconfirmed or whose verdict had too little data or passed close to its limit, shadow-mode rollback recommendations, and stalled runner jobs. Snooze hides an item on this device for a day; dismiss hides it until it changes."
      tipAlign="end"
      aside={
        hiddenCount > 0 ? (
          <button type="button" onClick={() => setRaw(null)} className="rounded px-1 text-[12px] text-con-fg3 transition-colors duration-150 hover:text-con-fg">
            Show {hiddenCount} hidden
          </button>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <div className={cn("flex items-start gap-3 border-t border-con-row py-6", PAD_X)}>
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-con-fg3" />
          <div>
            <p className="text-[13px] font-medium text-con-fg">Nothing needs you</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-con-fg3">
              {items.length ? "Everything here is snoozed or dismissed for now." : "No pull requests waiting on a person, no unconfirmed rollbacks, no stalled runners. Alror handles the rest and lists it under What Alror did."}
            </p>
          </div>
        </div>
      ) : (
        <>
          <ul className="con-stagger divide-y divide-con-row border-t border-con-row">
            {shown.map((it) => {
              const sev = SEV[it.severity];
              const Icon = KIND_ICON[it.kind] ?? sev.Icon;
              return (
                <li key={it.key} className={cn("group/item relative py-3", PAD_X)}>
                  <span aria-hidden className={cn("absolute bottom-3 left-0 top-3 w-[2px] rounded-r", sev.bar)} />
                  <div className="flex items-start gap-2.5">
                    <Icon size={15} className={cn("mt-[2px] shrink-0", sev.text)} aria-label={sev.label} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 text-[13px] leading-snug">
                          <span className="font-medium text-con-fg">{it.subject}</span>
                          <span className="text-con-fg3"> · {it.owner}</span>
                        </p>
                        <span className="-mr-1 -mt-0.5 flex shrink-0 items-center opacity-70 transition-opacity duration-150 focus-within:opacity-100 group-hover/item:opacity-100">
                          <button
                            type="button"
                            onClick={() => hide(it.key, SNOOZE_MS)}
                            aria-label={`Snooze for a day: ${it.subject}`}
                            title="Snooze for a day"
                            className="grid h-6 w-6 place-items-center rounded text-con-fg3 outline-none transition-colors duration-150 hover:bg-con-hover hover:text-con-fg focus-visible:ring-1 focus-visible:ring-con-line-hover"
                          >
                            <AlarmClock size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => hide(it.key, DISMISS_MS)}
                            aria-label={`Dismiss until it changes: ${it.subject}`}
                            title="Dismiss until it changes"
                            className="grid h-6 w-6 place-items-center rounded text-con-fg3 outline-none transition-colors duration-150 hover:bg-con-hover hover:text-con-fg focus-visible:ring-1 focus-visible:ring-con-line-hover"
                          >
                            <X size={13} />
                          </button>
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 break-words text-[12.5px] leading-relaxed text-con-fg2" title={it.reason}>
                        {it.reason}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ItemLink link={it.primary} className={cn(SMALL_BUTTON, GHOST_BUTTON)} />
                        {it.secondary && <ItemLink link={it.secondary} className={cn(SMALL_BUTTON, "text-con-fg3 hover:bg-con-hover hover:text-con-fg")} />}
                        {canRollBack && it.rollback && <LaneRollback id={it.rollback.id} service={it.rollback.service} />}
                        <time dateTime={it.at} className="ml-auto text-[11.5px] tabular-nums text-con-fg3" title="How long this has needed attention">
                          {ago(it.at, now)}
                        </time>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length > LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              className={cn("w-full border-t border-con-row py-2.5 text-left text-[12px] text-con-fg3 outline-none transition-colors duration-150 hover:bg-con-hover hover:text-con-fg focus-visible:bg-con-hover", PAD_X)}
            >
              {expanded ? "Show fewer" : `Show ${visible.length - LIMIT} more`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}
