import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { appJwt, GitHubClient } from "../src/lib/server/github/client";
import { DECISION_UNAVAILABLE, evaluatePull, hasBlockingReview, type Evaluation } from "../src/lib/server/github/evaluate";
import { evaluatePolicy, matchesPath, normalizePolicy } from "../src/lib/server/github/policy";
import { COMMENT_MARKER, decisionMarkdown, decisionPath } from "../src/lib/server/github/report";
import { verifySignature } from "../src/lib/server/github/webhook";
import { DEFAULT_POLICY, type ChangedFile, type GatePolicy, type PullSnapshot } from "../src/lib/server/github/types";

const pull: PullSnapshot = { number: 7, title: "Improve documentation", html_url: "https://github.com/example/project/pull/7", state: "open", draft: false, merged: false, changed_files: 1, additions: 3, deletions: 1,
  head: { sha: "a".repeat(40), repo: { id: 12 } }, base: { sha: "b".repeat(40), ref: "main", repo: { id: 12 } }, user: { login: "contributor" }, mergeable: true, mergeable_state: "clean" };
const files: ChangedFile[] = [{ filename: "docs/start.md", status: "modified", additions: 3, deletions: 1 }];
const policy: GatePolicy = { ...DEFAULT_POLICY, mode: "auto_merge", requiredChecks: [{ name: "test", appId: 55 }] };
const evidence = [{ name: "test", appId: 55, status: "completed", conclusion: "success" }];

test("decision reports link to the exact PR and distinguish missing CI policy from passing CI", () => {
  const destination = `https://alror.com${decisionPath("12", 7)}`;
  assert.equal(destination, "https://alror.com/app/github/repositories/12/pulls/7");
  assert.throws(() => decisionPath("../other", 7));
  assert.throws(() => decisionPath("12", 0));
  const report = decisionMarkdown(pull, { outcome: "eligible", score: 0, reasons: ["Within policy limits."] }, DEFAULT_POLICY, files, destination,
    { repository: "example/project", checks: evidence, policyVersion: 3 });
  assert(report.includes(destination));
  assert(report.includes("example/project #7"));
  assert(report.includes("**Not configured**"));
  assert(report.includes("CI is not required by this policy"));
  assert(report.includes("Documentation-only"));
  assert(report.includes("policy v3"));
  assert(report.includes("automatic merge off"));
});

test("report evidence cannot mistake an untrusted check for a required success", () => {
  const report = decisionMarkdown(pull, { outcome: "waiting", score: 0, reasons: ["Waiting for trusted CI."] }, policy, files, "https://alror.com/app/github",
    { repository: "example/project", checks: [{ ...evidence[0], appId: 999 }], policyVersion: 1 });
  assert(report.includes("| test | App 55 | Not reported |"));
  assert(!report.includes("| test | App 55 | Passed |"));
});

test("report escapes repository content and does not classify renamed code as documentation-only", () => {
  const report = decisionMarkdown({ ...pull, title: "<script> @team [click](https://bad.test)" }, { outcome: "review_required", score: 40, reasons: ["Review required."] }, policy,
    [{ ...files[0], previous_filename: "src/auth.ts" }], "https://alror.com/app/github");
  assert(!report.includes("<script>"));
  assert(!report.includes("@team"));
  assert(!report.includes("Documentation-only"));
});

