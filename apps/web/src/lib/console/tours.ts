// Guided tours for the console, run with driver.js by <TourHost>. Each step
// points at an element marked data-tour="<anchor>"; steps whose element is not
// on screen are skipped, and a step without an anchor shows as a centred card.
// Client-safe: no server imports.

export type TourStep = { anchor?: string; title: string; body: string; side?: "top" | "right" | "bottom" | "left" };
export type Tour = { id: TourId; title: string; summary: string; href: string; steps: TourStep[] };
export type TourId = "console" | "releases" | "services" | "policies";

export const TOURS: Tour[] = [
  {
    id: "console",
    title: "Console basics",
    summary: "Navigation, deploying, search and where Alror asks for you.",
    href: "/app",
    steps: [
      {
        title: "Welcome to your workspace",
        body: "Alror scores every change, rolls it out as a canary, checks live metrics and rolls back on its own. This tour shows where each part lives. It takes about a minute.",
      },
      { anchor: "sidebar", side: "right", title: "Navigation", body: "Everything in the workspace is one click away. Collapse the sidebar with Ctrl B when you need room." },
      { anchor: "nav-oversight", side: "right", title: "Oversight", body: "Your home: decisions that need you, what Alror did on its own, and the impact of recent releases." },
      { anchor: "nav-live", side: "right", title: "Live", body: "Rollouts in flight, stage by stage, with the canary and baseline side by side." },
      { anchor: "nav-deployments", side: "right", title: "Deployments", body: "Every release with its risk score, plan, verdicts and the reason it was promoted or rolled back." },
      { anchor: "deploy", side: "bottom", title: "Deploy from here", body: "Queue a release for a service. A runner next to your cluster picks it up and rolls it out with your policy." },
      { anchor: "search", side: "bottom", title: "Search and commands", body: "Jump to any page, service or deployment, or run actions like creating an API key. Press Ctrl K anywhere." },
      { anchor: "notifications", side: "bottom", title: "Notifications", body: "Promotions, rollbacks and anything that needs a decision show up here." },
      { anchor: "help", side: "bottom", title: "Help is always here", body: "Replay any tour, open the setup checklist, the docs or the keyboard shortcuts." },
      { anchor: "nav-getting-started", side: "right", title: "Finish setting up", body: "The checklist ticks itself off as Alror sees your CLI, runner and first release. Pick up where you left off any time." },
    ],
  },
  {
    id: "releases",
    title: "Reading a release",
    summary: "Risk scores, canary stages and why Alror promoted or rolled back.",
    href: "/app/deployments",
    steps: [
      { anchor: "page-title", side: "bottom", title: "Every release, explained", body: "Each row is one release of one service, from the CLI, CI or this console." },
      { anchor: "deployments-filters", side: "bottom", title: "Filter fast", body: "Narrow by service, status or environment. Rolled-back releases are one click away." },
      { anchor: "deployments-table", side: "top", title: "Open a release", body: "Click a row to see the risk factors, each canary stage, the metric verdicts and the evidence behind the decision." },
    ],
  },
  {
    id: "services",
    title: "Services",
    summary: "What Alror releases and how each service is targeted.",
    href: "/app/services",
    steps: [
      { anchor: "page-title", side: "bottom", title: "Your services", body: "A service is something Alror releases: its paths in the repo, where it runs and whether it is critical." },
      { anchor: "services-list", side: "top", title: "Per-service detail", body: "Open a service for its release history, current version and per-service policy overrides." },
    ],
  },
  {
    id: "policies",
    title: "Policies",
    summary: "The rules that decide plans, thresholds and rollbacks.",
    href: "/app/policies",
    steps: [
      { anchor: "page-title", side: "bottom", title: "One policy, every release", body: "Risk levels pick the rollout plan, and per-metric limits decide when a canary has regressed." },
      { body: "Start in shadow mode: Alror records what it would have done without acting, so you can tune thresholds before turning on automatic rollback.", title: "Try it safely" },
    ],
  },
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);
