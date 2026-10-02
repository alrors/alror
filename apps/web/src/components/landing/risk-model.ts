// A faithful TypeScript port of the alror-cli risk scorer (internal/risk/scorer.go) and
// rollout plans, used by the landing-page demos. Every point comes from a named rule.

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

const SENSITIVE = /(auth|security|crypto|secret|payment|billing|ledger|migration|schema|terraform|helm|iam|rbac)/i;
const TEST_FILE = /(_test\.go$|\.test\.[jt]sx?$|\.spec\.[jt]sx?$|(^|\/)tests?\/|test_.*\.py$)/i;
const DOC_FILE = /(\.md$|\.mdx$|\.txt$|(^|\/)docs?\/)/i;

/** The services in the demo repository's alror.yaml. */
export const SERVICES: Service[] = [
  { name: "checkout-api", prefix: "services/checkout/", critical: true },
  { name: "auth-gateway", prefix: "services/auth/", critical: true },
  { name: "api-gateway", prefix: "services/gateway/", critical: true },
  { name: "search-indexer", prefix: "services/search/" },
];

export function levelFor(score: number): Level {
  if (score >= 70) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function score(pr: SamplePR): { score: number; level: Level; factors: Factor[]; services: string[] } {
  const factors: Factor[] = [];
  const add = (name: string, detail: string, points: number) => {
    if (points !== 0) factors.push({ name, detail, points });
  };

  let lines = 0;
  let code = 0;
  let tests = 0;
  let docs = 0;
  const sensitive = new Set<string>();
  const services = new Map<string, Service>();
  for (const f of pr.files) {
    lines += f.added + f.deleted;
    if (TEST_FILE.test(f.path)) tests++;
    else if (DOC_FILE.test(f.path)) docs++;
    else code++;
    const m = f.path.match(SENSITIVE);
    if (m) sensitive.add(m[0].toLowerCase());
    for (const s of SERVICES) if (f.path.startsWith(s.prefix)) services.set(s.name, s);
  }
  const names = [...services.keys()].sort();

  if (pr.files.length > 0 && docs === pr.files.length) {
    return { score: 2, level: "low", factors: [{ name: "Docs only", detail: `${docs} documentation files`, points: 2 }], services: names };
  }

  if (lines >= 1000) add("Large diff", `${lines} lines changed`, 30);
  else if (lines >= 500) add("Large diff", `${lines} lines changed`, 22);
  else if (lines >= 200) add("Medium diff", `${lines} lines changed`, 15);
  else if (lines >= 50) add("Small diff", `${lines} lines changed`, 8);
  const n = pr.files.length;
  if (n > 50) add("Many files", `${n} files touched`, 12);
  else if (n > 20) add("Many files", `${n} files touched`, 8);

  if (services.size > 1) add("Blast radius", `touches ${services.size} services: ${names.join(", ")}`, Math.min(8 * (services.size - 1), 20));
  const critical = [...services.values()].find((s) => s.critical);
  if (critical) add("Critical service", `${critical.name} is marked critical`, 12);

  if (sensitive.size > 0) add("Sensitive paths", `changes in ${[...sensitive].sort().join(", ")}`, Math.min(10 * sensitive.size, 20));

  if (code > 0 && tests === 0) add("No tests changed", `${code} code files, 0 test files`, 10);
  else if (code > 0 && tests * 2 >= code) add("Well tested", `${tests} test files for ${code} code files`, -5);

  if (pr.ai) add("AI-authored", "commit authors or trailers indicate a coding agent", 10);

  const rollbacks = names.reduce((sum, s) => sum + (pr.rollbacks[s] ?? 0), 0);
  if (rollbacks > 0) add("Recent rollbacks", `${rollbacks} rollbacks on these services in 30 days`, Math.min(6 * rollbacks, 18));

  const total = Math.max(0, Math.min(100, factors.reduce((s, f) => s + f.points, 0)));
  factors.sort((a, b) => b.points - a.points);
  return { score: total, level: levelFor(total), factors, services: names };
}

/** Built-in rollout plans: the score picks the plan. */
export const PLANS: Record<Level, { steps: number[]; bakeMin: number }> = {
  low: { steps: [25, 100], bakeMin: 5 },
  medium: { steps: [5, 25, 50, 100], bakeMin: 10 },
  high: { steps: [1, 5, 25, 50, 100], bakeMin: 15 },
};

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
    .filter((f) => /\.go$/.test(f.path) && !TEST_FILE.test(f.path))
    .map((f) => ({ path: f.path.replace(/\.go$/, "_test.go"), added: 40, deleted: 0 }));
  // Enough tests to cover the non-Go code files too (tests*2 >= code).
  const code = pr.files.filter((f) => !TEST_FILE.test(f.path) && !DOC_FILE.test(f.path)).length;
  while (tests.length * 2 < code) tests.push({ path: `tests/case_${tests.length + 1}_test.go`, added: 0, deleted: 0 });
  return { ...pr, files: [...pr.files, ...tests] };
}

export function formatBake(level: Level): string {
  const p = PLANS[level];
  const bakes = p.steps.length - 1;
  return `${p.steps.length} steps · ${bakes * p.bakeMin}m of bake time`;
}
