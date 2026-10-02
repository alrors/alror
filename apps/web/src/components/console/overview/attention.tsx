"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CircleAlert, CircleCheck, OctagonAlert, RotateCcw, Timer, TriangleAlert, X } from "lucide-react";
import { ago } from "@/lib/console/format";
import type { AttentionItem, Severity } from "@/lib/console/overview";
import { cn } from "@/lib/site";
import { LaneRollback } from "./lane-rollback";
import { useLocalValue } from "./store";
import { Count, GHOST_BUTTON, PAD_X, Panel, SMALL_BUTTON } from "./ui";

const KEY = "alror.overview.dismissed.v1";
/** A dismissal lasts this long, or until the item changes (its key includes the occurrence). */
const SNOOZE_MS = 12 * 3_600_000;
/** Items shown before "Show more". */
const LIMIT = 4;

const SEV: Record<Severity, { label: string; text: string; bar: string; Icon: typeof CircleAlert }> = {
  critical: { label: "Critical", text: "text-con-bad", bar: "bg-con-bad", Icon: OctagonAlert },
  high: { label: "High", text: "text-con-warn", bar: "bg-con-warn", Icon: TriangleAlert },
  medium: { label: "Medium", text: "text-con-fg2", bar: "bg-con-fg3", Icon: CircleAlert },
};
const KIND_ICON: Partial<Record<AttentionItem["kind"], typeof CircleAlert>> = { stalled: Timer, queued: Timer, rolled_back: RotateCcw, recovered: RotateCcw };

function parseDismissed(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const all = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(all).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return {};
  }
}

/** Adds a dismissal that lasts SNOOZE_MS and drops expired ones. */
function withDismissal(current: Record<string, number>, key: string): string {
  const t = Date.now();
  const kept = Object.fromEntries(Object.entries(current).filter(([, until]) => until > t));
  return JSON.stringify({ ...kept, [key]: t + SNOOZE_MS });
}

export function NeedsAttention({ items, now, canRollBack }: { items: AttentionItem[]; now: number; canRollBack: boolean }) {
  const [raw, setRaw] = useLocalValue(KEY);
  const all = useMemo(() => parseDismissed(raw), [raw]);
  // Expiry is checked against the request time, so server and client agree.
  const dismissed = useMemo(() => Object.fromEntries(Object.entries(all).filter(([, until]) => until > now)), [all, now]);

  const visible = items.filter((it) => !dismissed[it.key]);
  const hiddenCount = items.length - visible.length;
  const dismiss = (key: string) => setRaw(withDismissal(all, key));
  const restore = () => setRaw(null);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? visible : visible.slice(0, LIMIT);
  const critical = visible.filter((i) => i.severity === "critical").length;

  return (
    <Panel
      widget="attention"
      label="Needs attention"
      flush
      title={
        <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-con-fg">
          Needs attention
          {visible.length > 0 && <Count className={critical ? "bg-con-bad/15 text-con-bad" : undefined}>{visible.length}</Count>}
        </h2>
      }
      tip="Failing verdicts, high-risk releases in progress, stalled or waiting jobs, and services that rolled back in the last 7 days, most severe first. Dismissing hides an item on this device for 12 hours, or until it changes."
      tipAlign="end"
      aside={
        hiddenCount > 0 ? (
          <button type="button" onClick={restore} className="rounded px-1 text-[12px] text-con-fg3 transition-colors duration-150 hover:text-con-fg">
            Show {hiddenCount} dismissed
          </button>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <div className={cn("flex items-start gap-3 border-t border-con-row py-5", PAD_X)}>
          <CircleCheck size={16} className="mt-0.5 shrink-0 text-con-fg3" />
          <div>
            <p className="text-[13px] font-medium text-con-fg">All clear</p>
            <p className="mt-0.5 text-[12px] text-con-fg3">
              {items.length ? "Everything here is dismissed for now." : "No failing verdicts, stalled jobs or recent rollbacks."}
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
              <li key={it.key} className={cn("group/item relative py-3 group-data-[density=compact]/ov:py-2.5", PAD_X)}>
                <span aria-hidden className={cn("absolute left-0 top-3 bottom-3 w-[2px] rounded-r", sev.bar)} />
                <div className="flex items-start gap-2.5">
                  <Icon size={15} className={cn("mt-[2px] shrink-0", sev.text)} aria-label={sev.label} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-[13px] font-medium leading-snug text-con-fg" title={it.title}>
                        {it.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => dismiss(it.key)}
                        aria-label={`Dismiss: ${it.title}`}
                        title="Dismiss for 12 hours"
                        className="-mr-1 -mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded text-con-fg3 opacity-60 outline-none transition-[opacity,color,background-color] duration-150 hover:bg-con-hover hover:text-con-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-con-line-hover group-hover/item:opacity-100"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-con-fg3" title={it.detail}>
                      {it.detail}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Link href={it.action.href} className={cn(SMALL_BUTTON, GHOST_BUTTON)}>
                        {it.action.label}
                      </Link>
                      {canRollBack && it.rollback && <LaneRollback id={it.rollback.id} service={it.rollback.service} />}
                      <span className="ml-auto text-[11.5px] text-con-fg3">{ago(it.at, now)}</span>
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
