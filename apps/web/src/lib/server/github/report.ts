import type { GatePolicy, GateResult, PullSnapshot, ChangedFile, CheckEvidence } from "./types";

export const CHECK_NAME = "Alror / merge gate";
export const COMMENT_MARKER = "<!-- alror:platform:merge-gate -->";
export function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>|~]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/@/g, "＠");
}

export function decisionPath(repositoryId: string, pullNumber: number): string {
  if (!/^\d+$/.test(repositoryId) || !Number.isSafeInteger(pullNumber) || pullNumber < 1) throw new Error("Invalid pull request destination.");
  return `/app/github/repositories/${repositoryId}/pulls/${pullNumber}`;
}

type ReportContext = { repository: string; checks: CheckEvidence[]; policyVersion: number };
export function decisionMarkdown(pull: PullSnapshot, result: GateResult, policy: GatePolicy, files: ChangedFile[], detailsUrl: string, context?: ReportContext): string {
  const text = (value: string) => markdownText(value.slice(0, 600));
  const closed = pull.merged || result.outcome === "closed";
  const heading = closed ? (pull.merged ? "Merged" : "Pull request closed") : result.outcome === "eligible" ? "Policy passed" : result.outcome === "review_required" ? "Review needed" : "Evaluation pending";
  const icon = closed ? "◼" : result.outcome === "eligible" ? "✅" : result.outcome === "review_required" ? "⚠️" : "⏳";
  const complete = files.length > 0 && files.length === pull.changed_files;
  const docsOnly = complete && files.every((f) => [f.filename, ...(f.previous_filename ? [f.previous_filename] : [])].every((p) => /\.(md|mdx|txt)$/i.test(p)));
  const mode = policy.mode === "observe" ? "Observe · automatic merge off" : policy.mode === "review" ? "Review · human merge" : "Auto-merge · final checks required";
  const checks = context?.checks || [];
  const required = policy.requiredChecks.map((r) => {
    const matching = checks.filter((c) => c.name === r.name && c.appId === r.appId);
    const status = !matching.length ? "Not reported" : matching.some((c) => c.status !== "completed") ? "Pending" : matching.every((c) => c.conclusion === "success") ? "Passed" : "Not passed";
    return `| ${text(r.name)} | App ${r.appId} | ${status} |`;
  });
  const summary = docsOnly ? "Documentation-only change based on the complete file list. No runtime files changed." : complete ? "Changes span the files listed below. Review the policy findings for the areas needing attention." : "The complete file list is unavailable; inspect the GitHub diff before proceeding.";
  const next = closed ? "No further merge action is needed." : result.outcome === "review_required" ? "Review the flagged paths and unmet requirements below, then push a fix or complete the required review." : result.outcome === "waiting" ? "Wait for the pending requirements below. Alror checks again when GitHub sends new results." : policy.mode === "auto_merge" ? "Alror will recheck this exact commit, trusted CI, and GitHub protections before attempting a merge." : "Review the diff and GitHub checks, then merge manually when repository requirements are satisfied.";
  return [
    COMMENT_MARKER, `## ${icon} Alror · ${heading}`,
    `**${text(context?.repository || "Pull request")} #${pull.number}** — ${text(pull.title)}`, "", `> ${next}`, "",
    "| Assessment | Result |", "| :-- | :-- |",
    `| Policy risk score | **${result.score}/100** · rule-based |`,
    `| Change size | ${pull.changed_files} ${pull.changed_files === 1 ? "file" : "files"} · +${pull.additions} / −${pull.deletions} lines |`,
    `| Automation | ${mode} |`,
    `| Required CI | ${required.length ? `${required.length} checks required by policy` : "**Not configured** · CI is not required by this policy"} |`,
    `| Evaluated revision | \`${pull.head.sha.slice(0, 12)}\` → ${text(pull.base.ref)}${context ? ` · policy v${context.policyVersion}` : ""} |`,
    "", "### What changed", summary, "", "### Policy findings",
    ...result.reasons.slice(0, 12).map((r) => `- ${text(r)}`),
    ...(policy.mode === "observe" ? ["- Observe mode reports findings; it does not request reviewers or merge this PR."] : []),
    ...(required.length ? ["", "### Required checks", "| Check | Trusted issuer | Result |", "| :-- | :-- | :-- |", ...required] : []),
    ...(checks.length ? ["", "<details>", "<summary>CI reported on this commit</summary>", "", "These results are informational unless required by the policy above.", "", "| Check | Issuer | Reported result |", "| :-- | :-- | :-- |", ...checks.slice(0, 12).map((c) => `| ${text(c.name)} | App ${c.appId} | ${text(c.status === "completed" ? c.conclusion || "Unknown" : c.status)} |`), ...(checks.length > 12 ? ["", `${checks.length - 12} more checks are available on GitHub.`] : []), "", "</details>"] : []),
    ...(files.length ? ["", "<details>", `<summary>Changed files (${files.length}${!complete ? " reported" : ""})</summary>`, "", "| File | Change | Lines |", "| :-- | :-- | --: |", ...files.slice(0, 12).map((f) => `| ${text(f.filename)}${f.previous_filename ? ` (from ${text(f.previous_filename)})` : ""} | ${text(f.status)} | +${f.additions} / −${f.deletions} |`), ...(files.length > 12 ? ["", `${files.length - 12} more files are available in the GitHub diff.`] : []), "", "</details>"] : []),
    "", `**[View this PR in Alror →](${detailsUrl})**`, "",
    "<sub>Evaluates file paths, change size, and configured CI requirements. A policy pass is not a code review or a deployment approval. Updated in place for each evaluation.</sub>",
  ].join("\n");
}
