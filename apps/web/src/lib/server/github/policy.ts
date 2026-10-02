import { z } from "zod";
import { DEFAULT_POLICY, type GatePolicy, type GateResult, type PullSnapshot, type ChangedFile, type CheckEvidence } from "./types";

const glob = z.string().trim().min(1).max(200).refine((p) => !p.includes("..") && !p.includes("\\") && !p.startsWith("/"), "Use repository-relative paths and * or ** wildcards.");
export const policySchema = z.object({
  mode: z.enum(["observe", "review", "auto_merge"]),
  maxChangedLines: z.number().int().min(1).max(10000), maxChangedFiles: z.number().int().min(1).max(500),
  protectedPaths: z.array(glob).max(100), allowedPaths: z.array(glob).min(1).max(100),
  requiredChecks: z.array(z.object({ name: z.string().trim().min(1).max(150), appId: z.number().int().positive() })).max(30),
  reviewers: z.array(z.string().regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/)).max(15),
  requireTests: z.boolean(), allowForks: z.boolean(), mergeMethod: z.enum(["squash", "merge", "rebase"]),
}).strict().superRefine((p, ctx) => {
  if (p.mode === "auto_merge" && p.requiredChecks.length === 0) ctx.addIssue({ code: "custom", path: ["requiredChecks"], message: "Auto-merge requires at least one trusted CI check." });
  const keys = p.requiredChecks.map((c) => `${c.appId}:${c.name}`);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["requiredChecks"], message: "Required checks must be unique." });
});

/** Small deterministic glob grammar: * in one component, ** across directories. */
export function matchesPath(path: string, pattern: string): boolean {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") { re += "(?:.*/)?"; i += 2; }
      else { re += ".*"; i++; }
    } else if (pattern[i] === "*") re += "[^/]*";
    else re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$", "i").test(path);
}

const sensitive = /(^|\/)(auth(?:entication|orization)?|payments?|billing|security|secrets?|migrations?|terraform|infra(?:structure)?|iam|rbac)(\/|[._-]|$)|(?:^|\/)\.github\/|(?:^|\/)\.alror\/|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;
const testFile = /(?:^|\/)(?:tests?\/|test_[^/]+\.py$)|_test\.go$|\.(?:test|spec)\.[jt]sx?$/i;
const docsFile = /\.(?:md|mdx|txt)$/i;

/** Gate rules are independent of risk points. A small or docs-only diff cannot bypass a protected path. */
export function evaluatePolicy(policy: GatePolicy, pull: PullSnapshot, files: ChangedFile[], checks: CheckEvidence[]): GateResult {
  if (pull.merged || pull.state !== "open") return { outcome: "closed", score: 0, reasons: [pull.merged ? "This pull request is already merged." : "This pull request is closed."] };
  const review: string[] = [], wait: string[] = [];
  let score = 0;
  if (pull.draft) wait.push("The pull request is still a draft.");
  if (!pull.head.repo || (!policy.allowForks && pull.head.repo.id !== pull.base.repo.id)) review.push("Changes from forks require human review.");
  if (files.length === 0 || files.length !== pull.changed_files) review.push("The complete changed-file inventory could not be verified.");
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  if (lines > policy.maxChangedLines || pull.additions + pull.deletions > policy.maxChangedLines) { review.push(`Change exceeds the ${policy.maxChangedLines}-line limit.`); score += 30; }
  if (pull.changed_files > policy.maxChangedFiles) { review.push(`Change exceeds the ${policy.maxChangedFiles}-file limit.`); score += 20; }
  const allPaths = [...new Set(files.flatMap((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])]))];
  const protectedFiles = allPaths.filter((p) => sensitive.test(p) || policy.protectedPaths.some((g) => matchesPath(p, g)));
  if (protectedFiles.length) { review.push(`Protected changes need review: ${protectedFiles.slice(0, 5).join(", ")}${protectedFiles.length > 5 ? ", …" : ""}.`); score += 40; }
  const outside = allPaths.filter((p) => !policy.allowedPaths.some((g) => matchesPath(p, g)));
  if (outside.length) { review.push(`Changes outside the automatic-merge allowlist: ${outside.slice(0, 5).join(", ")}.`); score += 15; }
  if (policy.requireTests && files.some((f) => !docsFile.test(f.filename) && !testFile.test(f.filename)) && !files.some((f) => testFile.test(f.filename) && f.status !== "removed" && f.additions > 0)) {
    review.push("Code changed without added or updated tests."); score += 15;
  }
  for (const required of policy.requiredChecks) {
    const matching = checks.filter((c) => c.name === required.name && c.appId === required.appId);
    if (!matching.length || matching.some((c) => c.status !== "completed")) wait.push(`Waiting for ${required.name} from GitHub App ${required.appId}.`);
    const failed = matching.find((c) => c.status === "completed" && c.conclusion !== "success");
    if (failed) review.push(`Required check ${required.name} did not pass (${failed.conclusion || "unknown"}).`);
  }
  if (policy.mode === "auto_merge" && policy.requiredChecks.length === 0) review.push("Automatic merging requires at least one trusted CI check.");
  if (pull.mergeable === false || pull.mergeable_state === "dirty") review.push("GitHub reports a merge conflict.");
  if (pull.mergeable === null || pull.mergeable_state === "unknown") wait.push("GitHub is still calculating mergeability for the current commit.");
  return { outcome: review.length ? "review_required" : wait.length ? "waiting" : "eligible", score: Math.min(100, score), reasons: [...review, ...wait, ...(!review.length && !wait.length ? ["The current commit satisfies the configured change and CI rules."] : [])] };
}

export function normalizePolicy(input: unknown): GatePolicy { return policySchema.parse(input ?? DEFAULT_POLICY); }
