import "server-only";
import {
  basename, CODEOWNERS_PATHS, criticalFor, detectCompose, detectConventions, detectDockerfiles, detectHelm, detectKubernetes,
  detectWorkspaces, dirname, imageName, isIgnored, ownersFor, parseCodeowners, slug,
} from "./detectors";
import type { Candidate, Confidence, Inferred, Proposal, ProposedService, RepoSnapshot, Target } from "./types";

export const UNKNOWN = "unknown — set this";

const RANK: Record<Confidence, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
const best = (values: Confidence[]): Confidence => values.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "unknown" as Confidence);
/** Name comparison key: checkout-api, checkout-svc and checkout all match. */
const key = (name: string) => slug(name).replace(/[-_.](api|svc|service|server|app|deployment|rollout|web|worker)$/, "");

/** Folders whose `<root>/<name>/` or `<root>/<group>/<name>/` subfolders belong to the service called <name>. */
const RELATED_ROOTS = new Set(["migrations", "db", "database", "ml", "deploy", "deployment", "deployments", "infra", "charts", "helm", "k8s", "kubernetes", "manifests", "proto", "protos", "config", "terraform"]);

type Group = { dir: string | null; cands: Candidate[]; manifests: Candidate[]; related: string[] };

export function inferProposal(snapshot: RepoSnapshot): Proposal {
  const { tree, files } = snapshot;
  const repoName = snapshot.fullName.split("/")[1] ?? snapshot.fullName;
  const notes: string[] = [];
  const dirCands = [
    ...detectWorkspaces(tree, files, notes),
    ...detectConventions(tree),
    ...detectDockerfiles(tree, repoName),
    ...detectCompose(files, notes),
  ].filter((c) => c.dir === "" || !isIgnored(c.dir ?? ""));
  const manifests = [...detectKubernetes(files, notes), ...detectHelm(tree, files)];

  // 1. Group source-directory evidence by directory.
  const groups = new Map<string, Group>();
  for (const c of dirCands) {
    const dir = c.dir ?? "";
    const g = groups.get(dir) ?? { dir, cands: [], manifests: [], related: [] };
    g.cands.push(c);
    groups.set(dir, g);
  }
  const root = groups.get("");
  if (root && groups.size > 1) {
    groups.delete("");
    notes.push(`${root.cands.map((c) => c.source).join(", ")} builds from the repository root; not proposed because services were found in subfolders.`);
  }

  // 2. Attach Kubernetes/Helm evidence to the group with the same name or image.
  const keysOf = (g: Group) => new Set([...g.cands.map((c) => key(c.name)), key(basename(g.dir ?? ""))].filter(Boolean));
  const orphans = new Map<string, Group>();
  for (const m of manifests) {
    const mkeys = new Set([key(m.name), ...(m.workload?.images ?? []).map((i) => key(imageName(i)))]);
    const matches = [...groups.values()].filter((g) => [...keysOf(g)].some((k) => mkeys.has(k)));
    const exact = matches.filter((g) => g.cands.some((c) => c.name === m.name) || basename(g.dir ?? "") === m.name);
    const target = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
    if (matches.length > 1 && !target) notes.push(`${m.source}: "${m.name}" matches several folders (${matches.map((g) => g.dir).join(", ")}); kept as its own service.`);
    if (target) { target.manifests.push(m); continue; }
    const g = orphans.get(m.name) ?? { dir: null, cands: [], manifests: [], related: [] };
    g.manifests.push(m);
    orphans.set(m.name, g);
  }

  // 3. Related folders such as migrations/ledger/ or deploy/helm/gateway/.
  const dirs = new Set<string>();
  for (const e of tree) if (e.type === "blob") for (let d = dirname(e.path); d; d = dirname(d)) dirs.add(d);
  const owned = [...groups.values()].map((g) => g.dir).filter((d): d is string => Boolean(d));
  for (const dir of [...dirs].sort()) {
    const parts = dir.split("/");
    if (parts.length < 2 || parts.length > 3 || !RELATED_ROOTS.has(parts[0]) || isIgnored(dir)) continue;
    if (owned.some((o) => dir === o || dir.startsWith(o + "/") || o.startsWith(dir + "/"))) continue;
    const name = key(basename(dir));
    const hit = [...groups.values()].filter((g) => keysOf(g).has(name));
    if (hit.length !== 1) continue;
    const covered = hit[0].manifests.some((m) => (m.extraPaths ?? []).some((p) => (dir + "/").startsWith(p) || p.startsWith(dir + "/")));
    if (!covered) hit[0].related.push(dir + "/");
  }

  const ownerRules = CODEOWNERS_PATHS.map((p) => files[p] ? { path: p, rules: parseCodeowners(files[p]) } : null).find(Boolean) ?? null;

  // 4. Build services.
  const services: ProposedService[] = [];
  for (const g of [...groups.values(), ...orphans.values()]) services.push(buildService(g, ownerRules));
  dedupeNames(services);
  services.sort((a, b) => a.id.localeCompare(b.id));

  const metricHint = Object.entries(files).find(([, t]) => /prom\/prometheus|prometheus-operator|kind:\s*ServiceMonitor/i.test(t))?.[0]
    ?? (Object.entries(files).find(([, t]) => /datadog\/agent|datadoghq/i.test(t))?.[0]);
  if (services.length === 0) notes.push("No deployable services were detected. Add them below before opening the setup pull request.");
  if (snapshot.truncated) notes.push("GitHub truncated the repository tree, so some folders were not inspected.");
  return {
    repository: snapshot.fullName,
    defaultBranch: snapshot.defaultBranch,
    project: { value: slug(repoName) || "project", confidence: "high", reason: `Repository name ${snapshot.fullName}.` },
    services,
    metrics: {
      value: "synthetic", confidence: "unknown",
      reason: metricHint
        ? `${metricHint} references a metrics system, but its URL and queries cannot be read from the repository. Synthetic metrics are proposed until you set provider, url and queries.`
        : "No metrics system found. Synthetic metrics exercise the release loop; set prometheus or datadog with a url and queries for real verification.",
    },
    notes: [...new Set(notes)],
    existingConfig: tree.some((e) => e.type === "blob" && e.path === "alror.yaml"),
    truncated: Boolean(snapshot.truncated),
  };
}

