/**
 * Rule-based change risk, computed from the shared rules file. rules.json is a
 * byte-for-byte copy of internal/risk/rules.json (the Go CLI and runner embed
 * the original); scripts/sync-rules.mjs copies it and CI fails on drift. The
 * shared fixtures in tests/fixtures/risk run against this module and `go test`.
 */
import rulesFile from "./rules.json";

export type RiskLevel = "low" | "medium" | "high";
export type RiskFactor = { name: string; detail: string; points: number };
/** Same JSON shape as Go's domain.RiskReport. */
export type RiskReport = { score: number; level: RiskLevel; factors: RiskFactor[]; services: string[]; ai_authored: boolean };
export type PlanStep = { weight: number; bake_seconds: number };
export type RolloutPlan = { strategy: string; steps: PlanStep[] };
export type ServiceRule = { name: string; paths: string[]; critical: boolean };
export type FileChange = { path: string; added: number; deleted: number };
export type Change = { files: FileChange[]; authors: string[]; message: string; recentRollbacks: Record<string, number> };

type Fixed = { name: string; detail: string; points: number };
type RulesFile = {
  version: number; max_score: number; levels: { medium: number; high: number };
  patterns: { test_file: string; doc_file: string; ai_author: string; ai_trailer: string };
  sensitive_paths: { name: string; pattern: string }[];
  factors: {
    docs_only: Fixed;
    diff_size: { detail: string; tiers: { min_lines: number; name: string; points: number }[] };
    many_files: { name: string; detail: string; tiers: { min_files: number; points: number }[] };
    blast_radius: { name: string; detail: string; points_per_extra_service: number; max_points: number };
    critical_service: Fixed;
    sensitive_paths: { name: string; detail: string; points_per_area: number; max_points: number };
    no_tests: Fixed;
    well_tested: Fixed & { min_tests_per_code_file: number };
    ai_authored: Fixed;
    recent_rollbacks: { name: string; detail: string; points_per_rollback: number; max_points: number; window_days: number };
  };
  plans: Record<RiskLevel, RolloutPlan>;
};

export const rules = rulesFile as RulesFile;
export const RULES_VERSION = rules.version;
// Patterns are the common subset of RE2 and ECMAScript, always case-insensitive (Go prefixes (?i)).
const re = (pattern: string) => new RegExp(pattern, "i");
const testFile = re(rules.patterns.test_file), docFile = re(rules.patterns.doc_file);
const aiAuthor = re(rules.patterns.ai_author), aiTrailer = re(rules.patterns.ai_trailer);
const sensitive = rules.sensitive_paths.map((s) => ({ name: s.name, re: re(s.pattern) }));
for (const level of ["low", "medium", "high"] as const) {
  const steps = rules.plans[level]?.steps;
  if (!steps?.length || steps[steps.length - 1].weight !== 100) throw new Error(`Shared risk rules: plan ${level} must end at 100%.`);
}

export const isTestFile = (path: string) => testFile.test(path);
export const isDocFile = (path: string) => docFile.test(path);
export const isAIAuthored = (authors: string[], message: string) => aiTrailer.test(message) || authors.some((a) => aiAuthor.test(a));

/** The sensitive area a path falls in, or "". Leftmost match wins, ties go to the earlier rule (like one alternation). */
export function sensitiveArea(path: string): string {
  let best = "", at = -1;
  for (const s of sensitive) {
    const i = path.search(s.re);
    if (i >= 0 && (at < 0 || i < at)) { best = s.name; at = i; }
  }
  return best;
}

export function levelFor(score: number): RiskLevel {
  return score >= rules.levels.high ? "high" : score >= rules.levels.medium ? "medium" : "low";
}

export function planFor(level: RiskLevel): RolloutPlan {
  const plan = rules.plans[level] ?? rules.plans.medium;
  return { strategy: plan.strategy, steps: plan.steps.map((s) => ({ weight: s.weight, bake_seconds: s.bake_seconds })) };
}

