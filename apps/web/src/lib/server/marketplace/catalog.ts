// The marketplace catalog: plugins and libraries an org can browse on /app/marketplace.
//
// Exported API (stable; the marketplace UI builds on it):
//   CATALOG: CatalogItem[]                 every item, in display order
//   getCatalogItem(id) -> CatalogItem | undefined
//   PLUGIN_CATEGORIES                      [{ value, label, short }] for metrics | targets | notifications | ci | libraries
//   categoryLabel(category) -> string
//   METRICS_PLUGINS, TARGET_PLUGINS        installable metrics providers / deploy targets
//   Types: CatalogItem, PluginCategory, PluginKind (builtin | installable | guide | planned),
//          PluginStage (ready | beta | planned), ConfigField, FieldType, Snippet, PluginLogo
//
// Rendering notes: logo is { type: "brand", title, path } (a simple-icons 24x24 SVG path,
// draw it monochrome with fill="currentColor") or { type: "icon", icon } (map to a lucide icon).
// ConfigField.storage: "plugin" (default, stored), "policy" (Slack webhook: write-only, show
// masked), "env" (never stored; render as guidance to set ConfigField.env on the runner).
// Only kind "installable" can be installed; "guide" shows setup + snippets; "planned" takes votes.
//
// Everything listed as ready or beta maps to something the Alror CLI already does
// (internal/metrics, internal/driver, internal/notify, actions/, pkg/alror, sdk/js).
// Planned items are listed honestly: they cannot be installed, only voted for.

import { siDatadog, siGithubactions, siGitlab, siGo, siGooglecloud, siKubernetes, siOpsgenie, siPagerduty, siPrometheus, siTypescript } from "simple-icons";
import type { Target } from "../db/schema";

export const PLUGIN_CATEGORIES = [
  { value: "metrics", label: "Metrics providers", short: "Metrics" },
  { value: "targets", label: "Deploy targets", short: "Targets" },
  { value: "notifications", label: "Notifications", short: "Notifications" },
  { value: "ci", label: "CI", short: "CI" },
  { value: "libraries", label: "Libraries and SDKs", short: "Libraries" },
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number]["value"];

/**
 * builtin: always on, nothing to install (synthetic metrics, simulated target).
 * installable: install / configure / disable / uninstall, persisted in org_plugins.
 * guide: runs outside the workspace (CI, SDKs, the CLI); setup snippets only.
 * planned: not built yet; members can vote for it.
 */
export type PluginKind = "builtin" | "installable" | "guide" | "planned";
export type PluginStage = "ready" | "beta" | "planned";

export type FieldType = "text" | "url" | "secret" | "select" | "number";

export type ConfigField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string; description?: string }[];
  /** Long values (queries) get a wider, monospace input. */
  mono?: boolean;
  /**
   * Where the value lives. plugin (default): org_plugins.config. policy: the org
   * policy (Slack webhook), never echoed back in full. env: not stored at all;
   * the field only explains which environment variable to set on the runner.
   */
  storage?: "plugin" | "policy" | "env";
  /** For storage "env": the variable the CLI reads. */
  env?: string;
};

export type Snippet = { label: string; lang: "sh" | "powershell" | "yaml" | "go" | "ts"; code: string };

export type PluginLogo = { type: "brand"; title: string; path: string } | { type: "icon"; icon: "activity" | "box" | "container" | "message" | "zap" | "flag" | "terminal" };

export type CatalogItem = {
  id: string;
  name: string;
  category: PluginCategory;
  publisher: "Alror";
  /** null for planned items. */
  version: string | null;
  kind: PluginKind;
  stage: PluginStage;
  /** One line for the card. */
  summary: string;
  /** Paragraphs separated by blank lines; "- " lines are bullets; `code` and **bold** inline. */
  description: string;
  logo: PluginLogo;
  fields: ConfigField[];
  /** Page of the local docs site (alror docs). */
  docs: string;
  /** What installing it changes, in plain words. */
  changes: string[];
  setup: { title: string; body?: string; snippet?: Snippet }[];
  /** Extra copyable snippets (libraries, CI). */
  snippets?: Snippet[];
  /** metrics providers: the value written to policy.metrics.provider */
  metricsProvider?: string;
  /** deploy targets: the services.target value it enables */
  target?: Target;
  /** A short caveat shown next to the badge (beta, not on npm yet). */
  note?: string;
  keywords?: string;
};

