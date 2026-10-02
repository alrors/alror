// Helpers that make API JSON match what Go's encoding/json produces for the
// alror/internal/domain structs: RFC 3339 times with trailing fractional zeros
// trimmed, and keys in struct-field order (Postgres jsonb does not keep key order).

import type { Deployment, Verdict } from "@/lib/console/types";

/** Go's time.Time MarshalJSON (RFC3339Nano): "…:05Z", "…:05.1Z", "…:05.123Z". */
export function goTime(d: Date): string {
  return d.toISOString().replace(/\.(\d*?)0+Z$/, (_m, frac: string) => (frac ? `.${frac}Z` : "Z"));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Copies `v` with `keys` first (in order, when present) and any unknown keys after. */
function ordered(v: unknown, keys: string[]): unknown {
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const k of keys) if (k in v) out[k] = v[k];
  for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k];
  return out;
}

const list = (v: unknown, f: (x: unknown) => unknown) => (Array.isArray(v) ? v.map(f) : v);

export function orderRisk(v: unknown): Deployment["risk"] {
  const r = ordered(v, ["score", "level", "factors", "services", "ai_authored"]) as Obj;
  if (isObj(r)) r.factors = list(r.factors, (f) => ordered(f, ["name", "detail", "points"]));
  return r as Deployment["risk"];
}

export function orderPlan(v: unknown): Deployment["plan"] {
  const p = ordered(v, ["strategy", "steps"]) as Obj;
  if (isObj(p)) p.steps = list(p.steps, (s) => ordered(s, ["weight", "bake"]));
  return p as Deployment["plan"];
}

export function orderVerdict(v: unknown): Verdict {
  const o = ordered(v, ["pass", "results", "summary"]) as Obj;
  if (isObj(o)) o.results = list(o.results, (r) => ordered(r, ["metric", "canary", "baseline", "delta", "p_value", "pass", "reason"]));
  return o as Verdict;
}
