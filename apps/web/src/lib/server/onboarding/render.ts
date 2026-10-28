import "server-only";
import { z } from "zod";
import { invalid } from "../errors";
import { UNKNOWN } from "./infer";
import { TARGETS, type Inferred, type Proposal, type ServiceEdit, type Target } from "./types";

/** A service ready to render: every field keeps the reason shown in the comments and ALROR.md. */
export type FinalService = {
  name: Inferred<string>;
  paths: Inferred<string[]>;
  target: Inferred<Target>;
  namespace: Inferred<string | null>;
  cluster: Inferred<string | null>;
  critical: Inferred<boolean>;
  owners: Inferred<string[]>;
  evidence: string[];
};

const name = z.string().trim().regex(/^[a-z0-9]([a-z0-9._-]{0,61}[a-z0-9])?$/, "Service names use lowercase letters, digits, dots, dashes and underscores (max 63).");
const repoPath = z.string().trim().max(200).refine((p) => p === "" || (/^[\w.@+\-/ ]+$/.test(p) && !p.startsWith("/") && !p.split("/").includes("..")), "Paths are relative folders inside the repository, such as services/checkout/.");
const label = z.string().trim().max(253).refine((v) => v === "" || /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(v), "Namespaces are lowercase DNS labels.");
const context = z.string().trim().max(200).refine((v) => v === "" || /^[\w.:@/-]+$/.test(v), "Cluster is a kubectl context or ECS cluster name.");

export const serviceEditsSchema = z.array(z.object({
  id: z.string().max(300),
  include: z.boolean(),
  name,
  paths: z.array(repoPath).max(50),
  target: z.enum(TARGETS),
  critical: z.boolean(),
  namespace: label,
  cluster: context,
})).max(100);

const set = <T,>(value: T, detected: Inferred<T> | undefined, actor: string, show: (v: T) => string): Inferred<T> => {
  if (detected && JSON.stringify(detected.value) === JSON.stringify(value)) return detected;
  return { value, confidence: "high", reason: `Set by ${actor} in the Alror console${detected ? ` (detected: ${show(detected.value) || "none"}). ${detected.reason}` : "."}` };
};

/**
 * Applies console edits to a freshly detected proposal. Unedited values keep their
 * detected reasons; edited values say who set them. Edits for services that are no
 * longer detected are treated as added by hand.
 */
export function applyEdits(proposal: Proposal, edits: ServiceEdit[], actor: string): FinalService[] {
  const parsed = serviceEditsSchema.parse(edits);
  const detected = new Map(proposal.services.map((s) => [s.id, s]));
  const out: FinalService[] = [];
  for (const e of parsed) {
    if (!e.include) continue;
    const d = detected.get(e.id);
    const target = set(e.target, d?.target, actor, String);
    const kube = target.value === "kubernetes";
    const namespace: Inferred<string | null> = !kube ? { value: null, confidence: "high", reason: `Not used by the ${target.value} target.` }
      : e.namespace ? set<string | null>(e.namespace, d?.namespace, actor, (v) => v ?? "") : { value: null, confidence: "unknown", reason: d?.target.value === "kubernetes" ? d.namespace.reason : `No namespace given; ${UNKNOWN} (omit to use the kube context default).` };
    const cluster: Inferred<string | null> = target.value === "simulated" ? { value: null, confidence: "high", reason: "Not used by the simulated target." }
      : e.cluster ? set<string | null>(e.cluster, d?.cluster, actor, (v) => v ?? "") : { value: null, confidence: "unknown", reason: `The ${target.value === "kubernetes" ? "kubectl context" : "ECS cluster"} is not stored in the repository; ${UNKNOWN}.` };
    const paths = [...new Set(e.paths.map((p) => (p === "" || p.endsWith("/") || /\.[\w]+$/.test(p) ? p : `${p}/`)))];
    out.push({
      name: set(e.name, d?.name, actor, String),
      paths: paths.length ? set(paths, d?.paths, actor, (v) => v.join(", ")) : { value: [], confidence: "unknown", reason: `No paths; ${UNKNOWN}: changes cannot be attributed to this service until it has paths.` },
      target,
      namespace,
      cluster,
      critical: set(e.critical, d?.critical, actor, (v) => (v ? "critical" : "not critical")),
      owners: d?.owners ?? { value: [], confidence: "unknown", reason: `Added in the console; ${UNKNOWN}.` },
      evidence: d?.evidence ?? [],
    });
  }
  if (out.length === 0) throw new Error("Select at least one service for alror.yaml.");
  const names = out.map((s) => s.name.value);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate) throw new Error(`Two services are named "${duplicate}". Service names must be unique.`);
  return out;
}

