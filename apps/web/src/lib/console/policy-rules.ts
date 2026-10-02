// Pure policy helpers shared by the policy editor (client) and the server action
// that saves it. Keep this module free of server-only imports.

import type { Level } from "./types";

export const LEVELS: Level[] = ["low", "medium", "high"];

export type PlanStep = { weight: number; bakeMin: number };
export type Plans = Record<Level, PlanStep[]>;

/** Mirrors alror/internal/rollout/planner.go: the plans used when the org has not customised them. */
export const DEFAULT_PLANS: Plans = {
  low: [
    { weight: 25, bakeMin: 5 },
    { weight: 100, bakeMin: 0 },
  ],
  medium: [
    { weight: 5, bakeMin: 10 },
    { weight: 25, bakeMin: 10 },
    { weight: 50, bakeMin: 10 },
    { weight: 100, bakeMin: 0 },
  ],
  high: [
    { weight: 1, bakeMin: 15 },
    { weight: 5, bakeMin: 15 },
    { weight: 25, bakeMin: 15 },
    { weight: 50, bakeMin: 15 },
    { weight: 100, bakeMin: 0 },
  ],
};

const NS_PER_MIN = 60_000_000_000;

/** Stored shape (Go domain.Step: weight, bake in nanoseconds). */
export type StoredPlans = Record<string, { weight: number; bake: number }[]>;

export function plansToStored(p: Plans): StoredPlans {
  return Object.fromEntries(LEVELS.map((l) => [l, p[l].map((s) => ({ weight: s.weight, bake: s.bakeMin * NS_PER_MIN }))]));
}

export function plansFromStored(s: StoredPlans | null | undefined): Plans {
  if (!s) return DEFAULT_PLANS;
  const out = { ...DEFAULT_PLANS };
  for (const l of LEVELS) {
    const steps = s[l];
    if (Array.isArray(steps) && steps.length) out[l] = steps.map((x) => ({ weight: Number(x.weight), bakeMin: Math.round(Number(x.bake) / NS_PER_MIN) }));
  }
  return out;
}

export function samePlans(a: Plans, b: Plans): boolean {
  return LEVELS.every((l) => a[l].length === b[l].length && a[l].every((s, i) => s.weight === b[l][i].weight && s.bakeMin === b[l][i].bakeMin));
}

/** What the policy editor submits. Thresholds are percentages (25 = +25%). */
export type PolicyForm = {
  auto_rollback: boolean;
  alpha: number;
  bake_scale: number;
  thresholds: { metric: string; pct: number }[];
  plans: Plans;
};

export type PolicyErrors = Partial<Record<string, string>>;

export const METRIC_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const LIMITS = {
  alpha: { min: 0.001, max: 0.2 },
  bakeScale: { min: 0.01, max: 10 },
  pct: { min: 1, max: 1000 },
  metrics: 20,
  steps: 10,
  bakeMin: 1440,
} as const;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Validates the policy editor's input. Error keys: "alpha", "bake_scale",
 * "thresholds", "thresholds.<i>", "plans.<level>". Empty object means valid.
 */
export function validatePolicy(f: PolicyForm): PolicyErrors {
  const e: PolicyErrors = {};
  if (typeof f.auto_rollback !== "boolean") e.auto_rollback = "Choose a rollback mode.";
  if (!isNum(f.alpha) || f.alpha < LIMITS.alpha.min || f.alpha > LIMITS.alpha.max)
    e.alpha = `Alpha must be between ${LIMITS.alpha.min} and ${LIMITS.alpha.max}.`;
  if (!isNum(f.bake_scale) || f.bake_scale < LIMITS.bakeScale.min || f.bake_scale > LIMITS.bakeScale.max)
    e.bake_scale = `Bake scale must be between ${LIMITS.bakeScale.min} and ${LIMITS.bakeScale.max}.`;

  if (!Array.isArray(f.thresholds) || f.thresholds.length === 0) e.thresholds = "Add at least one metric threshold.";
  else if (f.thresholds.length > LIMITS.metrics) e.thresholds = `At most ${LIMITS.metrics} metrics.`;
  else {
    const seen = new Set<string>();
    f.thresholds.forEach((t, i) => {
      if (!METRIC_RE.test(t.metric ?? "")) e[`thresholds.${i}`] = "Use lowercase letters, digits and underscores.";
      else if (seen.has(t.metric)) e[`thresholds.${i}`] = `${t.metric} is listed twice.`;
      else if (!isNum(t.pct) || t.pct < LIMITS.pct.min || t.pct > LIMITS.pct.max)
        e[`thresholds.${i}`] = `Max regression must be ${LIMITS.pct.min}% to ${LIMITS.pct.max}%.`;
      seen.add(t.metric);
    });
  }

  Object.assign(e, validatePlans(f.plans));
  return e;
}

/** Plan rules: 1-10 stages, traffic strictly increasing, only the last stage at 100%, canary stages bake 1-1440 minutes. */
export function validatePlans(plans: Plans | undefined): PolicyErrors {
  const e: PolicyErrors = {};
  for (const l of LEVELS) {
    const steps = plans?.[l];
    const key = `plans.${l}`;
    if (!Array.isArray(steps) || steps.length === 0) {
      e[key] = "Add at least one stage.";
      continue;
    }
    if (steps.length > LIMITS.steps) {
      e[key] = `At most ${LIMITS.steps} stages.`;
      continue;
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const last = i === steps.length - 1;
      if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 100) {
        e[key] = `Stage ${i + 1}: traffic must be a whole number from 1 to 100.`;
        break;
      }
      if (i > 0 && s.weight <= steps[i - 1].weight) {
        e[key] = `Stage ${i + 1}: traffic must increase at every stage.`;
        break;
      }
      if (last && s.weight !== 100) {
        e[key] = "The last stage must send 100% of traffic.";
        break;
      }
      if (!last && s.weight === 100) {
        e[key] = "Only the last stage can send 100% of traffic.";
        break;
      }
      if (!Number.isInteger(s.bakeMin) || s.bakeMin < 0 || s.bakeMin > LIMITS.bakeMin) {
        e[key] = `Stage ${i + 1}: bake must be 0 to ${LIMITS.bakeMin} minutes.`;
        break;
      }
      if (!last && s.bakeMin < 1) {
        e[key] = `Stage ${i + 1}: canary stages need at least 1 minute of bake.`;
        break;
      }
    }
  }
  return e;
}

/** Normalises the final stage's bake to 0 (it promotes; nothing to bake). */
export function normalisePlans(p: Plans): Plans {
  return Object.fromEntries(LEVELS.map((l) => [l, p[l].map((s, i, a) => (i === a.length - 1 ? { ...s, bakeMin: 0 } : s))])) as Plans;
}
