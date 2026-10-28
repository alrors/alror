// The Slack message posted for a new incident (incoming webhook, mrkdwn). Pure.

import type { AutoDecision, RankedCandidate } from "./rank";

export type SlackIncident = {
  id: string;
  title: string;
  service: string;
  environment: string;
  severity: string;
  source: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const reasons = (c: RankedCandidate) =>
  c.signals
    .filter((s) => s.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 3)
    .map((s) => s.detail.charAt(0).toLowerCase() + s.detail.slice(1))
    .join("; ");

/** Text plus Block Kit blocks: the alert, the top three candidates with reasons, and a link to the incident page. */
export function slackIncidentMessage(
  inc: SlackIncident,
  candidates: RankedCandidate[],
  urls: { incident: string; deployment: (id: string) => string },
  auto?: (AutoDecision & { job_id?: string | null }) | null,
): { text: string; blocks: unknown[] } {
  const where = [inc.service, inc.environment].filter(Boolean).join(" · ");
  const head = `${inc.severity === "critical" ? ":rotating_light:" : ":warning:"} *${esc(inc.title)}*${where ? `  (${esc(where)})` : ""}`;
  const top = candidates.slice(0, 3);
  const list = top.length
    ? top
        .map(
          (c, i) =>
            `${i + 1}. <${urls.deployment(c.deployment_id)}|${esc(c.deployment_id)}> ${esc(c.service)} \`${esc(c.image)}\`: *${c.score}/100*\n      ${esc(reasons(c))}`,
        )
        .join("\n")
    : "No deployments in the look-back window.";
  const autoLine =
    auto?.rollback && auto.deployment_id
      ? `:leftwards_arrow_with_hook: Alror queued an automatic rollback of ${esc(auto.deployment_id)}${auto.job_id ? ` (job ${esc(auto.job_id.slice(0, 8))})` : ""}.`
      : null;
  const text = `${head}\nWhat changed? ${top.length ? `Top candidate: ${top[0].deployment_id} (${top[0].score}/100)` : "No recent deployments"}. ${urls.incident}`;
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `${head}\nSeverity ${esc(inc.severity)} · from ${esc(inc.source)}` } },
    { type: "section", text: { type: "mrkdwn", text: `*What changed?*\n${list}` } },
    ...(autoLine ? [{ type: "section", text: { type: "mrkdwn", text: autoLine } }] : []),
    {
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: top.length && !autoLine ? "Review and roll back" : "Open incident" }, url: urls.incident }],
    },
  ];
  return { text, blocks };
}