const brand = (icon: { title: string; path: string }): PluginLogo => ({ type: "brand", title: icon.title, path: icon.path });

const CLI_VERSION = "0.1.0";
const REPO = "github.com/alrors/alror";

const PROM_QUERIES = {
  error_rate:
    'sum(rate(http_requests_total{app="{{service}}",track="{{track}}",code=~"5.."}[1m])) / sum(rate(http_requests_total{app="{{service}}",track="{{track}}"}[1m])) * 100',
  latency_p95:
    'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{app="{{service}}",track="{{track}}"}[1m]))) * 1000',
};

const DD_QUERIES = {
  error_rate: "sum:trace.http.request.errors{service:{{service}},track:{{track}}}.as_rate() / sum:trace.http.request.hits{service:{{service}},track:{{track}}}.as_rate() * 100",
  latency_p95: "p95:trace.http.request.duration{service:{{service}},track:{{track}}} * 1000",
};

const queryFields = (defaults: Record<string, string>, lang: string): ConfigField[] => [
  {
    key: "query_error_rate",
    label: "error_rate query",
    type: "text",
    required: true,
    mono: true,
    default: defaults.error_rate,
    help: `${lang} for the error rate in percent. {{service}} and {{track}} (canary or baseline) are substituted.`,
  },
  {
    key: "query_latency_p95",
    label: "latency_p95 query",
    type: "text",
    required: true,
    mono: true,
    default: defaults.latency_p95,
    help: `${lang} for p95 latency in milliseconds. Same placeholders.`,
  },
];

const CHECK_YAML = `# .github/workflows/alror.yml
name: Alror
on:
  pull_request:

jobs:
  risk:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write          # the "Alror / change-risk" check run
      pull-requests: write   # the sticky risk comment
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # full history for an exact diff
      - uses: alrors/alror/actions/check@main
        with:
          comment: "true"
          fail-above: "0"    # e.g. 85 blocks very risky PRs`;

const DEPLOY_YAML = `# .github/workflows/alror-deploy.yml
name: Alror deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    env:
      # Connected mode: the run is recorded in this workspace.
      ALROR_SERVER: \${{ secrets.ALROR_SERVER }}
      ALROR_API_KEY: \${{ secrets.ALROR_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      # build and push your image here
      - uses: alrors/alror/actions/deploy@main
        id: alror
        with:
          service: checkout-api
          image: registry.example.com/checkout-api:\${{ github.sha }}`;

