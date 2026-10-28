import "server-only";
import { ApiError, conflict } from "../errors";
import { GitHubError, repoPath } from "../github/client";
import { filesToRead } from "./detectors";
import type { RepoSnapshot, SetupPullResult, TreeEntry } from "./types";

/** The only branch onboarding ever writes. It is never the default branch. */
export const SETUP_BRANCH = "alror/setup";
export const SETUP_TITLE = "Set up Alror (alror.yaml)";

/** Anything that can make authenticated GitHub REST calls (GitHubClient, or a fake in tests). */
export type Requester = { request<T>(path: string, method?: string, body?: unknown): Promise<T> };

/** GitHub App permissions onboarding relies on, with the labels GitHub's settings page uses. */
export const REQUIRED_PERMISSIONS = [
  { key: "contents", level: "write", label: "Repository contents: Read and write", why: "read the repository tree and commit alror.yaml to the alror/setup branch" },
  { key: "pull_requests", level: "write", label: "Pull requests: Read and write", why: "open and update the setup pull request" },
  { key: "metadata", level: "read", label: "Metadata: Read-only", why: "find the default branch" },
] as const;

export class OnboardingPermissionError extends ApiError {
  constructor(public missing: string[], repository: string) {
    super(403, "forbidden", `The Alror GitHub App cannot open the setup pull request on ${repository}. It needs ${missing.join("; ")}. ` +
      "Grant these in the GitHub App settings under Permissions, then approve the updated permissions on the installation and try again.");
  }
}

/** Lists the required permissions the installation lacks (write satisfies read). */
export function missingPermissions(granted: Record<string, string | undefined>): string[] {
  return REQUIRED_PERMISSIONS.filter((p) => {
    const level = granted[p.key];
    return !(level === "write" || level === "admin" || (p.level === "read" && level === "read"));
  }).map((p) => `${p.label} (to ${p.why})`);
}

const refPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

async function maybe<T>(work: Promise<T>): Promise<T | null> {
  try { return await work; } catch (e) { if (e instanceof GitHubError && e.status === 404) return null; throw e; }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Reads the default branch tree and the files the detectors need, through the installation token. */
export async function readRepository(client: Requester, fullName: string): Promise<RepoSnapshot> {
  const base = repoPath(fullName);
  const repo = await client.request<{ default_branch: string }>(base);
  const ref = await client.request<{ object: { sha: string } }>(`${base}/git/ref/heads/${refPath(repo.default_branch)}`);
  const tree = await client.request<{ tree: TreeEntry[]; truncated: boolean }>(`${base}/git/trees/${ref.object.sha}?recursive=1`);
  const entries = tree.tree.filter((e) => e.type === "blob" || e.type === "tree");
  const wanted = filesToRead(entries);
  const shaOf = new Map(entries.map((e) => [e.path, e.sha]));
  const files: Record<string, string> = {};
  await mapLimit(wanted, 8, async (path) => {
    const sha = shaOf.get(path);
    if (!sha) return;
    const blob = await client.request<{ content: string; encoding: string }>(`${base}/git/blobs/${sha}`);
    files[path] = blob.encoding === "base64" ? Buffer.from(blob.content, "base64").toString("utf8") : blob.content;
  });
  return { fullName, defaultBranch: repo.default_branch, tree: entries, files, truncated: tree.truncated };
}

type Pull = { number: number; html_url: string };

/**
 * Commits the files to `alror/setup` and opens (or updates) the single onboarding
 * pull request. Never writes the default branch. Idempotent: rerunning with the same
 * content makes no commit and reuses the open pull request; rerunning with new content
 * adds one commit on top of the open pull request's branch, keeping any edits pushed there.
 */
export async function openSetupPull(client: Requester, fullName: string, files: { path: string; content: string }[], body: string, message = "Add alror.yaml proposed by Alror onboarding"): Promise<SetupPullResult> {
  const base = repoPath(fullName);
  const owner = fullName.split("/")[0];
  const repo = await client.request<{ default_branch: string }>(base);
  if (repo.default_branch === SETUP_BRANCH) throw conflict(`The default branch is ${SETUP_BRANCH}; Alror will not write to a default branch.`);
  const defaultHead = await client.request<{ object: { sha: string } }>(`${base}/git/ref/heads/${refPath(repo.default_branch)}`);
  const branch = await maybe(client.request<{ object: { sha: string } }>(`${base}/git/ref/heads/${refPath(SETUP_BRANCH)}`));
  const open = (await client.request<Pull[]>(`${base}/pulls?state=open&head=${encodeURIComponent(`${owner}:${SETUP_BRANCH}`)}&per_page=10`))[0] ?? null;

  // Keep work on an open onboarding PR; otherwise start again from the default branch.
  const parent = branch && open ? branch.object.sha : defaultHead.object.sha;
  const parentCommit = await client.request<{ tree: { sha: string } }>(`${base}/git/commits/${parent}`);
  const tree = await client.request<{ sha: string }>(`${base}/git/trees`, "POST", {
    base_tree: parentCommit.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.content })),
  });
  const changed = tree.sha !== parentCommit.tree.sha;
  if (!changed && !open) throw conflict(`${repo.default_branch} already contains this alror.yaml and ALROR.md; there is nothing to propose.`);
  const head = changed ?(await client.request<{ sha: string }>(`${base}/git/commits`, "POST", { message, tree: tree.sha, parents: [parent] })).sha : parent;

  if (!branch) await client.request(`${base}/git/refs`, "POST", { ref: `refs/heads/${SETUP_BRANCH}`, sha: head });
  else if (branch.object.sha !== head) await client.request(`${base}/git/refs/heads/${refPath(SETUP_BRANCH)}`, "PATCH", { sha: head, force: !open });

  if (open) {
    await client.request(`${base}/pulls/${open.number}`, "PATCH", { title: SETUP_TITLE, body });
    return { url: open.html_url, number: open.number, created: false, changed };
  }
  try {
    const pull = await client.request<Pull>(`${base}/pulls`, "POST", { title: SETUP_TITLE, head: SETUP_BRANCH, base: repo.default_branch, body, maintainer_can_modify: false });
    return { url: pull.html_url, number: pull.number, created: true, changed };
  } catch (e) {
    // A concurrent run opened it first: reuse that pull request instead of failing.
    if (!(e instanceof GitHubError && e.status === 422)) throw e;
    const raced = (await client.request<Pull[]>(`${base}/pulls?state=open&head=${encodeURIComponent(`${owner}:${SETUP_BRANCH}`)}&per_page=10`))[0];
    if (!raced) throw e;
    return { url: raced.html_url, number: raced.number, created: false, changed };
  }
}

export function setupPullBody(repository: string, services: string[], unknowns: number, actor: string): string {
  const safe = (s: string) => s.replace(/[`*_[\]<>|#@\\]/g, (c) => `\\${c}`);
  return [
    `Alror read ${safe(repository)} and proposes an \`alror.yaml\` with ${services.length} service${services.length === 1 ? "" : "s"}: ${services.map((s) => `\`${s}\``).join(", ")}.`,
    "",
    `\`ALROR.md\` explains every value and where it came from. ${unknowns ? `${unknowns} value${unknowns === 1 ? " is" : "s are"} marked **unknown — set this**; fill them in before merging.` : "No values are marked unknown."}`,
    "",
    "Merging this pull request deploys nothing. Verification starts in shadow mode (`auto_rollback: false`).",
    "",
    `Requested by ${safe(actor)} in the Alror console. Re-running setup updates this pull request instead of opening another.`,
  ].join("\n");
}
