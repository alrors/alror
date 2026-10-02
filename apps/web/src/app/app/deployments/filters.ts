// Filtering and sorting for the deployments list. Shared by the page and the CSV export route.

import type { Deployment, Level, Status } from "@/lib/console/types";

export const STATUSES: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "rolling", label: "Rolling" },
  { value: "promoted", label: "Promoted" },
  { value: "rolled_back", label: "Rolled back" },
  { value: "failed", label: "Failed" },
];
export const LEVELS: Level[] = ["low", "medium", "high"];
export const SOURCES = ["cli", "ci", "console", "runner"] as const;
export type Source = (typeof SOURCES)[number];

export const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "risk", label: "Highest risk" },
  { value: "risk_asc", label: "Lowest risk" },
  { value: "duration", label: "Longest duration" },
  { value: "service", label: "Service A to Z" },
] as const;
export type Sort = (typeof SORTS)[number]["value"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export type Filters = {
  status: Status | "all";
  service: string;
  risk: Level | "";
  source: Source | "";
  ai: boolean;
  q: string;
  sort: Sort;
  /** Selected environment name, or null for all. */
  env: string | null;
  /** Raw ?environment= when given (overrides the top bar switcher). */
  envParam?: string;
};

export function parseFilters(sp: SP, services: string[], env: string | null): Filters {
  const statusRaw = one(sp.status);
  const sortRaw = one(sp.sort);
  return {
    status: STATUSES.some((s) => s.value === statusRaw) ? (statusRaw as Status | "all") : "all",
    service: services.includes(one(sp.service)) ? one(sp.service) : "",
    risk: LEVELS.includes(one(sp.risk) as Level) ? (one(sp.risk) as Level) : "",
    source: SOURCES.includes(one(sp.source) as Source) ? (one(sp.source) as Source) : "",
    ai: one(sp.ai) === "1",
    q: one(sp.q).trim().slice(0, 100),
    sort: SORTS.some((s) => s.value === sortRaw) ? (sortRaw as Sort) : "newest",
    env,
    envParam: typeof sp.environment === "string" ? sp.environment : undefined,
  };
}

/** URL params for the current view (defaults omitted). */
export function filterParams(f: Filters): Record<string, string | undefined> {
  return {
    status: f.status === "all" ? undefined : f.status,
    service: f.service || undefined,
    risk: f.risk || undefined,
    source: f.source || undefined,
    ai: f.ai ? "1" : undefined,
    q: f.q || undefined,
    sort: f.sort === "newest" ? undefined : f.sort,
    environment: f.envParam,
  };
}

export const matchesStatus = (d: Deployment, s: Status | "all") => s === "all" || d.status === s || (s === "rolling" && d.status === "pending");

/** Every filter except status, so the status tabs can show counts. */
export function applyBase(deps: Deployment[], f: Filters): Deployment[] {
  const needle = f.q.toLowerCase();
  return deps.filter(
    (d) =>
      (!f.env || (d.environment ?? "production") === f.env) &&
      (!f.service || d.service === f.service) &&
      (!f.risk || d.risk?.level === f.risk) &&
      (!f.source || (d.source ?? "cli") === f.source) &&
      (!f.ai || Boolean(d.risk?.ai_authored)) &&
      (!needle || [d.service, d.ref ?? "", d.image, d.id, d.reason ?? ""].some((x) => x.toLowerCase().includes(needle))),
  );
}

export function durationMs(d: Deployment, now: number): number {
  const end = d.status === "rolling" || d.status === "pending" ? now : Date.parse(d.updated_at);
  return Math.max(0, end - Date.parse(d.created_at));
}

export function sortDeployments(deps: Deployment[], sort: Sort, now: number): Deployment[] {
  const out = [...deps];
  const t = (d: Deployment) => Date.parse(d.created_at);
  switch (sort) {
    case "oldest":
      return out.sort((a, b) => t(a) - t(b));
    case "risk":
      return out.sort((a, b) => (b.risk?.score ?? 0) - (a.risk?.score ?? 0) || t(b) - t(a));
    case "risk_asc":
      return out.sort((a, b) => (a.risk?.score ?? 0) - (b.risk?.score ?? 0) || t(b) - t(a));
    case "duration":
      return out.sort((a, b) => durationMs(b, now) - durationMs(a, now) || t(b) - t(a));
    case "service":
      return out.sort((a, b) => a.service.localeCompare(b.service) || t(b) - t(a));
    default:
      return out.sort((a, b) => t(b) - t(a));
  }
}

export function isActive(f: Filters): boolean {
  return Boolean(f.service || f.risk || f.source || f.ai || f.q || f.status !== "all" || f.envParam || f.sort !== "newest");
}
