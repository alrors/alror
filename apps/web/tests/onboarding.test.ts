import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { GitHubClient } from "../src/lib/server/github/client";
import {
  criticalFor, detectCompose, detectConventions, detectDockerfiles, detectHelm, detectKubernetes, detectWorkspaces,
  expandWorkspaceGlob, filesToRead, ownersFor, parseCodeowners,
} from "../src/lib/server/onboarding/detectors";
import { missingPermissions, openSetupPull, readRepository, SETUP_BRANCH } from "../src/lib/server/onboarding/github";
import { inferProposal, UNKNOWN } from "../src/lib/server/onboarding/infer";
import { acceptProposal, applyEdits, buildSetupFiles, renderAlrorYaml } from "../src/lib/server/onboarding/render";
import type { Proposal, ServiceEdit, TreeEntry } from "../src/lib/server/onboarding/types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function treeOf(paths: string[]): TreeEntry[] {
  const dirs = new Set<string>();
  for (const p of paths) for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) dirs.add(p.slice(0, i));
  return [...[...dirs].map((path) => ({ path, type: "tree" as const })), ...paths.map((path) => ({ path, type: "blob" as const, size: 100 }))];
}
/** A repository snapshot as readRepository would build it: only the selected files have contents. */
function snapshot(fullName: string, files: Record<string, string>) {
  const tree = treeOf(Object.keys(files));
  const wanted = new Set(filesToRead(tree));
  return { fullName, defaultBranch: "main", tree, files: Object.fromEntries(Object.entries(files).filter(([p]) => wanted.has(p))) };
}
const byName = (p: Proposal) => Object.fromEntries(p.services.map((s) => [s.name.value, s]));
const keep = (p: Proposal): ServiceEdit[] => p.services.map((s) => ({ id: s.id, include: true, name: s.name.value, paths: s.paths.value, target: s.target.value, critical: s.critical.value, namespace: s.namespace.value ?? "", cluster: s.cluster.value ?? "" }));

/** Mirrors the Go schema in internal/config/config.go (the Go test loads the same fixtures with the real loader). */
function assertValidConfig(text: string) {
  const doc = parse(text) as Record<string, unknown>;
  assert.deepEqual(Object.keys(doc).sort(), ["metrics", "policy", "project", "services"]);
  assert.equal(typeof doc.project, "string");
  const services = doc.services as Record<string, unknown>[];
  assert(Array.isArray(services) && services.length > 0, "at least one service");
  const names = new Set<string>();
  for (const s of services) {
    for (const k of Object.keys(s)) assert(["name", "paths", "target", "cluster", "namespace", "critical"].includes(k), `unknown service key ${k}`);
    assert.equal(typeof s.name, "string"); assert(!names.has(s.name as string)); names.add(s.name as string);
    assert(Array.isArray(s.paths) && (s.paths as unknown[]).every((p) => typeof p === "string"));
    assert(["simulated", "kubernetes", "ecs"].includes(s.target as string));
    if ("critical" in s) assert.equal(typeof s.critical, "boolean");
  }
  const metrics = doc.metrics as Record<string, unknown>;
  assert(["synthetic", "prometheus", "datadog"].includes(metrics.provider as string));
  const policy = doc.policy as Record<string, unknown>;
  assert.equal(typeof policy.alpha, "number"); assert.equal(policy.auto_rollback, false);
}

const FIXTURES = resolve(process.cwd(), "../../testdata/onboarding");
/** Golden files shared with the Go loader test (internal/config). UPDATE_GOLDEN=1 rewrites them. */
function golden(name: string, content: string) {
  const file = resolve(FIXTURES, name, "alror.yaml");
  if (process.env.UPDATE_GOLDEN) { mkdirSync(resolve(FIXTURES, name), { recursive: true }); writeFileSync(file, content); return; }
  assert.equal(content, readFileSync(file, "utf8").replace(/\r\n/g, "\n"), `${file} is stale; run with UPDATE_GOLDEN=1`);
}