test("glob matching is anchored and supports root files with **", () => {
  assert(matchesPath("README.md", "**/*.md")); assert(matchesPath("src/a/test.ts", "src/**"));
  assert(!matchesPath("src/a/test.ts", "src/*.ts")); assert(!matchesPath("notdocs/a.md", "docs/**"));
});
test("eligible documentation needs the configured trusted CI producer", () => {
  assert.equal(evaluatePolicy(policy, pull, files, evidence).outcome, "eligible");
  assert.equal(evaluatePolicy(policy, pull, files, [{ ...evidence[0], appId: 999 }]).outcome, "waiting");
  assert.equal(evaluatePolicy(policy, pull, files, [{ ...evidence[0], conclusion: "skipped" }]).outcome, "review_required");
  assert.equal(evaluatePolicy(policy, pull, files, [...evidence, { ...evidence[0], status: "in_progress", conclusion: null }]).outcome, "waiting");
  assert.throws(() => normalizePolicy({ ...policy, requiredChecks: [] }), /trusted CI/);
});
test("protected docs, renamed files, forks, truncation and oversized changes require review", () => {
  for (const input of [
    { p: pull, f: [{ ...files[0], filename: ".github/workflows/readme.md" }] },
    { p: pull, f: [{ ...files[0], previous_filename: "auth/readme.md" }] },
    { p: { ...pull, head: { ...pull.head, repo: { id: 99 } } }, f: files },
    { p: { ...pull, changed_files: 2 }, f: files },
    { p: { ...pull, additions: 500 }, f: files },
  ]) assert.equal(evaluatePolicy(policy, input.p, input.f, evidence).outcome, "review_required");
});
test("removing tests does not satisfy added or updated tests", () => {
  const result = evaluatePolicy({ ...policy, allowedPaths: ["**"] }, { ...pull, changed_files: 2 }, [
    { filename: "src/a.ts", status: "modified", additions: 2, deletions: 1 },
    { filename: "src/a.test.ts", status: "removed", additions: 0, deletions: 10 },
  ], evidence);
  assert(result.reasons.some((r) => r.includes("without added or updated tests")));
});
test("HMAC uses the exact payload and rejects malformed signatures", () => {
  const body = Buffer.from('{"action":"opened"}'), secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert(verifySignature(body, signature, secret)); assert(!verifySignature(Buffer.from("{}"), signature, secret));
  assert(!verifySignature(body, "sha256=00", secret)); assert(!verifySignature(body, signature, ""));
});
test("App JWT has a bounded lifetime and valid RSA signature", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwt = appJwt("42", privateKey.export({ type: "pkcs8", format: "pem" }).toString(), 1_000_000);
  const [header, payload, signature] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iat: 940, exp: 1540, iss: "42" });
  assert(createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, Buffer.from(signature, "base64url")));
});
test("a later comment does not clear a blocking review", () => {
  assert(hasBlockingReview([
    { user: { login: "reviewer" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-01", commit_id: pull.head.sha },
    { user: { login: "reviewer" }, state: "COMMENTED", submitted_at: "2026-10-02", commit_id: pull.head.sha },
  ]));
});

function fixture(opts: { mode?: GatePolicy["mode"]; changeHead?: boolean; finalCiFails?: boolean; blocked?: boolean; sensitive?: boolean; spoofComment?: boolean; denyEffects?: boolean; decisionFails?: boolean; code?: boolean } = {}) {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  let gets = 0, checks = 0;
  const saved: Evaluation[] = [];
  const transport: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url)), path = parsed.pathname, method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    let response: unknown;
    if (path.endsWith("/pulls/7") && method === "GET") {
      gets++; response = { ...pull, mergeable_state: opts.blocked ? "blocked" : "clean", head: { ...pull.head, sha: opts.changeHead && gets > 1 ? "c".repeat(40) : pull.head.sha } };
    } else if (path.endsWith("/pulls/7/commits")) response = [{ commit: { message: "Update docs", author: { name: "Contributor", email: "c@example.com" } }, author: { login: "contributor" } }];
    else if (path.endsWith("/files")) response = opts.sensitive ? [{ ...files[0], filename: ".github/readme.md" }] : opts.code ? [{ filename: "services/checkout/payment.go", status: "modified", additions: 3, deletions: 1 }] : files;
    else if (path.endsWith("/check-runs") && method === "GET") {
      checks++; response = { check_runs: [{ id: 500, name: "test", app: { id: 55 }, status: "completed", conclusion: opts.finalCiFails && checks > 1 ? "failure" : "success" }] };
    } else if (path.endsWith("/check-runs") && method === "POST") response = { id: 123 };
    else if (path.endsWith("/comments") && method === "GET") response = [{ id: 456, body: `${COMMENT_MARKER}\nold`, user: { type: opts.spoofComment ? "User" : "Bot", login: opts.spoofComment ? "attacker" : "alror-platform[bot]" } }];
    else if (path.endsWith("/requested_reviewers") && method === "GET") response = { users: [] };
    else if (path.endsWith("/reviews")) response = [];
    else if (path.endsWith("/merge") && method === "PUT") response = { merged: true, sha: "d".repeat(40) };
    else response = { id: 456 };
    return new Response(JSON.stringify(response), { status: 200 });
  };
  const input = { repositoryId: "12", fullName: "example/project", pullNumber: 7, policy: { ...policy, mode: opts.mode || "auto_merge", reviewers: ["senior"] }, policyVersion: 1, appId: 42, appSlug: "alror-platform", detailsUrl: "https://alror.com/app/github" };
  return { calls, saved, run: () => evaluatePull(new GitHubClient("fake-test-token", transport), input, {
    beforeEffect: async () => { if (opts.denyEffects) throw new Error("Lease or policy changed"); }, save: async (e) => { saved.push(structuredClone(e)); }, audit: async () => {},
    decisionContext: async () => { if (opts.decisionFails) throw new Error("database unavailable"); return { services: [{ name: "checkout-api", paths: ["services/checkout/"], critical: true }], recentRollbacks: { "checkout-api": 9 } }; },
  }) };
}
test("auto-merge updates its sticky comment and pins the evaluated SHA", async () => {
  const f = fixture(); await f.run();
  const merge = f.calls.find((c) => c.path.endsWith("/merge"));
  assert.deepEqual(merge?.body, { sha: pull.head.sha, merge_method: "squash" });
  assert(f.calls.some((c) => c.path.endsWith("/issues/comments/456") && c.method === "PATCH"));
  assert(!f.calls.some((c) => c.method === "POST" && c.path.endsWith("/reviews")));
});
test("observe mode posts evidence but never merges or requests reviewers", async () => {
  const f = fixture({ mode: "observe", sensitive: true }); await f.run();
  assert(!f.calls.some((c) => c.path.endsWith("/merge") || c.path.endsWith("/requested_reviewers")));
  assert.equal(f.calls.find((c) => c.path.endsWith("/check-runs") && c.method === "POST")?.body.conclusion, "neutral");
});
test("sensitive changes request configured reviewers in review mode", async () => {
  const f = fixture({ mode: "review", sensitive: true }); await f.run();
  assert.deepEqual(f.calls.find((c) => c.path.endsWith("/requested_reviewers") && c.method === "POST")?.body, { reviewers: ["senior"] });
  assert(!f.calls.some((c) => c.path.endsWith("/merge")));
});
test("a new commit, failed recheck or GitHub protection prevents automatic merge", async () => {
  const changed = fixture({ changeHead: true }); await assert.rejects(changed.run(), /changed during evaluation/);
  assert(!changed.calls.some((c) => c.path.endsWith("/merge")));
  for (const opts of [{ finalCiFails: true }, { blocked: true }]) {
    const f = fixture(opts); await f.run(); assert(!f.calls.some((c) => c.path.endsWith("/merge")));
  }
});
test("forged sticky markers are not edited and lost leases prevent effects", async () => {
  const f = fixture({ mode: "observe", spoofComment: true }); await f.run();
  assert(f.calls.some((c) => c.path.endsWith("/issues/7/comments") && c.method === "POST"));
  assert(!f.calls.some((c) => c.path.endsWith("/issues/comments/456") && c.method === "PATCH"));
  const lost = fixture({ denyEffects: true }); await assert.rejects(lost.run(), /Lease/);
  assert(lost.calls.every((c) => c.method === "GET"));
});

