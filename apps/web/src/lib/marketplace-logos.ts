// Original-colour brand logos for marketplace plugins, served from public/integrations
// (gilbarbara/logos, CC0; see public/integrations/LICENSE.md). Plugins not listed here
// (Alror's own synthetic and simulated plugins, feature flags) keep their icon.

const LOGOS: Record<string, string> = {
  prometheus: "/integrations/prometheus.svg",
  datadog: "/integrations/datadog.svg",
  kubernetes: "/integrations/kubernetes.svg",
  ecs: "/integrations/ecs.svg",
  slack: "/integrations/slack.svg",
  "github-actions": "/integrations/github-actions.svg",
  "alror-cli": "/integrations/alror-cli.svg",
  "go-sdk": "/integrations/go-sdk.svg",
  "ts-sdk": "/integrations/ts-sdk.svg",
  "aws-lambda": "/integrations/aws-lambda.svg",
  "cloud-run": "/integrations/cloud-run.svg",
  pagerduty: "/integrations/pagerduty.svg",
  opsgenie: "/integrations/opsgenie.svg",
  "gitlab-ci": "/integrations/gitlab-ci.svg",
};

/** The brand logo URL for a plugin id, or null when the plugin uses an icon. */
export function pluginLogoUrl(id: string): string | null {
  return LOGOS[id] ?? null;
}