// Layout of alrors/alror-playground.
const playground = {
  ".github/workflows/alror.yml": "", ".github/workflows/rollback-drill.yml": "", ".gitignore": "", "README.md": "", "TRYME.md": "",
  "alror.yaml": "project: x", "docs/architecture.md": "", "docs/pr-checks.md": "",
  "services/checkout/main.go": "", "services/checkout/payment.go": "", "services/checkout/tests/payment_test.go": "",
  "web/src/app.test.ts": "", "web/src/app.ts": "",
};

// Layout described by examples/alror.yaml in this repository.
const examples: Record<string, string> = {
  "web/src/index.ts": "", "migrations/ledger/001_init.sql": "", "ml/recs/model.py": "",
  "deploy/helm/gateway/Chart.yaml": "apiVersion: v2\nname: gateway\nversion: 0.1.0\n",
  "deploy/helm/gateway/templates/deployment.yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\n",
  ".github/CODEOWNERS": "* @acme/platform\n/services/ledger/ @acme/payments\nservices/auth/ @acme/identity # login\n",
};
for (const s of ["checkout", "search", "notifications", "auth", "pricing", "ledger", "inventory", "recs", "gateway", "billing", "media"]) examples[`services/${s}/main.go`] = "";

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

test("convention detector finds services/* and top-level web/ (playground layout)", () => {
  const found = detectConventions(treeOf(Object.keys(playground)));
  assert.deepEqual(found.map((c) => [c.dir, c.name]), [["services/checkout", "checkout"], ["web", "web"]]);
  assert(found.every((c) => c.reason.length > 0 && c.confidence === "medium"));
});

test("Dockerfile detector maps images to their build folder and skips tests and examples", () => {
  const found = detectDockerfiles(treeOf(["apps/api/Dockerfile", "apps/worker/docker/Dockerfile", "web/Containerfile", "examples/demo/Dockerfile", "test/Dockerfile.e2e", "apps/api/Dockerfile.dev"]), "shop");
  assert.deepEqual(found.map((c) => [c.dir, c.name, c.source]), [
    ["apps/api", "api", "apps/api/Dockerfile"], ["apps/worker", "worker", "apps/worker/docker/Dockerfile"], ["web", "web", "web/Containerfile"],
  ]);
  assert.deepEqual(detectDockerfiles(treeOf(["Dockerfile"]), "Shop").map((c) => [c.dir, c.name]), [["", "shop"]]);
});

test("compose detector keeps built services and reports image-only infrastructure", () => {
  const notes: string[] = [];
  const found = detectCompose({ "deploy/docker-compose.yml": `services:
  api:
    build: ../services/api
  web:
    build: { context: ../web, dockerfile: Dockerfile }
  db:
    image: postgres:16
  evil:
    build: ../../outside
` }, notes);
  assert.deepEqual(found.map((c) => [c.name, c.dir, c.confidence]), [["api", "services/api", "high"], ["web", "web", "high"]]);
  assert(notes.some((n) => n.includes("postgres:16") && n.includes("infrastructure")));
  assert(notes.some((n) => n.includes("outside the repository")));
});

test("kubernetes detector reads Deployments and Argo Rollouts with namespaces from manifests or kustomize", () => {
  const found = detectKubernetes({
    "k8s/checkout.yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Rollout\nmetadata:\n  name: checkout-api\n  namespace: shop\nspec:\n  template:\n    spec:\n      containers:\n        - image: ghcr.io/acme/checkout:1.0\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: checkout-api\n",
    "k8s/overlays/prod/kustomization.yaml": "namespace: prod\nresources: [deploy.yaml]\n",
    "k8s/overlays/prod/deploy.yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: search\n",
    "k8s/broken.yaml": "kind: Rollout\nmetadata:\n  name: not-argo\n",
  });
  assert.deepEqual(found.map((c) => [c.name, c.workload?.kind, c.workload?.rollout, c.workload?.namespace]), [
    ["checkout-api", "Rollout", true, "shop"], ["search", "Deployment", false, "prod"],
  ]);
  assert.deepEqual(found[0].workload?.images, ["ghcr.io/acme/checkout:1.0"]);
});

