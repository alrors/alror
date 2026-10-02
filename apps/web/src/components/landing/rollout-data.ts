// Deterministic rollout data for the landing demos, taken from real `alror deploy` captures
// (public/generated/cli-deploy.webp and cli-rollback.webp). error_rate is a percentage.

export type MetricVerdict = {
  metric: "error_rate" | "latency_p95";
  canary: number;
  baseline: number;
  /** Relative change, e.g. -0.053 for -5.3%. */
  delta: number;
  p: number;
  pass: boolean;
};

export type Stage = { weight: number; verdicts: MetricVerdict[] };

export type Scenario = {
  id: "healthy" | "regression";
  label: string;
  ref: string;
  image: string;
  depId: string;
  stages: Stage[];
  outcome: { kind: "promoted" | "rolled_back"; at: number; reason: string; duration: string };
};

/** Policy defaults from `alror init`. */
export const LIMITS = { error_rate: 0.25, latency_p95: 0.15 } as const;
export const ALPHA = 0.05;

export const SCENARIOS: Scenario[] = [
  {
    id: "healthy",
    label: "Healthy release",
    ref: "#4821",
    image: "registry/checkout:1.42",
    depId: "dep_20261001T192019_9d55eb",
    stages: [
      {
        weight: 5,
        verdicts: [
          { metric: "error_rate", canary: 0.208, baseline: 0.22, delta: -0.053, p: 0.988, pass: true },
          { metric: "latency_p95", canary: 177, baseline: 182, delta: -0.026, p: 0.963, pass: true },
        ],
      },
      {
        weight: 25,
        verdicts: [
          { metric: "error_rate", canary: 0.197, baseline: 0.21, delta: -0.062, p: 0.91, pass: true },
          { metric: "latency_p95", canary: 176, baseline: 179, delta: -0.017, p: 0.915, pass: true },
        ],
      },
      {
        weight: 50,
        verdicts: [
          { metric: "error_rate", canary: 0.205, baseline: 0.215, delta: -0.047, p: 0.935, pass: true },
          { metric: "latency_p95", canary: 177, baseline: 181, delta: -0.022, p: 0.964, pass: true },
        ],
      },
    ],
    outcome: { kind: "promoted", at: 100, reason: "Verified at every step · promoted checkout-api to 100%", duration: "5.556s" },
  },
  {
    id: "regression",
    label: "Regression",
    ref: "#4822",
    image: "registry/checkout:1.43",
    depId: "dep_20261001T192025_844fe3",
    stages: [
      {
        weight: 5,
        verdicts: [
          { metric: "error_rate", canary: 0.362, baseline: 0.213, delta: 0.699, p: 0.0, pass: false },
          { metric: "latency_p95", canary: 178, baseline: 180, delta: -0.008, p: 0.899, pass: true },
        ],
      },
    ],
    outcome: {
      kind: "rolled_back",
      at: 5,
      reason: "Regression: error_rate up 70% vs baseline (limit 25%, p=0.000)",
      duration: "1.845s",
    },
  },
];

/** Small seeded PRNG so the illustrative series are identical on server and client. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples around a median, for drawing a bake window. */
export function series(median: number, n: number, spread: number, seed: number): number[] {
  const r = seeded(seed);
  return Array.from({ length: n }, () => median * (1 + (r() - 0.5) * 2 * spread));
}

export const fmtDelta = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(1)}%`;
export const fmtP = (p: number) => `p=${p.toFixed(3)}`;
export const fmtValue = (m: MetricVerdict["metric"], v: number) => (m === "error_rate" ? `${v}%` : `${v} ms`);