/** Prefix match on slash paths, in configuration order (Go: config.ServicesForPath). */
export function servicesForPath(services: ServiceRule[], file: string): ServiceRule[] {
  const path = file.replace(/\\/g, "/");
  return services.filter((s) => s.paths.some((p) => path.startsWith(p.replace(/\\/g, "/"))));
}

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
const sortedNames = (m: Map<string, ServiceRule>) => [...m.keys()].sort();

/** Port of Go's risk.Score: every point comes from a named factor in the shared rules. */
export function scoreChange(services: ServiceRule[], change: Change): RiskReport {
  const f = rules.factors;
  const factors: RiskFactor[] = [];
  const add = (name: string, detail: string, points: number) => { if (points !== 0) factors.push({ name, detail, points }); };

  let lines = 0, code = 0, tests = 0, docs = 0;
  const hits = new Set<string>();
  const touched = new Map<string, ServiceRule>();
  for (const file of change.files) {
    lines += file.added + file.deleted;
    if (isTestFile(file.path)) tests++;
    else if (isDocFile(file.path)) docs++;
    else code++;
    const area = sensitiveArea(file.path);
    if (area) hits.add(area);
    for (const s of servicesForPath(services, file.path)) touched.set(s.name, s);
  }

  if (change.files.length > 0 && docs === change.files.length) {
    return finish([{ name: f.docs_only.name, detail: fill(f.docs_only.detail, { docs }), points: f.docs_only.points }], touched, false);
  }

  const size = f.diff_size.tiers.find((t) => lines >= t.min_lines);
  if (size) add(size.name, fill(f.diff_size.detail, { lines }), size.points);
  const many = f.many_files.tiers.find((t) => change.files.length >= t.min_files);
  if (many) add(f.many_files.name, fill(f.many_files.detail, { files: change.files.length }), many.points);

  if (touched.size > 1) {
    const b = f.blast_radius;
    add(b.name, fill(b.detail, { count: touched.size, services: sortedNames(touched).join(", ") }), Math.min(b.points_per_extra_service * (touched.size - 1), b.max_points));
  }
  const critical = sortedNames(touched).find((n) => touched.get(n)!.critical);
  if (critical) add(f.critical_service.name, fill(f.critical_service.detail, { service: critical }), f.critical_service.points);

  if (hits.size > 0) {
    const s = f.sensitive_paths;
    add(s.name, fill(s.detail, { areas: [...hits].sort().join(", ") }), Math.min(s.points_per_area * hits.size, s.max_points));
  }

  if (code > 0 && tests === 0) add(f.no_tests.name, fill(f.no_tests.detail, { code, tests }), f.no_tests.points);
  else if (code > 0 && tests >= f.well_tested.min_tests_per_code_file * code) add(f.well_tested.name, fill(f.well_tested.detail, { code, tests }), f.well_tested.points);

  const ai = isAIAuthored(change.authors, change.message);
  if (ai) add(f.ai_authored.name, f.ai_authored.detail, f.ai_authored.points);

  let rollbacks = 0;
  for (const name of touched.keys()) rollbacks += change.recentRollbacks[name] ?? 0;
  if (rollbacks > 0) {
    const r = f.recent_rollbacks;
    add(r.name, fill(r.detail, { rollbacks, days: r.window_days }), Math.min(r.points_per_rollback * rollbacks, r.max_points));
  }
  return finish(factors, touched, ai);
}

function finish(factors: RiskFactor[], touched: Map<string, ServiceRule>, ai: boolean): RiskReport {
  const total = factors.reduce((n, x) => n + x.points, 0);
  const score = Math.max(0, Math.min(total, rules.max_score));
  // Array.prototype.sort is stable, like Go's sort.SliceStable.
  return { score, level: levelFor(score), factors: [...factors].sort((a, b) => b.points - a.points), services: sortedNames(touched), ai_authored: ai };
}
