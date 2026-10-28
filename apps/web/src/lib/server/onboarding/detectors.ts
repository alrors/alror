import "server-only";
import { parse, parseAllDocuments } from "yaml";
import type { Candidate, TreeEntry } from "./types";

/**
 * Pure detectors: each reads the repository tree (and, where needed, the
 * contents of files chosen by `filesToRead`) and returns candidates with the
 * evidence behind them. Merging candidates into services happens in infer.ts.
 */

/** Directories that never hold deployable services. */
const IGNORED = /(^|\/)(node_modules|vendor|third_party|\.git|testdata|fixtures?|__tests__|tests?|e2e|examples?|samples?|docs?|\.next|dist|build|coverage|\.venv|venv)(\/|$)/;
export const isIgnored = (path: string) => IGNORED.test(path);

export const dirname = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
export const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const normalizeDir = (dir: string) => dir.replace(/^\.\/+/, "").replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/\.$/, "");

/** Joins a relative path to a base directory, rejecting anything that escapes the repository. */
export function joinPath(base: string, rel: string): string | null {
  const parts = (rel.startsWith("/") ? [] : base.split("/").filter(Boolean));
  for (const part of rel.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join("/");
}

const blobs = (tree: TreeEntry[]) => tree.filter((e) => e.type === "blob").map((e) => e.path);
const dirsOf = (tree: TreeEntry[]) => {
  const dirs = new Set<string>();
  for (const path of blobs(tree)) for (let d = dirname(path); d; d = dirname(d)) dirs.add(d);
  return dirs;
};

/** Converts a slug-ish name into a valid service name. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 63);
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

const MANIFEST_DIR = /(^|\/)(k8s|kube|kubernetes|deploy|deployments?|manifests?|charts?|helm|kustomize|overlays|base|argo|rollouts?|infra|ops|\.k8s)(\/|$)/i;
export const isComposeFile = (path: string) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(path);
export const isDockerfile = (path: string) => /(^|\/)(Dockerfile|Containerfile)(\.[\w.-]+)?$|\.Dockerfile$/i.test(basename(path)) || /^(Dockerfile|Containerfile)/.test(basename(path));
const isYaml = (path: string) => /\.ya?ml$/i.test(path);
export const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** Picks the files whose contents the detectors need, smallest set first. */
export function filesToRead(tree: TreeEntry[], limit = 120, maxBytes = 256 * 1024): string[] {
  const wanted: string[] = [];
  const add = (path: string) => { if (!wanted.includes(path)) wanted.push(path); };
  const entries = tree.filter((e) => e.type === "blob" && (e.size ?? 0) <= maxBytes);
  const has = new Set(entries.map((e) => e.path));
  for (const path of ["package.json", "pnpm-workspace.yaml", "go.work", ...CODEOWNERS_PATHS]) if (has.has(path)) add(path);
  for (const e of entries) if (isComposeFile(e.path) && !isIgnored(e.path)) add(e.path);
  for (const e of entries) if (basename(e.path) === "Chart.yaml" && !isIgnored(e.path)) add(e.path);
  for (const e of entries) if (/^kustomization\.ya?ml$/.test(basename(e.path)) && !isIgnored(e.path)) add(e.path);
  // Workspace members' package.json files tell names and whether a member is runnable.
  for (const e of entries) if (basename(e.path) === "package.json" && e.path.split("/").length === 3 && !isIgnored(e.path)) add(e.path);
  for (const e of entries) if (isYaml(e.path) && MANIFEST_DIR.test(dirname(e.path)) && !isIgnored(e.path) && !isComposeFile(e.path)) add(e.path);
  return wanted.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Monorepo workspaces and directory conventions
// ---------------------------------------------------------------------------

const LIBRARY_ROOTS = /^(packages|libs?|shared|common|internal|pkg|tools|scripts|config)\//;

/** Expands `apps/*`, `services/**` style workspace globs against the tree's directories. */
export function expandWorkspaceGlob(pattern: string, dirs: Set<string>): string[] {
  const clean = normalizeDir(pattern.replace(/^!/, ""));
  if (!clean.includes("*")) return dirs.has(clean) ? [clean] : [];
  const re = new RegExp("^" + clean.split("/").map((seg) => seg === "**" ? ".+" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")).join("/") + "$");
  return [...dirs].filter((d) => re.test(d)).sort();
}

function workspacePatterns(files: Record<string, string>): { source: string; patterns: string[] }[] {
  const found: { source: string; patterns: string[] }[] = [];
  if (files["package.json"]) {
    try {
      const pkg = JSON.parse(files["package.json"]) as { workspaces?: string[] | { packages?: string[] } };
      const list = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
      if (Array.isArray(list)) found.push({ source: "package.json", patterns: list.filter((p): p is string => typeof p === "string") });
    } catch { /* invalid JSON: ignored, reported by absence */ }
  }
  if (files["pnpm-workspace.yaml"]) {
    try {
      const doc = parse(files["pnpm-workspace.yaml"]) as { packages?: unknown };
      if (Array.isArray(doc?.packages)) found.push({ source: "pnpm-workspace.yaml", patterns: doc.packages.filter((p): p is string => typeof p === "string") });
    } catch { /* ignored */ }
  }
  if (files["go.work"]) {
    const uses: string[] = [];
    const text = files["go.work"].replace(/\/\/.*$/gm, "");
    for (const m of text.matchAll(/^\s*use\s+([^\s(]+)\s*$/gm)) uses.push(m[1]);
    for (const block of text.matchAll(/use\s*\(([\s\S]*?)\)/g)) for (const line of block[1].split("\n")) if (line.trim()) uses.push(line.trim());
    found.push({ source: "go.work", patterns: uses });
  }
  return found;
}

/** Workspace members from package.json workspaces, pnpm-workspace.yaml and go.work. */
export function detectWorkspaces(tree: TreeEntry[], files: Record<string, string>, notes: string[] = []): Candidate[] {
  const dirs = dirsOf(tree);
  const out: Candidate[] = [];
  for (const { source, patterns } of workspacePatterns(files)) {
    for (const pattern of patterns) {
      if (pattern.startsWith("!")) continue;
      for (const dir of expandWorkspaceGlob(pattern, dirs)) {
        if (!dir || isIgnored(dir)) continue;
        if (LIBRARY_ROOTS.test(dir + "/")) { notes.push(`${dir}: workspace member under a library folder, not proposed as a service.`); continue; }
        let name = basename(dir);
        const pkg = files[`${dir}/package.json`];
        if (pkg) try { const parsed = JSON.parse(pkg) as { name?: string }; if (parsed.name) name = parsed.name; } catch { /* keep folder name */ }
        out.push({ detector: "workspace", dir, name: slug(name), source, confidence: "medium",
          reason: `Workspace member ${dir}/ matched "${pattern}" in ${source}.` });
      }
    }
  }
  return out;
}

const SERVICE_ROOTS = ["services", "apps", "svc", "microservices", "cmd"];
const SERVICE_DIRS = ["web", "frontend", "api", "backend", "server"];

/** `services/*`, `apps/*`, `cmd/*` folders and top-level `web/`, `api/`, `frontend/`... with source files. */
export function detectConventions(tree: TreeEntry[]): Candidate[] {
  const out: Candidate[] = [];
  const dirs = dirsOf(tree);
  const hasFiles = (dir: string) => blobs(tree).some((p) => p.startsWith(dir + "/"));
  for (const dir of [...dirs].sort()) {
    const parts = dir.split("/");
    if (parts.length === 2 && SERVICE_ROOTS.includes(parts[0]) && hasFiles(dir) && !isIgnored(dir)) {
      out.push({ detector: "convention", dir, name: slug(parts[1]), source: `${dir}/`, confidence: parts[0] === "cmd" ? "low" : "medium",
        reason: `${dir}/ follows the ${parts[0]}/<name> layout for deployable units.` });
    } else if (parts.length === 1 && SERVICE_DIRS.includes(parts[0]) && hasFiles(dir)) {
      out.push({ detector: "convention", dir, name: slug(parts[0]), source: `${dir}/`, confidence: "medium",
        reason: `Top-level ${dir}/ folder is a conventional home for a deployable app.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** Each Dockerfile/Containerfile marks the directory that builds an image. */
export function detectDockerfiles(tree: TreeEntry[], repoName: string): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const path of blobs(tree).sort()) {
    if (!isDockerfile(path) || isIgnored(path)) continue;
    let dir = dirname(path);
    // A Dockerfile kept in a docker/ or build/ folder builds its parent.
    if (/^(docker|\.docker|container|images?)$/i.test(basename(dir))) dir = dirname(dir);
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push({ detector: "dockerfile", dir, name: slug(dir ? basename(dir) : repoName), source: path, confidence: "high",
      reason: `${path} builds a container image from ${dir ? dir + "/" : "the repository root"}.` });
  }
  return out;
}

type ComposeService = { build?: string | { context?: string; dockerfile?: string }; image?: string; container_name?: string };

/** docker-compose services with a `build:` section; image-only services are infrastructure. */
export function detectCompose(files: Record<string, string>, notes: string[] = []): Candidate[] {
  const out: Candidate[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!isComposeFile(path)) continue;
    let doc: { services?: Record<string, ComposeService> };
    try { doc = parse(text) ?? {}; } catch { notes.push(`${path}: could not be parsed as YAML.`); continue; }
    if (!doc.services || typeof doc.services !== "object") continue;
    for (const [name, svc] of Object.entries(doc.services)) {
      if (!svc || typeof svc !== "object") continue;
      const context = typeof svc.build === "string" ? svc.build : svc.build?.context;
      if (svc.build === undefined || context === undefined) {
        if (svc.image) notes.push(`${path}: "${name}" runs the prebuilt image ${svc.image}, treated as infrastructure.`);
        continue;
      }
      const dir = joinPath(dirname(path), context);
      if (dir === null) { notes.push(`${path}: "${name}" builds from outside the repository.`); continue; }
      out.push({ detector: "compose", dir: normalizeDir(dir), name: slug(name), source: path, confidence: "high",
        reason: `${path} defines service "${name}" built from ${dir ? dir + "/" : "the repository root"}.` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kubernetes and Helm
// ---------------------------------------------------------------------------

const WORKLOADS = new Set(["Deployment", "StatefulSet", "DaemonSet", "Rollout"]);
type K8sDoc = { apiVersion?: string; kind?: string; metadata?: { name?: string; namespace?: string }; spec?: unknown; namespace?: string };

function images(spec: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    for (const [k, x] of Object.entries(v)) {
      if (k === "image" && typeof x === "string") out.push(x);
      else walk(x, depth + 1);
    }
  };
  walk(spec, 0);
  return out;
}

/** The repository part of an image reference: ghcr.io/acme/checkout:1.2 -> checkout. */
export const imageName = (image: string) => basename(image.replace(/[@:][^/]*$/, ""));

/** Deployments, StatefulSets and Argo Rollouts in plain manifests; namespace from the manifest or a kustomization. */
export function detectKubernetes(files: Record<string, string>, notes: string[] = []): Candidate[] {
  const out: Candidate[] = [];
  const kustomizeNs = new Map<string, string>();
  for (const [path, text] of Object.entries(files)) {
    if (!/^kustomization\.ya?ml$/.test(basename(path))) continue;
    try { const ns = (parse(text) as K8sDoc | null)?.namespace; if (typeof ns === "string") kustomizeNs.set(dirname(path), ns); } catch { /* ignored */ }
  }
  for (const [path, text] of Object.entries(files)) {
    if (!isYaml(path) || isComposeFile(path) || basename(path) === "Chart.yaml" || basename(path) === "pnpm-workspace.yaml") continue;
    if (/(^|\/)templates\//.test(path) && /\{\{/.test(text)) continue; // Helm templates are handled by detectHelm
    let docs: K8sDoc[];
    try { docs = parseAllDocuments(text).map((d) => d.toJS() as K8sDoc); } catch { continue; }
    for (const doc of docs) {
      if (!doc || typeof doc !== "object" || !doc.kind || !WORKLOADS.has(doc.kind)) continue;
      const name = doc.metadata?.name;
      if (typeof name !== "string" || !name) continue;
      const rollout = doc.kind === "Rollout" && String(doc.apiVersion ?? "").startsWith("argoproj.io/");
      if (doc.kind === "Rollout" && !rollout) continue;
      let namespace = typeof doc.metadata?.namespace === "string" ? doc.metadata.namespace : undefined;
      for (let d = dirname(path); !namespace; d = dirname(d)) { namespace = kustomizeNs.get(d); if (!d) break; }
      out.push({
        detector: "kubernetes", dir: null, name: slug(name), source: path, confidence: "high",
        reason: `${path} declares ${rollout ? "an Argo Rollout" : `a ${doc.kind}`} named "${name}"${namespace ? ` in namespace ${namespace}` : ""}.`,
        workload: { kind: doc.kind, name, namespace, rollout, images: images(doc.spec) },
        extraPaths: [path],
      });
    }
  }
  const inspected = Object.keys(files).filter((p) => isYaml(p) && MANIFEST_DIR.test(dirname(p)) && !isComposeFile(p) && basename(p) !== "Chart.yaml");
  if (out.length === 0 && inspected.length) notes.push(`${inspected.slice(0, 3).join(", ")}${inspected.length > 3 ? ` and ${inspected.length - 3} more` : ""}: YAML in deployment folders without a Deployment, StatefulSet or Rollout.`);
  return out;
}

/** Helm charts: one candidate per Chart.yaml; Argo Rollouts are detected from the chart templates. */
export function detectHelm(tree: TreeEntry[], files: Record<string, string>): Candidate[] {
  const out: Candidate[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (basename(path) !== "Chart.yaml") continue;
    let chart: { name?: string; type?: string };
    try { chart = parse(text) ?? {}; } catch { continue; }
    if (chart.type === "library") continue;
    const dir = dirname(path);
    const name = typeof chart.name === "string" && chart.name ? chart.name : basename(dir);
    const templates = Object.entries(files).filter(([p]) => p.startsWith(`${dir}/templates/`));
    const rolloutTemplate = templates.find(([, t]) => /^\s*kind:\s*Rollout\s*$/m.test(t) && /argoproj\.io\//.test(t));
    const hasTemplates = tree.some((e) => e.path.startsWith(`${dir}/templates/`));
    out.push({
      detector: "helm", dir: null, name: slug(name), source: path, confidence: hasTemplates ? "high" : "medium",
      reason: `${path} defines the Helm chart "${name}"${rolloutTemplate ? ` and ${rolloutTemplate[0]} renders an Argo Rollout` : ""}.`,
      workload: { kind: rolloutTemplate ? "Rollout" : "Chart", name, rollout: Boolean(rolloutTemplate), images: [] },
      extraPaths: [dir + "/"],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Owners and criticality
// ---------------------------------------------------------------------------

export type OwnerRule = { pattern: string; owners: string[]; re: RegExp };

function codeownersRegex(pattern: string): RegExp {
  const anchored = pattern.startsWith("/") || pattern.replace(/\/$/, "").slice(1).includes("/");
  const dirOnly = pattern.endsWith("/");
  const segs = pattern.replace(/^\//, "").replace(/\/$/, "").split("/");
  const glob = (seg: string) => seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  let body = "";
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    body += seg === "**" ? (last ? ".*" : "(?:.*/)?") : glob(seg) + (last ? "" : "/");
  });
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}${dirOnly ? "/.*" : "(?:/.*)?"}$`);
}

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "").trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    try { rules.push({ pattern, owners: owners.filter((o) => /^@?[\w.-]+(\/[\w.-]+)?$|^[^@\s]+@[^@\s]+$/.test(o)), re: codeownersRegex(pattern) }); } catch { /* unparseable pattern */ }
  }
  return rules;
}

/** The last matching rule wins, as on GitHub. Matches the directory itself or a file inside it. */
export function ownersFor(rules: OwnerRule[], path: string): { owners: string[]; pattern: string } | null {
  const clean = path.replace(/\/$/, "");
  const probes = clean ? [clean, `${clean}/`, `${clean}/__any__`] : ["__any__"];
  for (let i = rules.length - 1; i >= 0; i--) if (probes.some((p) => rules[i].re.test(p))) return { owners: rules[i].owners, pattern: rules[i].pattern };
  return null;
}

const CRITICAL_HIGH = ["auth", "authn", "authz", "payment", "payments", "pay", "billing", "checkout", "ledger", "wallet", "invoice", "invoicing", "oauth", "identity", "iam", "sso", "login"];
const CRITICAL_MEDIUM = ["gateway", "account", "accounts", "session", "sessions", "order", "orders", "subscription", "subscriptions", "kyc", "fraud", "security", "secrets", "vault"];

/** Critical when a name or path segment is a well-known money or identity word. */
export function criticalFor(name: string, paths: string[]): { critical: boolean; confidence: "high" | "medium" | "low"; reason: string } {
  const words = new Set([name, ...paths].flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  const high = CRITICAL_HIGH.find((w) => words.has(w));
  if (high) return { critical: true, confidence: "high", reason: `"${high}" in the name or paths marks money or identity handling.` };
  const medium = CRITICAL_MEDIUM.find((w) => words.has(w));
  if (medium) return { critical: true, confidence: "medium", reason: `"${medium}" in the name or paths usually sits on a critical path; confirm.` };
  return { critical: false, confidence: "low", reason: "No auth, payments, billing or checkout signal in the name or paths." };
}