/** Turns a detected proposal into final services without edits (used by tests and fixtures). */
export function acceptProposal(proposal: Proposal): FinalService[] {
  return proposal.services.map(({ name, paths, target, namespace, cluster, critical, owners, evidence }) => ({ name, paths, target, namespace, cluster, critical, owners, evidence }));
}

// ---------------------------------------------------------------------------
// alror.yaml
// ---------------------------------------------------------------------------

const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
/** Plain scalar when unambiguous, otherwise a JSON (= YAML double-quoted) string. */
export function scalar(v: string): string {
  return /^[A-Za-z0-9_][\w./-]*$/.test(v) && !RESERVED.test(v) && !/^[\d.+-]+(e[\d+-]+)?$/i.test(v) ? v : JSON.stringify(v);
}
/** Comments never break out of their line. */
const comment = (text: string) => text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const tag = (i: Inferred<unknown>) => (i.confidence === "unknown" ? UNKNOWN : `${i.confidence} confidence`);

export function renderAlrorYaml(project: string, repository: string, services: FinalService[], metricsReason: string): string {
  const lines: string[] = [
    `# Alror configuration proposed by Alror onboarding for ${comment(repository)}.`,
    "# Every value is explained in ALROR.md. Lines marked \"unknown — set this\" need your input.",
    "# Docs: run `alror docs` or see the configuration page.",
    `project: ${scalar(project)}`,
    "services:",
  ];
  for (const s of services) {
    lines.push(`  # ${comment(s.name.value)}: ${comment(s.name.reason)}`);
    lines.push(`  - name: ${scalar(s.name.value)}`);
    lines.push(`    # paths (${tag(s.paths)}): ${comment(s.paths.reason)}`);
    if (s.paths.value.length === 0) lines.push(`    paths: [] # ${UNKNOWN}`);
    else { lines.push("    paths:"); for (const p of s.paths.value) lines.push(`      - ${scalar(p)}`); }
    lines.push(`    # target (${tag(s.target)}): ${comment(s.target.reason)}`);
    lines.push(`    target: ${s.target.value}`);
    if (s.target.value !== "simulated") {
      for (const [field, value] of [["cluster", s.cluster], ["namespace", s.namespace]] as const) {
        if (s.target.value === "ecs" && field === "namespace") continue;
        if (value.value) lines.push(`    ${field}: ${scalar(value.value)} # ${comment(value.reason)}`);
        else lines.push(`    # ${field}: ${UNKNOWN}. ${comment(value.reason.replace(`; ${UNKNOWN}`, ""))}`);
      }
    }
    lines.push(`    critical: ${s.critical.value} # ${comment(s.critical.reason)}`);
    lines.push(s.owners.value.length
      ? `    # owners (from CODEOWNERS, informational): ${comment(s.owners.value.join(" "))}`
      : `    # owners: ${UNKNOWN} in CODEOWNERS (informational, not read by the CLI)`);
  }
  lines.push(
    "metrics:",
    `  # ${UNKNOWN}: ${comment(metricsReason)}`,
    "  provider: synthetic",
    "policy:",
    "  max_regression:",
    "    error_rate: 0.25 # tolerate up to +25% error rate on the canary",
    "    latency_p95: 0.15 # tolerate up to +15% p95 latency on the canary",
    "  alpha: 0.05",
    "  # Shadow mode: Alror recommends rollbacks but never acts. Set to true once you trust its verdicts.",
    "  auto_rollback: false",
    "",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// ALROR.md
// ---------------------------------------------------------------------------

const md = (text: string) => comment(text).replace(/[\\`*_[\]<>|#@]/g, (c) => `\\${c}`);
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

export function renderExplanation(repository: string, project: string, services: FinalService[], metricsReason: string, notes: string[]): string {
  const out: string[] = [
    "# Alror setup",
    "",
    `Alror read ${md(repository)} through its GitHub App and proposed the ${code("alror.yaml")} in this pull request. Review every value below before merging. Nothing is deployed and no traffic is shifted by merging this file.`,
    "",
    `Confidence: **high** comes from an explicit manifest, **medium** from a naming or folder convention, **low** is a weak hint, and **${UNKNOWN}** marks values Alror could not infer and did not guess.`,
    "",
    `Project: ${code(project)} (repository name).`,
    "",
  ];
  const todo: string[] = [];
  for (const s of services) {
    out.push(`## ${code(s.name.value)}`, "", "| Field | Value | Confidence | Why |", "| --- | --- | --- | --- |");
    const rows: [string, Inferred<unknown>, string][] = [
      ["name", s.name, code(s.name.value)],
      ["paths", s.paths, s.paths.value.length ? s.paths.value.map((p) => code(p || "(whole repository)")).join(", ") : "none"],
      ["target", s.target, code(s.target.value)],
      ...(s.target.value !== "simulated" ? [["cluster", s.cluster, s.cluster.value ? code(s.cluster.value) : "not set"], ["namespace", s.namespace, s.namespace.value ? code(s.namespace.value) : "not set"]] as [string, Inferred<unknown>, string][] : []),
      ["critical", s.critical, String(s.critical.value)],
      ["owners", s.owners, s.owners.value.length ? s.owners.value.map(code).join(", ") : "none"],
    ];
    for (const [field, value, shown] of rows) {
      out.push(`| ${field} | ${shown} | ${value.confidence === "unknown" ? `**${UNKNOWN}**` : value.confidence} | ${md(value.reason)} |`);
      if (value.confidence === "unknown" && field !== "owners") todo.push(`${code(s.name.value)} ${field}: ${md(value.reason)}`);
    }
    if (s.evidence.length) out.push("", `Evidence: ${s.evidence.map(code).join(", ")}.`);
    out.push("");
  }
  out.push("## Metrics and policy", "",
    `- ${code("metrics.provider: synthetic")} (**${UNKNOWN}**): ${md(metricsReason)}`,
    `- ${code("policy.max_regression")}: error rate +25% and p95 latency +15%, the documented defaults.`,
    `- ${code("policy.alpha: 0.05")}: significance level for the canary comparison.`,
    `- ${code("policy.auto_rollback: false")}: shadow mode. Alror recommends but never rolls back on its own until you turn it on.`,
    "");
  todo.push(`metrics: ${md(metricsReason)}`);
  out.push("## Needs your input", "", ...todo.map((t) => `- [ ] ${t}`), "");
  if (notes.length) out.push("## Not proposed", "", ...notes.map((n) => `- ${md(n)}`), "");
  out.push("Owners are informational: the CLI does not read them. You can delete this file after merging.", "");
  return out.join("\n");
}

/** Builds alror.yaml and ALROR.md from a fresh detection plus the console edits. Exported for tests. */
export function buildSetupFiles(proposal: Proposal, edits: ServiceEdit[], actor: string) {
  let services;
  try { services = applyEdits(proposal, edits, actor); } catch (e) {
    const issue = (e as { issues?: { message: string }[] }).issues?.[0]?.message;
    throw invalid(issue ?? (e instanceof Error ? e.message : "Invalid services."));
  }
  const yaml = renderAlrorYaml(proposal.project.value, proposal.repository, services, proposal.metrics.reason);
  const explanation = renderExplanation(proposal.repository, proposal.project.value, services, proposal.metrics.reason, proposal.notes);
  const unknowns = services.reduce((n, s) => n + [s.name, s.paths, s.namespace, s.cluster].filter((v) => v.confidence === "unknown").length, 0) + 1;
  return { services, yaml, explanation, unknowns };
}
