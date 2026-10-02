import type { GatePolicy, GateResult, PullSnapshot, ChangedFile } from "./types";

export const CHECK_NAME = "Alror / merge gate";
export const COMMENT_MARKER = "<!-- alror:platform:merge-gate -->";
export function markdownText(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>|~]/g, "\\$&").replace(/[\r\n]+/g, " ").replace(/@/g, "＠");
}
export function decisionMarkdown(pull: PullSnapshot, result: GateResult, policy: GatePolicy, files: ChangedFile[], detailsUrl: string): string {
  const heading = result.outcome === "eligible" ? "Policy checks passed" : result.outcome === "review_required" ? "Human review required" : result.outcome === "closed" ? "Pull request closed" : "Waiting for checks";
  const mode = policy.mode === "observe" ? "Observe — Alror reports findings without merging or requesting reviewers." : policy.mode === "review" ? "Review — eligible changes remain available for your team to merge." : "Auto-merge — eligible changes may merge after GitHub protections pass.";
  const paths = files.slice(0, 8).map((f) => markdownText(f.filename)).join(", ");
  return [COMMENT_MARKER, `### Alror · ${heading}`, "", mode, "", `**Change:** ${markdownText(pull.title)}. ${pull.changed_files} files, +${pull.additions} / −${pull.deletions} lines.`,
    paths ? `**Affected files:** ${paths}${files.length > 8 ? ` and ${files.length - 8} more` : ""}.` : "", "",
    `**Rule-based risk:** ${result.score}/100. Evaluated commit: \`${pull.head.sha.slice(0, 12)}\`.`, "", ...result.reasons.map((r) => `- ${markdownText(r)}`), "",
    `**Next step:** ${result.outcome === "review_required" ? "Review the flagged changes and resolve failing requirements. Alror does not substitute for required human approvals." : result.outcome === "waiting" ? "Complete required checks or resolve GitHub's merge restrictions; Alror re-evaluates new events." : result.outcome === "closed" ? "No further merge action is needed." : policy.mode === "auto_merge" ? "Alror will recheck this exact commit before attempting a merge." : "A reviewer can merge when the repository's protections permit it."}`,
    "", `[Open Alror](${detailsUrl})`, "", "<sub>Policy evidence describes changed paths and CI results; it is not a semantic code review.</sub>"].filter((s) => s !== undefined).join("\n");
}