test("protected paths use the shared sensitive areas plus the policy's globs", () => {
  const open = { ...policy, protectedPaths: [], allowedPaths: ["**"], requireTests: false };
  for (const filename of ["src/crypto/keys.ts", "charts/helm/values.yaml", ".github/workflows/ci.yml", "config/server.pem", "services/ledger/post.go"]) {
    const result = evaluatePolicy(open, pull, [{ ...files[0], filename }], evidence);
    assert.equal(result.outcome, "review_required", filename);
    assert(result.reasons.some((r) => r.startsWith("Protected changes")), filename);
  }
  assert.equal(evaluatePolicy(open, pull, [{ ...files[0], filename: "web/app.tsx" }], evidence).outcome, "eligible");
  const custom = evaluatePolicy({ ...open, protectedPaths: ["web/**"] }, pull, [{ ...files[0], filename: "web/app.tsx" }], evidence);
  assert.equal(custom.outcome, "review_required");
});
test("the gate reports the shared risk score and a high level requires review", () => {
  const risk = { score: 84, level: "high" as const, factors: [], services: [], ai_authored: false };
  const result = evaluatePolicy(policy, pull, files, evidence, risk);
  assert.equal(result.score, 84);
  assert.equal(result.outcome, "review_required");
  assert(result.reasons.some((r) => r.includes("84/100 is high")));
  assert.equal(evaluatePolicy(policy, pull, files, evidence, { ...risk, score: 2, level: "low" }).outcome, "eligible");
});
test("the check and sticky comment show risk score, level, plan and top factors", async () => {
  const f = fixture({ mode: "review", code: true }); await f.run();
  const decision = f.saved.at(-1)?.decision;
  assert.equal(decision?.risk.score, 50);
  assert.equal(decision?.risk.level, "medium");
  assert.equal(decision?.plan.steps.length, 4);
  const check = f.calls.find((c) => c.path.endsWith("/check-runs") && c.method === "POST");
  const summary = String((check?.body.output as { summary: string }).summary);
  assert(summary.includes("**50/100 · medium**"));
  assert(summary.includes("### Top risk factors"));
  assert(summary.includes("| +18 | Recent rollbacks |"));
  assert(summary.includes("canary 5% → 25% → 50% → 100%"));
  const comment = f.calls.find((c) => c.path.endsWith("/issues/comments/456") && c.method === "PATCH");
  assert.equal(comment?.body.body, summary);
});
test("a failed risk decision never merges and keeps the check in progress", async () => {
  for (const mode of ["auto_merge", "observe"] as const) {
    const f = fixture({ mode, decisionFails: true }); const evaluation = await f.run();
    assert(!f.calls.some((c) => c.path.endsWith("/merge")));
    assert.equal(evaluation.result.outcome, "waiting");
    assert.equal(evaluation.result.reasons[0], DECISION_UNAVAILABLE);
    assert.equal(evaluation.decision, undefined);
    const check = f.calls.find((c) => c.path.endsWith("/check-runs") && c.method === "POST");
    assert.equal(check?.body.status, "in_progress");
    assert.equal(check?.body.conclusion, undefined);
    assert.equal((check?.body.output as { title: string }).title, "Risk decision unavailable");
    assert(!JSON.stringify(f.calls).includes("database unavailable"), "internal errors are not posted to GitHub");
  }
});
test("an automatic merge records the merge commit for later deploy lookups", async () => {
  const f = fixture(); const evaluation = await f.run();
  assert.equal(evaluation.pull.merge_commit_sha, "d".repeat(40));
  assert(evaluation.decision, "the merged decision keeps its risk");
});
