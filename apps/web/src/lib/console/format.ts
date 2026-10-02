// Pure formatting helpers, safe on server and client.

import type { Level, Status } from "./types";

export const statusLabel: Record<Status, string> = {
  pending: "Pending",
  rolling: "Rolling",
  promoted: "Promoted",
  rolled_back: "Rolled back",
  failed: "Failed",
};

export type Tone = "good" | "warn" | "bad" | "info" | "idle";

export function statusTone(s: Status): Tone {
  switch (s) {
    case "promoted":
      return "good";
    case "rolling":
      return "info";
    case "pending":
      return "idle";
    case "rolled_back":
      return "warn";
    case "failed":
      return "bad";
  }
}

export function levelTone(l: Level | undefined): Tone {
  return l === "high" ? "bad" : l === "medium" ? "warn" : "good";
}

export function riskTone(score: number): Tone {
  return score >= 70 ? "bad" : score >= 35 ? "warn" : "good";
}

/** Go time.Duration (nanoseconds) to a short label, e.g. "15m", "1h30m". */
export function duration(ns: number): string {
  if (!ns || ns <= 0) return "0s";
  let s = Math.round(ns / 1e9);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join("") || "0s";
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x: number): string {
  const v = x * 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function metricValue(metric: string, v: number): string {
  if (metric.includes("latency")) return `${v.toFixed(1)} ms`;
  return v.toFixed(3);
}

export function pValue(p: number): string {
  if (p < 0.001) return "<0.001";
  return p.toFixed(3);
}

const fmtDateTime = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const fmtTime = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
});

export function dateTime(iso: string): string {
  return `${fmtDateTime.format(new Date(iso))} UTC`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${fmtTime.format(d)}.${ms}`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Elapsed time between two ISO timestamps, e.g. "2.7s" or "4m 10s". */
export function elapsed(from: string, to: string): string {
  const ms = Math.max(0, Date.parse(to) - Date.parse(from));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 3_600_000) return span(ms);
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Milliseconds to a compact label, e.g. "42s", "18m", "1h 12m", "2d 4h". */
export function span(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "n/a";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const fmtDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "14 Sep" */
export function dayLabel(t: number | string): string {
  return fmtDay.format(new Date(t));
}

/** "Tue 14 Sep" */
export function weekdayLabel(t: number | string): string {
  return fmtWeekday.format(new Date(t));
}

export function metricLabel(metric: string): string {
  if (metric === "error_rate") return "Error rate";
  if (metric === "latency_p95") return "Latency p95";
  return metric.replace(/_/g, " ");
}

/** Metric value with its unit: error rate in %, latency in ms. */
export function metricUnitValue(metric: string, v: number): string {
  if (metric.includes("latency")) return `${v.toFixed(v >= 100 ? 0 : 1)} ms`;
  if (metric.includes("error")) return `${v.toFixed(3)}%`;
  return v.toFixed(3);
}

const fmtHm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hourCycle: "h23" });

/** "14:02" (UTC). */
export function hm(iso: string): string {
  return fmtHm.format(new Date(iso));
}

/** The request's wall-clock time, for server components that render relative times. */
export function requestTime(): number {
  return Date.now();
}