function buildService(g: Group, owners: { path: string; rules: ReturnType<typeof parseCodeowners> } | null): ProposedService {
  const all = [...g.cands, ...g.manifests];
  const rollouts = g.manifests.filter((m) => m.workload?.rollout);
  const workloads = g.manifests.filter((m) => m.workload && m.workload.kind !== "Chart");

  // Name: a Rollout name is authoritative (the kubernetes driver addresses the Rollout by service name).
  let name: Inferred<string>;
  const rolloutNames = [...new Set(rollouts.map((m) => m.workload!.name))];
  if (rolloutNames.length === 1) name = { value: slug(rolloutNames[0]), confidence: "high", reason: `Named after the Argo Rollout "${rolloutNames[0]}" (${rollouts[0].source}); the kubernetes target addresses the Rollout by this name.` };
  else if (rolloutNames.length > 1) name = { value: slug(rolloutNames[0]), confidence: "unknown", reason: `Several Argo Rollouts match (${rolloutNames.join(", ")}); ${UNKNOWN}: the service name must equal the Rollout name.` };
  else {
    const pick = g.cands.find((c) => c.detector === "compose") ?? g.cands.find((c) => c.detector === "workspace") ?? g.cands[0] ?? g.manifests[0];
    name = { value: pick.name, confidence: pick.detector === "compose" || pick.detector === "kubernetes" || pick.detector === "helm" ? "high" : "medium", reason: `Taken from ${pick.detector} evidence in ${pick.source}.` };
  }

  // Paths.
  const extra = [...new Set([...g.manifests.flatMap((m) => m.extraPaths ?? []), ...g.related])].sort();
  let paths: Inferred<string[]>;
  if (g.dir !== null) {
    const primary = g.dir === "" ? "" : `${g.dir}/`;
    const why = [`${primary || "the whole repository (empty prefix)"} from ${[...new Set(g.cands.map((c) => c.detector))].join(", ")} evidence`];
    if (extra.length) why.push(`${extra.join(", ")} also belong to it (deployment, chart or data files)`);
    paths = { value: [primary, ...extra.filter((p) => p !== primary)], confidence: best(g.cands.map((c) => c.confidence)), reason: why.join("; ") + "." };
  } else {
    paths = { value: extra, confidence: "unknown", reason: `Only deployment manifests (${extra.join(", ")}) were found; ${UNKNOWN}: add the folder that holds this service's source.` };
  }

  // Target: kubernetes only when an Argo Rollout exists.
  let target: Inferred<Target>;
  if (rollouts.length) target = { value: "kubernetes", confidence: "high", reason: `${rollouts[0].source} defines an Argo Rollout, which the kubernetes target drives with kubectl argo rollouts.` };
  else if (workloads.length) target = { value: "simulated", confidence: "medium", reason: `${workloads[0].source} is a ${workloads[0].workload!.kind}, not an Argo Rollout. The kubernetes target only drives Argo Rollouts, so simulated is proposed until you convert it.` };
  else target = { value: "simulated", confidence: "medium", reason: "No Argo Rollout manifest found. Simulated runs the release loop without touching infrastructure; switch to kubernetes once an Argo Rollout exists." };

  let namespace: Inferred<string | null>;
  let cluster: Inferred<string | null>;
  if (target.value === "kubernetes") {
    const namespaces = [...new Set(rollouts.map((m) => m.workload!.namespace).filter((n): n is string => Boolean(n)))];
    namespace = namespaces.length === 1
      ? { value: namespaces[0], confidence: "high", reason: `Namespace of the Rollout in ${rollouts.find((m) => m.workload!.namespace)!.source}.` }
      : { value: null, confidence: "unknown", reason: namespaces.length ? `Manifests disagree (${namespaces.join(", ")}); ${UNKNOWN}.` : `The Rollout does not set a namespace; ${UNKNOWN} (omit to use the kube context default).` };
    cluster = { value: null, confidence: "unknown", reason: `The kubectl context is not stored in the repository; ${UNKNOWN} (omit to use the current context).` };
  } else {
    namespace = { value: null, confidence: "high", reason: "Not used by the simulated target." };
    cluster = { value: null, confidence: "high", reason: "Not used by the simulated target." };
  }

  const crit = criticalFor(name.value, paths.value);
  const primaryPath = paths.value[0] ?? "";
  const match = owners && primaryPath !== undefined ? ownersFor(owners.rules, primaryPath) : null;
  const ownersValue: Inferred<string[]> = match && match.owners.length
    ? { value: match.owners, confidence: "high", reason: `${owners!.path} assigns "${match.pattern}" to ${match.owners.join(", ")}.` }
    : { value: [], confidence: "unknown", reason: owners ? `No ${owners.path} rule covers ${primaryPath || "the root"}; ${UNKNOWN}.` : `No CODEOWNERS file; ${UNKNOWN}.` };

  return {
    id: g.dir !== null ? `dir:${g.dir}` : `manifest:${g.manifests[0].name}`,
    name, paths, target, namespace, cluster,
    critical: { value: crit.critical, confidence: crit.confidence, reason: crit.reason },
    owners: ownersValue,
    evidence: [...new Set(all.map((c) => c.source))].sort(),
  };
}

/** Two services may not share a name: prefix with the parent folder and flag both. */
function dedupeNames(services: ProposedService[]) {
  const byName = new Map<string, ProposedService[]>();
  for (const s of services) byName.set(s.name.value, [...(byName.get(s.name.value) ?? []), s]);
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    for (const s of list) {
      const parent = basename(dirname((s.paths.value[0] ?? "").replace(/\/$/, ""))) || "root";
      s.name = { value: slug(`${parent}-${name}`), confidence: "unknown", reason: `${list.length} services are called "${name}"; prefixed with the parent folder. ${UNKNOWN}: pick a unique name.` };
    }
  }
}