export const CATALOG: CatalogItem[] = [
  // ------------------------------- Metrics -------------------------------
  {
    id: "synthetic",
    name: "Synthetic metrics",
    category: "metrics",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "builtin",
    stage: "ready",
    summary: "Realistic generated metrics, so the whole release loop runs without a metrics backend.",
    description: `The default metrics provider. The CLI generates realistic error-rate and latency samples for the canary and the baseline, then runs the same statistical verdicts it would run on real data.

- Nothing to configure or connect.
- \`alror deploy --regress\` injects a regression, so you can watch a rollback end to end.
- Active whenever no other metrics provider is enabled.`,
    logo: { type: "icon", icon: "activity" },
    fields: [],
    docs: "targets",
    changes: ["Used for verification whenever Prometheus or Datadog is not enabled (policy metrics.provider = synthetic)."],
    setup: [{ title: "Try a rollback", body: "Inject a regression into a simulated deploy and watch Alror roll it back.", snippet: { label: "Shell", lang: "sh", code: "alror deploy -s checkout-api -i registry/checkout:1.2.3 --regress" } }],
    metricsProvider: "synthetic",
    keywords: "demo default fake",
  },
  {
    id: "prometheus",
    name: "Prometheus",
    category: "metrics",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "installable",
    stage: "ready",
    summary: "Verify canaries against PromQL queries. Works with Thanos, Mimir and VictoriaMetrics.",
    description: `Reads canary and baseline series from any Prometheus-compatible HTTP API (\`/api/v1/query_range\`, 15 s step) and compares them with the Mann-Whitney test at every rollout stage.

- One PromQL query per metric. \`{{service}}\` and \`{{track}}\` are substituted, where track is \`canary\` or \`baseline\`.
- The metric names match the thresholds on the Policies page (error_rate and latency_p95).
- The CLI and \`alror runner\` reach Prometheus directly from your network. The workspace never queries it.`,
    logo: brand(siPrometheus),
    fields: [
      { key: "url", label: "Prometheus URL", type: "url", required: true, placeholder: "http://prometheus:9090", help: "Base URL the CLI and runners can reach. No trailing /api/v1." },
      ...queryFields(PROM_QUERIES, "PromQL"),
    ],
    docs: "configuration",
    changes: [
      "Sets policy metrics.provider to prometheus, with metrics.url and the queries above.",
      "GET /api/v1/config and alror config pull return the new metrics block; the next deploy verifies against Prometheus.",
      "Disabling or uninstalling switches the policy back to synthetic metrics.",
    ],
    setup: [
      { title: "Install and enter the URL", body: "Owners and admins install it here. The queries are prefilled for the common http_requests_total and http_request_duration_seconds metrics." },
      { title: "Pull the config", body: "Connected CLIs read the policy on every run. To refresh a local alror.yaml:", snippet: { label: "Shell", lang: "sh", code: "alror config pull" } },
      { title: "Check it end to end", body: "Run a shadow deploy: verdicts are recorded but never roll back.", snippet: { label: "Shell", lang: "sh", code: "alror deploy -s checkout-api -i registry/checkout:1.2.3 --shadow" } },
    ],
    metricsProvider: "prometheus",
    keywords: "promql thanos mimir victoriametrics observability",
  },
  {
    id: "datadog",
    name: "Datadog",
    category: "metrics",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "installable",
    stage: "ready",
    summary: "Verify canaries against Datadog metric queries.",
    description: `Queries the Datadog metrics API (\`/api/v1/query\`) for the canary and the baseline at every stage.

- Pick your Datadog site and one query per metric. \`{{service}}\` and \`{{track}}\` are substituted.
- API and application keys are **never stored in Alror**. Set \`DD_API_KEY\` and \`DD_APP_KEY\` on every machine that runs \`alror deploy\` or \`alror runner\`.`,
    logo: brand(siDatadog),
    fields: [
      {
        key: "site",
        label: "Datadog site",
        type: "select",
        required: true,
        default: "https://api.datadoghq.com",
        options: [
          { value: "https://api.datadoghq.com", label: "US1", description: "api.datadoghq.com" },
          { value: "https://api.us3.datadoghq.com", label: "US3", description: "api.us3.datadoghq.com" },
          { value: "https://api.us5.datadoghq.com", label: "US5", description: "api.us5.datadoghq.com" },
          { value: "https://api.datadoghq.eu", label: "EU1", description: "api.datadoghq.eu" },
          { value: "https://api.ap1.datadoghq.com", label: "AP1", description: "api.ap1.datadoghq.com" },
          { value: "https://api.ddog-gov.com", label: "US1-FED", description: "api.ddog-gov.com" },
        ],
        help: "The API host for your Datadog organization.",
      },
      ...queryFields(DD_QUERIES, "Datadog query"),
      { key: "api_key", label: "API key", type: "secret", storage: "env", env: "DD_API_KEY", help: "Set on the runner. Never stored in Alror." },
      { key: "app_key", label: "Application key", type: "secret", storage: "env", env: "DD_APP_KEY", help: "Set on the runner. Never stored in Alror." },
    ],
    docs: "targets",
    changes: [
      "Sets policy metrics.provider to datadog, with metrics.url set to the site and the queries above.",
      "Runners and CLIs need DD_API_KEY and DD_APP_KEY in their environment, or verification fails before the first stage.",
      "Disabling or uninstalling switches the policy back to synthetic metrics.",
    ],
    setup: [
      { title: "Install and pick the site", body: "Owners and admins install it here." },
      {
        title: "Set the keys on the runner",
        body: "Keys stay in your infrastructure. For a runner started from a shell:",
        snippet: { label: "Shell", lang: "sh", code: "export DD_API_KEY=<api key>\nexport DD_APP_KEY=<application key>\nalror runner" },
      },
      { title: "Check it end to end", snippet: { label: "Shell", lang: "sh", code: "alror deploy -s checkout-api -i registry/checkout:1.2.3 --shadow" } },
    ],
    metricsProvider: "datadog",
    keywords: "dd apm observability",
  },

  // ------------------------------- Targets -------------------------------
  {
    id: "simulated",
    name: "Simulated target",
    category: "targets",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "builtin",
    stage: "ready",
    summary: "Records traffic changes in memory. Exercise the whole release loop without infrastructure.",
    description: `The default deploy target. Every weight change, promotion and rollback is recorded, but nothing outside the CLI is touched.

- Useful for demos, tests and trying policies before wiring a real target.
- Always available in the service form.`,
    logo: { type: "icon", icon: "box" },
    fields: [],
    docs: "targets",
    changes: ["Always offered as a service target. Nothing to install."],
    setup: [{ title: "Use it in alror.yaml", snippet: { label: "alror.yaml", lang: "yaml", code: "services:\n  - name: web-frontend\n    paths: [web/]\n    target: simulated" } }],
    target: "simulated",
    keywords: "demo default",
  },
  {
    id: "kubernetes",
    name: "Kubernetes (Argo Rollouts)",
    category: "targets",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "installable",
    stage: "ready",
    summary: "Shift canary weight on an Argo Rollouts resource with kubectl argo rollouts.",
    description: `Drives an Argo Rollouts \`Rollout\` named after the service. Alror sets the canary weight for each stage, promotes when every verdict passes and aborts when one fails.

- Needs \`kubectl\` and the \`kubectl argo rollouts\` plugin on the machine running the CLI or the runner.
- \`cluster\` is the kube context and \`namespace\` the namespace, per service.`,
    logo: brand(siKubernetes),
    fields: [
      { key: "default_cluster", label: "Default cluster", type: "text", placeholder: "prod-eu-1", help: "Kube context prefilled when you create a Kubernetes service. Optional." },
      { key: "default_namespace", label: "Default namespace", type: "text", placeholder: "default", help: "Prefilled for new Kubernetes services. Optional." },
    ],
    docs: "targets",
    changes: [
      "Offers kubernetes as a target in the console's service form, with the defaults above prefilled.",
      "Existing services keep their target when it is uninstalled; the CLI and alror config push are not restricted.",
    ],
    setup: [
      { title: "Install the Argo Rollouts plugin", body: "On every machine that runs alror deploy or alror runner:", snippet: { label: "Shell", lang: "sh", code: "kubectl argo rollouts version" } },
      { title: "Point a service at the cluster", snippet: { label: "alror.yaml", lang: "yaml", code: "services:\n  - name: checkout-api\n    paths: [services/checkout/]\n    target: kubernetes\n    cluster: prod-eu\n    namespace: checkout" } },
      { title: "Push the config", snippet: { label: "Shell", lang: "sh", code: "alror config push" } },
    ],
    target: "kubernetes",
    keywords: "k8s argo rollouts kubectl canary",
  },
  {
    id: "ecs",
    name: "Amazon ECS",
    category: "targets",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "installable",
    stage: "beta",
    note: "Driver not implemented yet",
    summary: "Shift ALB target-group weights between two ECS services. Beta: the driver is a stub.",
    description: `The ECS driver will shift weights between two target groups behind an ALB listener.

**Beta.** The driver is a stub in the current CLI: setting a weight, promoting or rolling back an \`ecs\` service returns "not implemented yet", so deploys to ECS services fail at the first stage. Install it to model ECS services in the console ahead of the driver.`,
    logo: { type: "icon", icon: "container" },
    fields: [{ key: "default_cluster", label: "Default ECS cluster", type: "text", placeholder: "prod-cluster", help: "Prefilled when you create an ECS service. Optional." }],
    docs: "targets",
    changes: ["Offers ecs as a target in the console's service form.", "Deploys to ecs services fail until the driver ships."],
    setup: [{ title: "Model the service", snippet: { label: "alror.yaml", lang: "yaml", code: "services:\n  - name: billing\n    paths: [services/billing/]\n    target: ecs\n    cluster: prod-cluster" } }],
    target: "ecs",
    keywords: "aws alb fargate",
  },

  // ---------------------------- Notifications ----------------------------
  {
    id: "slack",
    name: "Slack",
    category: "notifications",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "installable",
    stage: "ready",
    summary: "Post promoted and rolled-back releases to a channel through an incoming webhook.",
    description: `Sends one message per finished release: promoted, or rolled back with the failing metric and the reason.

- Uses a Slack incoming webhook. Create one in your Slack workspace (Apps, Incoming Webhooks) for the channel you want.
- The webhook is stored in the org policy and treated as a secret: the console only shows a masked form.`,
    logo: { type: "icon", icon: "message" },
    fields: [
      {
        key: "webhook",
        label: "Incoming webhook URL",
        type: "secret",
        storage: "policy",
        required: true,
        placeholder: "https://hooks.slack.com/services/…",
        help: "Stored as the policy's slack_webhook. Leave empty to keep the current one.",
      },
    ],
    docs: "configuration",
    changes: [
      "Sets the policy's notify.slack_webhook, returned by GET /api/v1/config to keys with deploy:read.",
      "Disabling or uninstalling clears the webhook.",
    ],
    setup: [
      { title: "Create an incoming webhook in Slack", body: "Pick the channel; Slack gives you a https://hooks.slack.com/services/… URL." },
      { title: "Install and paste it here", body: "The CLI and runners use it on their next run. To check from a terminal:", snippet: { label: "Shell", lang: "sh", code: "alror config pull" } },
    ],
    keywords: "chat webhook alerts",
  },

  // ---------------------------------- CI ----------------------------------
  {
    id: "github-actions",
    name: "GitHub Actions",
    category: "ci",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "guide",
    stage: "ready",
    summary: "Risk check on every pull request and verified deploys from your workflows.",
    description: `Two composite actions from the alror-cli repository:

- \`actions/check\` scores each pull request, posts an "Alror / change-risk" check run and keeps a sticky comment with the breakdown. \`fail-above\` can block very risky changes.
- \`actions/deploy\` runs a risk-scored, verified rollout and fails the job when the release is rolled back.

They run in GitHub, so there is nothing to install in this workspace. Add \`ALROR_SERVER\` and \`ALROR_API_KEY\` (a key with deploy:read and deploy:write) as repository secrets to record deploys here.`,
    logo: brand(siGithubactions),
    fields: [],
    docs: "github",
    changes: ["Nothing in the workspace. Deploys from the action show up under Deployments with source CI."],
    setup: [
      { title: "Create an API key", body: "Settings, API keys, with the CI preset (deploy:read and deploy:write)." },
      { title: "Add repository secrets", body: "ALROR_SERVER (this workspace's URL) and ALROR_API_KEY." },
      { title: "Add the workflows", body: "Copy the snippets below into .github/workflows/." },
    ],
    snippets: [
      { label: "Risk check on pull requests", lang: "yaml", code: CHECK_YAML },
      { label: "Verified deploy on main", lang: "yaml", code: DEPLOY_YAML },
    ],
    keywords: "github ci pull request check workflow action",
  },

  // ------------------------------- Libraries -------------------------------
  {
    id: "alror-cli",
    name: "Alror CLI",
    category: "libraries",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "guide",
    stage: "ready",
    summary: "The alror command: risk checks, verified rollouts, the runner and the local docs.",
    description: `A single Go binary. It scores changes, runs verified rollouts against your targets, and in connected mode records everything in this workspace. \`alror runner\` processes deploys queued from the console.

The install scripts verify the release checksum. The npm package ships the same binary but is not published to npm yet.`,
    logo: { type: "icon", icon: "terminal" },
    fields: [],
    docs: "cli",
    changes: ["Nothing in the workspace until you connect it with alror login."],
    setup: [{ title: "Connect it to this workspace", body: "Create an API key in Settings, then:", snippet: { label: "Shell", lang: "sh", code: "alror login --server <workspace url> --key <alr_live_…>" } }],
    snippets: [
      { label: "macOS and Linux", lang: "sh", code: "curl -fsSL https://raw.githubusercontent.com/alrors/alror/main/scripts/install.sh | sh" },
      { label: "Windows (PowerShell)", lang: "powershell", code: "irm https://raw.githubusercontent.com/alrors/alror/main/scripts/install.ps1 | iex" },
      { label: "With Go", lang: "sh", code: `go install ${REPO}/cmd/alror@latest` },
    ],
    keywords: "install binary command line terminal runner",
  },
  {
    id: "go-sdk",
    name: "Go SDK",
    category: "libraries",
    publisher: "Alror",
    version: CLI_VERSION,
    kind: "guide",
    stage: "ready",
    summary: "pkg/alror: the API client, shared types and the rule-based risk scorer.",
    description: `The public Go package the CLI itself uses. Read deployments, append events, enqueue deploy and rollback jobs, or build your own runner with ClaimJob, HeartbeatJob and FinishJob.

- Types are aliases of the CLI's own, so their JSON matches the API byte for byte.
- \`pkg/alror/risk\` scores a change offline, with only git.`,
    logo: brand(siGo),
    fields: [],
    docs: "connected",
    changes: ["Nothing in the workspace. Calls use an API key and its scopes."],
    setup: [],
    snippets: [
      { label: "Install", lang: "sh", code: `go get ${REPO}/pkg/alror` },
      {
        label: "Queue a deploy",
        lang: "go",
        code: `import "${REPO}/pkg/alror"

client := alror.NewClient("https://alror.example.com", os.Getenv("ALROR_API_KEY"))
job, err := client.EnqueueDeploy(ctx, alror.DeployRequest{Service: "checkout-api", Image: "registry/checkout:1.42"})`,
      },
    ],
    keywords: "golang library client api",
  },
  {
    id: "ts-sdk",
    name: "TypeScript SDK",
    category: "libraries",
    publisher: "Alror",
    version: "0.1.0",
    kind: "guide",
    stage: "beta",
    note: "Not on npm yet",
    summary: "@alror/sdk for Node 18+: deployments, events, jobs and the live stream. ESM and CJS, no dependencies.",
    description: `A typed client for the same REST API. Iterate deployments, read event logs, queue deploys and follow the live stream.

**Not published to npm yet.** Until the first npm release, install the tarball attached to a GitHub release, or pack it from source.`,
    logo: brand(siTypescript),
    fields: [],
    docs: "connected",
    changes: ["Nothing in the workspace. Calls use an API key and its scopes."],
    setup: [],
    snippets: [
      { label: "From a GitHub release", lang: "sh", code: "npm i https://github.com/alrors/alror/releases/download/v0.1.0/alror-sdk-0.1.0.tgz" },
      { label: "From source", lang: "sh", code: "git clone https://github.com/alrors/alror && cd alror-cli/sdk/js\nnpm ci && npm pack" },
      {
        label: "Queue a deploy",
        lang: "ts",
        code: `import { Alror } from "@alror/sdk";

const alror = new Alror({ server: "https://alror.example.com", apiKey: process.env.ALROR_API_KEY! });
await alror.enqueueDeploy({ service: "checkout-api", image: "registry/checkout:1.42" });`,
      },
    ],
    keywords: "javascript node npm library client api typescript",
  },

  // -------------------------------- Planned --------------------------------
  ...(
    [
      ["aws-lambda", "AWS Lambda", "targets", { type: "icon", icon: "zap" }, "Shift weighted alias traffic between Lambda versions.", "aws serverless"],
      ["cloud-run", "Google Cloud Run", "targets", brand(siGooglecloud), "Split traffic between Cloud Run revisions.", "gcp google serverless"],
      ["feature-flags", "Feature flags", "targets", { type: "icon", icon: "flag" }, "Roll out behind a flag (OpenFeature providers) instead of shifting traffic.", "launchdarkly unleash openfeature flag"],
      ["pagerduty", "PagerDuty", "notifications", brand(siPagerduty), "Open an incident when a release is rolled back.", "incident oncall paging"],
      ["opsgenie", "Opsgenie", "notifications", brand(siOpsgenie), "Alert the on-call team when a release is rolled back.", "incident oncall atlassian"],
      ["gitlab-ci", "GitLab CI", "ci", brand(siGitlab), "Risk check on merge requests and verified deploys from .gitlab-ci.yml.", "gitlab merge request pipeline"],
    ] as const
  ).map(
    ([id, name, category, logo, summary, keywords]): CatalogItem => ({
      id,
      name,
      category,
      publisher: "Alror",
      version: null,
      kind: "planned",
      stage: "planned",
      summary,
      description: `${summary}

This integration is planned and not built yet, so it cannot be installed. Vote for it to tell the Alror team your organization wants it.`,
      logo: logo as PluginLogo,
      fields: [],
      docs: "targets",
      changes: ["Nothing yet. Votes are recorded for your organization."],
      setup: [],
      keywords,
    }),
  ),
];

const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

export function getCatalogItem(id: string): CatalogItem | undefined {
  return BY_ID.get(id);
}

export const categoryLabel = (c: PluginCategory) => PLUGIN_CATEGORIES.find((x) => x.value === c)?.label ?? c;

/** Metrics providers that live in org_plugins (not the built-in synthetic one). */
export const METRICS_PLUGINS = CATALOG.filter((p) => p.category === "metrics" && p.kind === "installable");
/** Deploy target plugins that can be installed. */
export const TARGET_PLUGINS = CATALOG.filter((p) => p.category === "targets" && p.kind === "installable" && p.target);