test("helm detector finds charts and Rollout templates, skipping library charts", () => {
  const files = {
    "charts/payments/Chart.yaml": "name: payments\n", "charts/payments/templates/rollout.yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Rollout\nmetadata:\n  name: {{ .Release.Name }}\n",
    "charts/common/Chart.yaml": "name: common\ntype: library\n",
  };
  const found = detectHelm(treeOf(Object.keys(files)), files);
  assert.deepEqual(found.map((c) => [c.name, c.workload?.rollout, c.extraPaths]), [["payments", true, ["charts/payments/"]]]);
});

test("workspace detector expands npm, pnpm and go.work members and skips library folders", () => {
  const files = {
    "package.json": JSON.stringify({ workspaces: ["apps/*", "packages/*"] }), "apps/web/package.json": JSON.stringify({ name: "@acme/storefront" }),
    "apps/admin/index.ts": "", "packages/ui/index.ts": "", "pnpm-workspace.yaml": "packages:\n  - 'tools/*'\n", "tools/cli/index.ts": "",
    "go.work": "go 1.22\nuse (\n  ./services/orders\n  ./pkg/shared\n)\nuse ./cmd/api // single\n", "services/orders/go.mod": "", "pkg/shared/go.mod": "", "cmd/api/main.go": "",
  };
  const notes: string[] = [];
  const found = detectWorkspaces(treeOf(Object.keys(files)), files, notes);
  assert.deepEqual(found.map((c) => [c.dir, c.name, c.source]).sort(), [
    ["apps/admin", "admin", "package.json"], ["apps/web", "storefront", "package.json"], ["cmd/api", "api", "go.work"], ["services/orders", "orders", "go.work"],
  ]);
  assert(notes.some((n) => n.startsWith("packages/ui")) && notes.some((n) => n.startsWith("tools/cli")) && notes.some((n) => n.startsWith("pkg/shared")));
  assert.deepEqual(expandWorkspaceGlob("services/**", new Set(["services", "services/a", "services/a/b"])), ["services/a", "services/a/b"]);
});

test("CODEOWNERS parsing follows last-match-wins and anchoring", () => {
  const rules = parseCodeowners("# comment\n* @acme/everyone\n/services/ @acme/backend\nservices/payments/ @acme/payments @alice\ndocs/** @acme/docs\n*.md @acme/writers\n");
  assert.deepEqual(ownersFor(rules, "services/payments/")?.owners, ["@acme/payments", "@alice"]);
  assert.deepEqual(ownersFor(rules, "services/search/")?.owners, ["@acme/backend"]);
  assert.deepEqual(ownersFor(rules, "web/")?.owners, ["@acme/everyone"]);
  assert.deepEqual(ownersFor(parseCodeowners("/api/ @a\n"), "apps/api/"), null);
  assert.deepEqual(ownersFor(parseCodeowners("x/api/ @a\n"), "apps/api/"), null, "a slash in the middle anchors the pattern");
  assert.deepEqual(ownersFor(parseCodeowners("api/ @a\n"), "apps/api/")?.owners, ["@a"], "a trailing slash alone matches at any depth");
  assert.deepEqual(ownersFor(parseCodeowners("worker @b\n"), "apps/worker/")?.owners, ["@b"]);
});

test("critical detector flags money and identity names with graded confidence", () => {
  assert.deepEqual([criticalFor("checkout-api", []).critical, criticalFor("checkout-api", []).confidence], [true, "high"]);
  assert.equal(criticalFor("svc", ["services/payments/"]).critical, true);
  assert.deepEqual([criticalFor("api-gateway", []).critical, criticalFor("api-gateway", []).confidence], [true, "medium"]);
  assert.equal(criticalFor("search", ["services/search/"]).critical, false);
  assert.equal(criticalFor("authors", []).critical, false, "matches whole words only");
});

// ---------------------------------------------------------------------------
// Inference end to end
// ---------------------------------------------------------------------------

test("playground layout: checkout (critical) and web, simulated, existing config flagged", () => {
  const proposal = inferProposal(snapshot("alrors/alror-playground", playground));
  const s = byName(proposal);
  assert.deepEqual(Object.keys(s), ["checkout", "web"]);
  assert.deepEqual(s.checkout.paths.value, ["services/checkout/"]);
  assert.equal(s.checkout.critical.value, true);
  assert.equal(s.web.critical.value, false);
  assert(proposal.services.every((x) => x.target.value === "simulated" && /No Argo Rollout/.test(x.target.reason)));
  assert.equal(proposal.existingConfig, true);
  assert.equal(proposal.project.value, "alror-playground");
  assert.equal(proposal.metrics.confidence, "unknown");
  const { yaml } = buildSetupFiles(proposal, keep(proposal), "owner@example.com");
  assertValidConfig(yaml);
  golden("playground", yaml);
});

