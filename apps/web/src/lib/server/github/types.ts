/** Public, serializable GitHub integration contracts. No server secrets belong here. */
export type GateMode = "observe" | "review" | "auto_merge";
export type GatePolicy = {
  mode: GateMode;
  maxChangedLines: number;
  maxChangedFiles: number;
  protectedPaths: string[];
  allowedPaths: string[];
  requiredChecks: { name: string; appId: number }[];
  reviewers: string[];
  requireTests: boolean;
  allowForks: boolean;
  mergeMethod: "squash" | "merge" | "rebase";
};
export const DEFAULT_POLICY: GatePolicy = {
  mode: "observe", maxChangedLines: 200, maxChangedFiles: 15,
  protectedPaths: [".github/**", ".alror/**", "**/auth/**", "**/payments/**", "**/migrations/**", "**/terraform/**", "**/*.pem", "**/.env*"],
  allowedPaths: ["docs/**", "**/*.md", "**/*.mdx"],
  requiredChecks: [], reviewers: [], requireTests: true, allowForks: false, mergeMethod: "squash",
};
export type RepositoryView = {
  id: string; fullName: string; installationId: string; enabled: boolean;
  policy: GatePolicy; updatedAt: string;
};
export type DecisionView = {
  id: string; repositoryId: string; repository: string; pullNumber: number;
  title: string; url: string; headSha: string; outcome: string; score: number;
  reasons: string[]; mode: GateMode; updatedAt: string;
};
export type ChangedFile = { filename: string; previous_filename?: string; additions: number; deletions: number; status: string };
export type CheckEvidence = { name: string; appId: number; status: string; conclusion: string | null };
export type PullSnapshot = {
  number: number; title: string; html_url: string; state: string; draft: boolean; merged: boolean;
  changed_files: number; additions: number; deletions: number;
  head: { sha: string; repo: { id: number } | null };
  base: { sha: string; ref: string; repo: { id: number } };
  user: { login: string }; mergeable: boolean | null; mergeable_state: string;
};
export type GateResult = { outcome: "eligible" | "review_required" | "waiting" | "closed"; score: number; reasons: string[] };
