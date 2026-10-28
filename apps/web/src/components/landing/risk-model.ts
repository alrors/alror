// The landing-page demos score with the shared risk rules (src/lib/server/decision/rules.json, the
// same file the alror CLI embeds), so the demo and the product can never disagree.
import { isDocFile, isTestFile, levelFor as sharedLevelFor, planFor, scoreChange } from "@/lib/server/decision/score";

export type FileChange = { path: string; added: number; deleted: number };
export type Service = { name: string; critical?: boolean; prefix: string };
export type Factor = { name: string; detail: string; points: number };
export type Level = "low" | "medium" | "high";

export type SamplePR = {
  number: number;
  title: string;
  author: string;
  ai: boolean;
  files: FileChange[];
  /** Rollbacks per service in the last 30 days. */
  rollbacks: Record<string, number>;
};

/** The services in the demo repository's alror.yaml. */
export const SERVICES: Service[] = [
  { name: "checkout-api", prefix: "services/checkout/", critical: true },
  { name: "auth-gateway", prefix: "services/auth/", critical: true },
  { name: "api-gateway", prefix: "services/gateway/", critical: true },
  { name: "search-indexer", prefix: "services/search/" },
];

export function levelFor(score: number): Level {
  return sharedLevelFor(score);
}

export function score(pr: SamplePR): { score: number; level: Level; factors: Factor[]; services: string[] } {
  const r = scoreChange(SERVICES.map((s) => ({ name: s.name, paths: [s.prefix], critical: !!s.critical })), {
    files: pr.files, authors: [], message: pr.ai ? "AI-assisted: true" : "", recentRollbacks: pr.rollbacks,
  });
  return { score: r.score, level: r.level, factors: r.factors, services: r.services };
}

/** Built-in rollout plans from the shared rules: the score picks the plan. */
export const PLANS = Object.fromEntries((["low", "medium", "high"] as const).map((level) => {
  const plan = planFor(level);
  return [level, { steps: plan.steps.map((s) => s.weight), bakeMin: plan.steps[0].bake_seconds / 60 }];
})) as Record<Level, { steps: number[]; bakeMin: number }>;

export const LEVEL_COLOR: Record<Level, string> = {
  low: "#35e08f",
  medium: "#f5a524",
  high: "#f2555a",
};

/** Sample pull requests for the risk demo (scores match the CLI captures). */
export const SAMPLES: SamplePR[] = [
  {
    number: 4817,
    title: "Bump analyzer to v3",
    author: "m.okafor",
    ai: false,
    files: [
      { path: "services/search/analyzer.go", added: 88, deleted: 40 },
      { path: "services/search/go.mod", added: 2, deleted: 2 },
    ],
    rollbacks: {},
  },
  {
    number: 4821,
    title: "Batch retries for payment capture",
    author: "agent",
    ai: true,
    files: [{ path: "services/checkout/payment/retry.go", added: 98, deleted: 22 }],
    rollbacks: { "checkout-api": 2 },
  },
  {
    number: 4806,
    title: "Rotate session key derivation",
    author: "j.lindqvist",
    ai: false,
    files: [
      { path: "services/auth/crypto/kdf.go", added: 310, deleted: 120 },
      { path: "services/auth/session.go", added: 40, deleted: 12 },
      { path: "services/gateway/middleware.go", added: 28, deleted: 10 },
      { path: "deploy/helm/auth-gateway/values.yaml", added: 4, deleted: 2 },
    ],
    rollbacks: { "auth-gateway": 2 },
  },
];

/** Adds a matching test file per code file (what "add tests" does in the demo). */
export function withTests(pr: SamplePR): SamplePR {
  const tests = pr.files
    .filter((f) => /\.go$/.test(f.path) && !isTestFile(f.path))
    .map((f) => ({ path: f.path.replace(/\.go$/, "_test.go"), added: 40, deleted: 0 }));
  // Enough tests to cover the non-Go code files too (tests*2 >= code).
  const code = pr.files.filter((f) => !isTestFile(f.path) && !isDocFile(f.path)).length;
  while (tests.length * 2 < code) tests.push({ path: `tests/case_${tests.length + 1}_test.go`, added: 0, deleted: 0 });
  return { ...pr, files: [...pr.files, ...tests] };
}

export function formatBake(level: Level): string {
  const p = PLANS[level];
  const bakes = p.steps.length - 1;
  return `${p.steps.length} steps · ${bakes * p.bakeMin}m of bake time`;
}