test("examples layout: every service, related folders and critical set match examples/alror.yaml", () => {
  const proposal = inferProposal(snapshot("acme/demo", examples));
  const s = byName(proposal);
  assert.deepEqual(Object.keys(s).sort(), ["auth", "billing", "checkout", "gateway", "inventory", "ledger", "media", "notifications", "pricing", "recs", "search", "web"]);
  assert.deepEqual(s.ledger.paths.value, ["services/ledger/", "migrations/ledger/"]);
  assert.deepEqual(s.recs.paths.value, ["services/recs/", "ml/recs/"]);
  assert.deepEqual(s.gateway.paths.value, ["services/gateway/", "deploy/helm/gateway/"]);
  assert.equal(s.gateway.target.value, "simulated", "a chart without a Rollout is not a kubernetes target");
  assert.deepEqual(proposal.services.filter((x) => x.critical.value).map((x) => x.name.value).sort(), ["auth", "billing", "checkout", "gateway", "ledger"]);
  assert.deepEqual(s.ledger.owners.value, ["@acme/payments"]);
  assert.deepEqual(s.auth.owners.value, ["@acme/identity"]);
  assert.deepEqual(s.search.owners.value, ["@acme/platform"]);
  const { yaml, explanation } = buildSetupFiles(proposal, keep(proposal), "owner@example.com");
  assertValidConfig(yaml);
  golden("examples", yaml);
  assert(explanation.includes("## `ledger`") && explanation.includes("migrations/ledger/"));
});

test("Argo Rollout makes a kubernetes target named after the Rollout; namespace and cluster stay explicit", () => {
  const files = {
    "services/checkout/Dockerfile": "", "services/search/Dockerfile": "",
    "deploy/k8s/checkout.yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Rollout\nmetadata:\n  name: checkout-api\n  namespace: shop\nspec: {}\n",
    "deploy/k8s/search.yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: search\n",
    "deploy/k8s/mailer.yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Rollout\nmetadata:\n  name: mailer\n",
  };
  const proposal = inferProposal(snapshot("acme/shop", files));
  const s = byName(proposal);
  assert.equal(s["checkout-api"].target.value, "kubernetes");
  assert.equal(s["checkout-api"].name.confidence, "high");
  assert.deepEqual(s["checkout-api"].paths.value, ["services/checkout/", "deploy/k8s/checkout.yaml"]);
  assert.equal(s["checkout-api"].namespace.value, "shop");
  assert.equal(s["checkout-api"].cluster.confidence, "unknown");
  assert.equal(s.search.target.value, "simulated");
  assert.match(s.search.target.reason, /Deployment, not an Argo Rollout/);
  // A Rollout without a source folder: paths and namespace are unknown, never guessed.
  assert.equal(s.mailer.paths.confidence, "unknown");
  assert.equal(s.mailer.namespace.confidence, "unknown");
  const { yaml } = buildSetupFiles(proposal, keep(proposal), "owner@example.com");
  assertValidConfig(yaml);
  assert.match(yaml, /namespace: shop/);
  assert.match(yaml, new RegExp(`# cluster: ${UNKNOWN}`));
  assert.match(yaml, new RegExp(`# namespace: ${UNKNOWN}`));
  golden("kubernetes", yaml);
});

