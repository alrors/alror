// Analytics used only by the Insights board. Pure, no I/O.

import { groupBy, isBad, summarize, type DayStat } from "./analytics";
import type { Deployment } from "./types";

export const RANGES = [7, 30, 90] as const;
export type InsightsRange = (typeof RANGES)[number];

export function parseInsightsRange(v: string | string[] | undefined): InsightsRange {
  const s = (Array.isArray(v) ? v[0] : v)?.replace(/d$/, "");
  const n = Number(s);
  return (RANGES as readonly number[]).includes(n) ? (n as InsightsRange) : 30;
}

/** Rolling window (days) that keeps sparse daily metrics readable for a range. */
export function rollingWindow(range: InsightsRange): number {
  return range === 7 ? 3 : range === 30 ? 7 : 14;
}

/** Merge consecutive days into buckets of `size` days (e.g. weeks for a 90-day view). */
export function bucket(days: DayStat[], size: number): DayStat[] {
  if (size <= 1) return days;
  const out: DayStat[] = [];
  for (let i = 0; i < days.length; i += size) {
    const part = days.slice(i, i + size);
    out.push({
      day: part[0].day,
      deps: part.flatMap((d) => d.deps),
      promoted: part.reduce((s, d) => s + d.promoted, 0),
      bad: part.reduce((s, d) => s + d.bad, 0),
      other: part.reduce((s, d) => s + d.other, 0),
    });
  }
  return out;
}

/** Change failure rate, or null when nothing in the list has finished. */
export function cfrOrNull(deps: Deployment[]): number | null {
  const s = summarize(deps);
  return s.finished ? s.cfr : null;
}

/** A duration split for an animated counter: value, decimals and unit suffix. */
export function durationParts(ms: number | null): { value: number; decimals: number; suffix: string } | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const min = ms / 60000;
  if (min < 1) return { value: Math.round(ms / 1000), decimals: 0, suffix: "s" };
  if (min < 90) return { value: min, decimals: min < 10 ? 1 : 0, suffix: "m" };
  const h = min / 60;
  if (h < 48) return { value: h, decimals: 1, suffix: "h" };
  return { value: h / 24, decimals: 1, suffix: "d" };
}

export type ServiceRollbacks = { service: string; total: number; finished: number; bad: number; cfr: number };

/** Rollbacks and failures per service, worst first; services with none come last. */
export function rollbacksByService(deps: Deployment[]): ServiceRollbacks[] {
  return [...groupBy(deps, (d) => d.service).entries()]
    .map(([service, list]) => {
      const s = summarize(list);
      return { service, total: s.total, finished: s.finished, bad: list.filter((d) => isBad(d.status)).length, cfr: s.cfr };
    })
    .sort((a, b) => b.bad - a.bad || b.cfr - a.cfr || a.service.localeCompare(b.service));
}
