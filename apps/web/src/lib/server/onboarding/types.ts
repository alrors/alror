/**
 * Serializable onboarding contracts shared by the server inference and the console.
 * No secrets or server-only imports belong here.
 */

/** Deployment targets understood by the Go CLI (internal/driver). `kubernetes` drives an Argo Rollout. */
export const TARGETS = ["simulated", "kubernetes", "ecs"] as const;
export type Target = (typeof TARGETS)[number];

/** `unknown` means the value is a placeholder the user must set; it is never a silent guess. */
export type Confidence = "high" | "medium" | "low" | "unknown";

export type Inferred<T> = { value: T; confidence: Confidence; reason: string };

/** One entry of a recursive git tree. Only blobs matter for inference. */
export type TreeEntry = { path: string; type: "blob" | "tree" | "commit"; size?: number; sha?: string };

/** What the detectors read: the tree plus the contents of the files selected by `filesToRead`. */
export type RepoSnapshot = {
  fullName: string;
  defaultBranch: string;
  tree: TreeEntry[];
  files: Record<string, string>;
  truncated?: boolean;
};

export type DetectorName = "workspace" | "convention" | "dockerfile" | "compose" | "kubernetes" | "helm";

/** Evidence one detector found for a deployable unit. */
export type Candidate = {
  detector: DetectorName;
  /** Directory the service's source lives in ("" is the repository root). Null when only a manifest was found. */
  dir: string | null;
  name: string;
  /** Source file that produced this candidate. */
  source: string;
  reason: string;
  confidence: Exclude<Confidence, "unknown">;
  /** Kubernetes/Helm only. */
  workload?: { kind: string; name: string; namespace?: string; rollout: boolean; images: string[] };
  /** Extra path prefixes that belong to the service (manifests, charts). */
  extraPaths?: string[];
};

export type ProposedService = {
  /** Stable key for console edits: the primary path or the manifest that produced it. */
  id: string;
  name: Inferred<string>;
  paths: Inferred<string[]>;
  target: Inferred<Target>;
  namespace: Inferred<string | null>;
  cluster: Inferred<string | null>;
  critical: Inferred<boolean>;
  owners: Inferred<string[]>;
  /** Files that contributed evidence, for the explanation. */
  evidence: string[];
};

export type Proposal = {
  repository: string;
  defaultBranch: string;
  project: Inferred<string>;
  services: ProposedService[];
  metrics: Inferred<"synthetic" | "prometheus" | "datadog">;
  /** Things the detectors saw but deliberately did not turn into services. */
  notes: string[];
  /** The repository already has an alror.yaml at its root. */
  existingConfig: boolean;
  truncated: boolean;
};

/** A service as edited in the console and submitted for the setup PR. */
export type ServiceEdit = {
  id: string;
  include: boolean;
  name: string;
  paths: string[];
  target: Target;
  critical: boolean;
  namespace: string;
  cluster: string;
};

export type SetupPullResult = { url: string; number: number; created: boolean; changed: boolean };