test("compose, workspaces and a helm Rollout merge into one service per folder", () => {
  const files = {
    "package.json": JSON.stringify({ workspaces: ["apps/*"] }), "apps/storefront/package.json": "{}", "apps/storefront/Dockerfile": "",
    "apps/payments/Dockerfile": "",
    "docker-compose.yml": "services:\n  storefront:\n    build: ./apps/storefront\n  redis:\n    image: redis:7\n",
    "charts/payments/Chart.yaml": "name: payments\n", "charts/payments/templates/rollout.yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Rollout\n",
  };
  const proposal = inferProposal(snapshot("acme/mono", files));
  const s = byName(proposal);
  assert.deepEqual(Object.keys(s).sort(), ["payments", "storefront"]);
  assert.deepEqual(s.storefront.evidence, ["apps/storefront/", "apps/storefront/Dockerfile", "docker-compose.yml", "package.json"]);
  assert.equal(s.storefront.name.confidence, "high");
  assert.equal(s.payments.target.value, "kubernetes");
  assert.deepEqual(s.payments.paths.value, ["apps/payments/", "charts/payments/"]);
  assert.equal(s.payments.critical.value, true);
  assert(proposal.notes.some((n) => n.includes("redis:7")));
});

test("ambiguous names are flagged unknown instead of silently picked", () => {
  const proposal = inferProposal(snapshot("acme/dup", { "apps/api/Dockerfile": "", "services/api/Dockerfile": "" }));
  assert.deepEqual(proposal.services.map((s) => [s.name.value, s.name.confidence]), [["apps-api", "unknown"], ["services-api", "unknown"]]);
});

test("a single root Dockerfile is one service covering the repository", () => {
  const proposal = inferProposal(snapshot("acme/Single", { Dockerfile: "", "src/index.ts": "" }));
  assert.deepEqual(proposal.services.map((s) => [s.name.value, s.paths.value]), [["single", [""]]]);
  assertValidConfig(buildSetupFiles(proposal, keep(proposal), "x").yaml);
  const empty = inferProposal(snapshot("acme/empty", { "README.md": "" }));
  assert.equal(empty.services.length, 0);
  assert(empty.notes.some((n) => n.includes("No deployable services")));
});

// ---------------------------------------------------------------------------
// Edits and rendering
// ---------------------------------------------------------------------------

test("console edits rename, exclude and add services, and record who set each value", () => {
  const proposal = inferProposal(snapshot("alrors/alror-playground", playground));
  const edits = keep(proposal);
  edits[0] = { ...edits[0], name: "checkout-api", target: "kubernetes", namespace: "", cluster: "prod-eu" };
  edits[1] = { ...edits[1], include: false };
  edits.push({ id: "new:1", include: true, name: "docs-site", paths: ["docs"], target: "simulated", critical: false, namespace: "", cluster: "" });
  const services = applyEdits(proposal, edits, "owner@example.com");
  assert.deepEqual(services.map((s) => s.name.value), ["checkout-api", "docs-site"]);
  assert.match(services[0].name.reason, /Set by owner@example.com/);
  assert.equal(services[0].paths.reason, proposal.services[0].paths.reason, "unedited values keep detected reasons");
  assert.equal(services[0].namespace.confidence, "unknown");
  assert.equal(services[0].cluster.value, "prod-eu");
  assert.deepEqual(services[1].paths.value, ["docs/"]);
  const yaml = renderAlrorYaml("p", "alrors/alror-playground", services, proposal.metrics.reason);
  assertValidConfig(yaml);
  assert.match(yaml, /cluster: prod-eu/);
  assert.throws(() => applyEdits(proposal, [{ ...edits[0], name: "Bad Name" }], "x"));
  assert.throws(() => applyEdits(proposal, [{ ...edits[0], paths: ["../etc/"] }], "x"));
  assert.throws(() => applyEdits(proposal, [edits[0], { ...edits[2], name: "checkout-api" }], "x"), /unique/);
  assert.throws(() => applyEdits(proposal, [{ ...edits[0], include: false }], "x"), /at least one/);
});

test("rendering cannot be broken by hostile names or reasons", () => {
  const proposal = inferProposal(snapshot("acme/x", { "services/yes/main.go": "", "services/007/main.go": "" }));
  const services = acceptProposal(proposal);
  services[0].critical = { ...services[0].critical, reason: "line one\nproject: hacked" };
  const yaml = renderAlrorYaml("x", "acme/x", services, "m");
  const doc = parse(yaml);
  assert.equal(doc.project, "x");
  assert.deepEqual(doc.services.map((s: { name: string }) => s.name), ["007", "yes"]);
});

// ---------------------------------------------------------------------------
// GitHub: reading and the setup pull request, against an in-memory fake
// ---------------------------------------------------------------------------

type Call = { method: string; path: string; body?: Record<string, unknown> };
function fakeGitHub(initial: Record<string, string>, opts: { branchWithoutPr?: boolean } = {}) {
  const hash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex");
  const trees = new Map<string, Record<string, string>>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const putTree = (files: Record<string, string>) => { const sorted = Object.fromEntries(Object.entries(files).sort()); const sha = hash(sorted); trees.set(sha, sorted); return sha; };
  const rootTree = putTree(initial);
  const rootCommit = hash({ tree: rootTree, parents: [] });
  commits.set(rootCommit, { tree: rootTree, parents: [] });
  const refs = new Map<string, string>([["main", rootCommit]]);
  if (opts.branchWithoutPr) refs.set(SETUP_BRANCH, rootCommit);
  const pulls: { number: number; head: string; state: string; title: string; body: string }[] = [];
  const calls: Call[] = [];
  const json = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const transport = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = u.pathname.replace("/repos/acme/shop", "");
    calls.push({ method, path: path + u.search, body });
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "") return json(200, { default_branch: "main" });
    if (method === "GET" && (m = path.match(/^\/git\/ref\/heads\/(.+)$/))) { const sha = refs.get(m[1]); return sha ? json(200, { object: { sha } }) : json(404); }
    if (method === "GET" && (m = path.match(/^\/git\/commits\/(\w+)$/))) { const c = commits.get(m[1]); return c ? json(200, { tree: { sha: c.tree } }) : json(404); }
    if (method === "GET" && (m = path.match(/^\/git\/trees\/(\w+)$/))) {
      const files = trees.get(commits.get(m[1])!.tree)!;
      return json(200, { truncated: false, tree: Object.keys(files).map((p) => ({ path: p, type: "blob", size: files[p].length, sha: hash(files[p]) })) });
    }
    if (method === "GET" && (m = path.match(/^\/git\/blobs\/(\w+)$/))) {
      const all = [...trees.values()].flatMap((t) => Object.values(t));
      const content = all.find((c) => hash(c) === m![1]);
      return content === undefined ? json(404) : json(200, { encoding: "base64", content: Buffer.from(content).toString("base64") });
    }
    if (method === "POST" && path === "/git/trees") {
      const base = { ...trees.get(body.base_tree)! };
      for (const e of body.tree) base[e.path] = e.content;
      return json(201, { sha: putTree(base) });
    }
    if (method === "POST" && path === "/git/commits") { const sha = hash({ ...body, n: commits.size }); commits.set(sha, { tree: body.tree, parents: body.parents }); return json(201, { sha }); }
    if (method === "POST" && path === "/git/refs") { refs.set(body.ref.replace("refs/heads/", ""), body.sha); return json(201, {}); }
    if (method === "PATCH" && (m = path.match(/^\/git\/refs\/heads\/(.+)$/))) {
      const current = refs.get(m[1])!;
      let ancestor = false;
      for (const stack = [body.sha]; stack.length;) { const s = stack.pop()!; if (s === current) { ancestor = true; break; } stack.push(...(commits.get(s)?.parents ?? [])); }
      if (!ancestor && !body.force) return json(422);
      refs.set(m[1], body.sha); return json(200, {});
    }
    if (method === "GET" && path === "/pulls") {
      const head = u.searchParams.get("head");
      return json(200, pulls.filter((p) => p.state === "open" && `acme:${p.head}` === head).map((p) => ({ number: p.number, html_url: `https://github.com/acme/shop/pull/${p.number}` })));
    }
    if (method === "POST" && path === "/pulls") { const p = { number: pulls.length + 1, head: body.head, state: "open", title: body.title, body: body.body }; pulls.push(p); return json(201, { number: p.number, html_url: `https://github.com/acme/shop/pull/${p.number}` }); }
    if (method === "PATCH" && (m = path.match(/^\/pulls\/(\d+)$/))) { Object.assign(pulls[Number(m[1]) - 1], body); return json(200, {}); }
    return json(500, { message: `unhandled ${method} ${path}` });
  }) as typeof fetch;
  const fileAt = (branch: string, path: string) => trees.get(commits.get(refs.get(branch)!)!.tree)![path];
  return { client: new GitHubClient("token", transport), calls, refs, pulls, commits, fileAt };
}

const writesDefault = (calls: Call[]) => calls.some((c) => c.method !== "GET" && (/\/git\/refs\/heads\/main$/.test(c.path) || (c.path === "/git/refs" && c.body?.ref === "refs/heads/main")));

test("readRepository fetches only the files the detectors need", async () => {
  const gh = fakeGitHub({ "services/checkout/main.go": "package main", "package.json": "{}", ".github/CODEOWNERS": "* @acme/x" });
  const snap = await readRepository(gh.client, "acme/shop");
  assert.equal(snap.defaultBranch, "main");
  assert.deepEqual(Object.keys(snap.files).sort(), [".github/CODEOWNERS", "package.json"]);
  assert.equal(snap.files[".github/CODEOWNERS"], "* @acme/x");
  assert(!gh.calls.some((c) => c.method !== "GET"));
});

test("setup PR: opened on alror/setup, idempotent on rerun, updated in place, never writes main", async () => {
  const gh = fakeGitHub({ "README.md": "hi" });
  const files = [{ path: "alror.yaml", content: "project: shop\n" }, { path: "ALROR.md", content: "# Alror setup\n" }];
  const mainBefore = gh.refs.get("main");

  const first = await openSetupPull(gh.client, "acme/shop", files, "body");
  assert.deepEqual([first.number, first.created, first.changed], [1, true, true]);
  assert.equal(gh.fileAt(SETUP_BRANCH, "alror.yaml"), "project: shop\n");
  assert.equal(gh.pulls[0].head, SETUP_BRANCH);

  const commitsBefore = gh.commits.size;
  const again = await openSetupPull(gh.client, "acme/shop", files, "body 2");
  assert.deepEqual([again.number, again.created, again.changed], [1, false, false]);
  assert.equal(gh.commits.size, commitsBefore, "no new commit for identical content");
  assert.equal(gh.pulls.length, 1);
  assert.equal(gh.pulls[0].body, "body 2");

  const branchHead = gh.refs.get(SETUP_BRANCH)!;
  const updated = await openSetupPull(gh.client, "acme/shop", [{ path: "alror.yaml", content: "project: shop2\n" }], "body 3");
  assert.deepEqual([updated.number, updated.created, updated.changed], [1, false, true]);
  assert.equal(gh.fileAt(SETUP_BRANCH, "alror.yaml"), "project: shop2\n");
  assert.deepEqual(gh.commits.get(gh.refs.get(SETUP_BRANCH)!)!.parents, [branchHead], "builds on the open PR branch");
  assert(gh.calls.filter((c) => c.method === "PATCH" && c.path.startsWith("/git/refs/")).every((c) => c.body?.force === false));

  assert.equal(gh.refs.get("main"), mainBefore);
  assert(!writesDefault(gh.calls));
});

test("setup PR: a stale alror/setup branch without an open PR restarts from main", async () => {
  const gh = fakeGitHub({ "README.md": "hi" }, { branchWithoutPr: true });
  const result = await openSetupPull(gh.client, "acme/shop", [{ path: "alror.yaml", content: "project: shop\n" }], "body");
  assert.equal(result.created, true);
  assert.deepEqual(gh.commits.get(gh.refs.get(SETUP_BRANCH)!)!.parents, [gh.refs.get("main")]);
  assert(!writesDefault(gh.calls));
  await assert.rejects(openSetupPull(fakeGitHub({ "alror.yaml": "x" }).client, "acme/shop", [{ path: "alror.yaml", content: "x" }], "b"), /nothing to propose/);
});

test("missing App permissions are listed by name", () => {
  assert.deepEqual(missingPermissions({ contents: "write", pull_requests: "write", metadata: "read" }), []);
  const missing = missingPermissions({ contents: "read", metadata: "read" });
  assert.equal(missing.length, 2);
  assert.match(missing[0], /Repository contents: Read and write/);
  assert.match(missing[1], /Pull requests: Read and write/);
});
