/* eslint-disable @next/next/no-img-element -- small local SVG logos, no optimisation needed */
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, Fingerprint, GitBranch, GitPullRequest, Menu, RotateCcw, Server } from "lucide-react";
import { siArgo } from "simple-icons";
import { GithubLogo, SimpleLogo } from "@/components/landing/brand-logos";
import { InstallCommand } from "@/components/landing/install";
import { DOCS_URL, QUICKSTART_URL, REPO_URL } from "@/components/landing/links";
import { AgentLog } from "./agent-log";
import { Btn, Heading, Marquee, RetroWindow, Sticker, Wrap } from "./kit";
import { Mascot } from "./mascot";

/* ---------------------------------- Nav ---------------------------------- */

const NAV = [
  { href: "#platform", label: "Product" },
  { href: "#cli", label: "Developers" },
  { href: "#console", label: "Console" },
  { href: "#open-source", label: "Open source" },
  { href: "/learn", label: "Learn" },
  { href: DOCS_URL, label: "Docs" },
];

function Brand() {
  return (
    <Link href="/" className="rx-brand" aria-label="Alror home">
      <Mascot className="h-8 w-8" title="" />
      <span>alror</span>
    </Link>
  );
}

export function RetroNav() {
  return (
    <header className="rx-nav">
      <a href="#main" className="rx-skip">
        Skip to content
      </a>
      <Wrap className="flex h-16 items-center justify-between gap-4">
        <Brand />
        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="rx-navlink" {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Btn href="/login" tone="paper">
            Sign in
          </Btn>
          <Btn href="#cli">Get started</Btn>
        </div>
        <details className="rx-mobile lg:hidden">
          <summary aria-label="Open menu" className="rx-btn rx-btn-paper">
            <Menu size={16} />
          </summary>
          <div className="rx-mobile-panel">
            {NAV.map((l) => (
              <a key={l.label} href={l.href} {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                {l.label}
              </a>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Btn href="/login" tone="paper">
                Sign in
              </Btn>
              <Btn href="#cli">Get started</Btn>
            </div>
          </div>
        </details>
      </Wrap>
    </header>
  );
}

/* ---------------------------------- Hero --------------------------------- */

export function RetroHero() {
  return (
    <section className="rx-hero" aria-labelledby="hero-title">
      <Wrap className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2.5">
            <Sticker tone="lime" tilt={-4}>
              open source ✦ apache-2.0
            </Sticker>
            <Sticker tone="lilac" tilt={3}>
              agent-ready
            </Sticker>
          </div>
          <h1 id="hero-title" className="rx-h1">
            Ship at AI speed.
            <br />
            <mark className="rx-mark rx-bg-mint">Keep production safe.</mark>
          </h1>
          <p className="rx-hero-lead">
            Your agents write the code. Alror releases it: scores every change, rolls it out in small steps, checks live metrics and rolls back
            on its own when something regresses.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Btn href="#cli" size="lg">
              Start building <ArrowRight size={17} aria-hidden />
            </Btn>
            <Btn href={REPO_URL} size="lg" tone="paper">
              <GithubLogo /> Star on GitHub
            </Btn>
          </div>
          <ul className="rx-proof">
            <li>✓ self-hosted by design</li>
            <li>✓ works in your existing CI</li>
            <li>✓ every decision explained</li>
          </ul>
        </div>

        <div className="relative mt-16 min-w-0 lg:mt-12">
          <Mascot className="rx-hero-mascot" />
          <Sticker tone="paper" tilt={6} className="rx-hero-bubble">
            watching prod 24/7
          </Sticker>
          <RetroWindow title="agent_session.exe" tone="lilac" className="rx-hero-window" bodyClassName="rx-window-flush">
            <AgentLog />
          </RetroWindow>
        </div>
      </Wrap>
    </section>
  );
}

/* --------------------------------- Stack --------------------------------- */

const STACK: { name: string; src?: string; note?: string }[] = [
  { name: "Kubernetes", src: "/integrations/kubernetes.svg" },
  { name: "Argo Rollouts" },
  { name: "Amazon ECS", src: "/integrations/ecs.svg", note: "beta" },
  { name: "Prometheus", src: "/integrations/prometheus.svg" },
  { name: "Datadog", src: "/integrations/datadog.svg" },
  { name: "GitHub Actions", src: "/integrations/github-actions.svg" },
  { name: "Slack", src: "/integrations/slack.svg" },
  { name: "Go + TS SDKs", src: "/integrations/go-sdk.svg" },
];

export function RetroTicker() {
  return <Marquee items={["risk-scored releases", "canary rollouts", "live verification", "auto rollback", "self-hosted", "built for AI-written code", "explainable decisions"]} />;
}

export function RetroStack() {
  return (
    <section aria-labelledby="stack-title" className="rx-band">
      <Wrap>
        <h2 id="stack-title" className="rx-eyebrow text-center">
          <span aria-hidden>▶</span> works with the stack you already run
        </h2>
        <ul className="mt-6 flex flex-wrap justify-center gap-3">
          {STACK.map((s) => (
            <li key={s.name} className="rx-chip">
              <span className="rx-chip-icon">
                {s.src ? <img src={s.src} alt="" className="h-4 w-4 object-contain" /> : <SimpleLogo icon={siArgo} className="h-4 w-4" />}
              </span>
              {s.name}
              {s.note && <span className="rx-chip-note">{s.note}</span>}
            </li>
          ))}
        </ul>
      </Wrap>
    </section>
  );
}

/* -------------------------------- Features ------------------------------- */

const FEATURES = [
  {
    icon: Fingerprint,
    n: "01",
    tone: "butter",
    title: "Understand the change.",
    body: "A risk score with a reason behind every point. Know what changed and what deserves a closer look.",
    href: "#risk",
    link: "explore risk scoring",
    stat: "62/100",
  },
  {
    icon: GitBranch,
    n: "02",
    tone: "lilac",
    title: "Release at the right pace.",
    body: "Small changes move fast. Risky changes take smaller steps, with live metrics checking every stage.",
    href: "#verify",
    link: "see progressive delivery",
    stat: "5 → 100%",
  },
  {
    icon: RotateCcw,
    n: "03",
    tone: "lime",
    title: "Recover automatically.",
    body: "When the canary regresses, traffic returns to the baseline. You get the evidence behind the decision.",
    href: "#verify",
    link: "watch a rollback",
    stat: "41s",
  },
] as const;

export function RetroFeatures() {
  return (
    <section id="platform" className="rx-section" aria-labelledby="platform-title">
      <Wrap>
        <Heading
          id="platform-title"
          eyebrow="the missing step in your pipeline"
          title="More velocity."
          marker="Less crossed fingers."
          lead="Your tests check the code. Alror checks the release. One continuous safety net, from merge to production."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {FEATURES.map((f, i) => (
            <a key={f.n} href={f.href} className={`rx-card rx-bg-${f.tone}`} style={{ "--tilt": `${[-1.2, 0.8, -0.6][i]}deg` } as React.CSSProperties} data-reveal>
              <div className="flex items-center justify-between">
                <span className="rx-card-icon">
                  <f.icon size={20} strokeWidth={2} />
                </span>
                <span className="rx-card-n">{f.n}</span>
              </div>
              <p className="rx-card-stat">{f.stat}</p>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <span className="rx-card-link">
                {f.link} <ArrowUpRight size={14} />
              </span>
            </a>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

/* ------------------------- Section with a demo screen -------------------- */

export function DemoSection({
  id,
  label,
  eyebrow,
  title,
  marker,
  lead,
  window,
  tone,
  children,
}: {
  id: string;
  label: string;
  eyebrow: string;
  title: string;
  marker: string;
  lead: string;
  window: string;
  tone: "lime" | "butter" | "lilac" | "sky" | "mint";
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={label} className="rx-section">
      <Wrap>
        <Heading eyebrow={eyebrow} title={title} marker={marker} lead={lead} tone={tone} />
        <RetroWindow title={window} tone={tone} screen className="mt-10">
          {children}
        </RetroWindow>
      </Wrap>
    </section>
  );
}

/* ----------------------------------- CLI --------------------------------- */

const FACTS = [
  { k: "license", v: "Apache-2.0" },
  { k: "runtime", v: "Single Go binary" },
  { k: "sdks", v: "Go · TypeScript" },
  { k: "exit codes", v: "2 rolled back · 3 gate" },
];

export function RetroCli({ terminal }: { terminal: React.ReactNode }) {
  return (
    <section id="cli" aria-label="Open-source CLI" className="rx-section">
      <Wrap className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
        <div className="min-w-0">
          <Heading
            eyebrow="developer first"
            title="The engine is a CLI."
            marker="At home in your pipeline."
            tone="sky"
            lead="Risk scoring, rollouts, verification and rollback all run inside one Go binary, usually as a single CI step. Output built for humans, exit codes built for CI and coding agents."
          />
          <div className="lp mt-8 rx-install">
            <InstallCommand />
          </div>
          <dl className="rx-facts">
            {FACTS.map((f) => (
              <div key={f.k}>
                <dt>{f.k}</dt>
                <dd>{f.v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <RetroWindow title="terminal.exe" tone="sky" screen className="min-w-0 self-start">
          {terminal}
        </RetroWindow>
      </Wrap>
    </section>
  );
}

/* ------------------------------- Open source ----------------------------- */

const LINKS = [
  { icon: Server, title: "Run it on your terms", body: "Self-host the workspace in your infrastructure.", href: `${REPO_URL}/blob/main/docker/README.md` },
  { icon: GitPullRequest, title: "Build with us", body: "Your first issue. Your next pull request.", href: `${REPO_URL}/blob/main/CONTRIBUTING.md` },
  { icon: BookOpen, title: "Understand every decision", body: "Explore the engine, policies and architecture.", href: DOCS_URL },
];

export function RetroOpenSource() {
  return (
    <section id="open-source" className="rx-section" aria-labelledby="community-title">
      <Wrap>
        <div className="rx-poster" data-reveal>
          <div className="min-w-0">
            <Heading
              id="community-title"
              eyebrow="built in the open"
              title="Your infrastructure."
              marker="Your platform."
              tone="mint"
              lead="Release safety should be something you can inspect, run and make your own. Alror is open source, from the CLI to the console. Read the code. Shape what comes next."
            />
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Btn href={REPO_URL} tone="ink">
                <GithubLogo /> Explore the source
              </Btn>
              <Sticker tone="paper" tilt={-2}>
                apache-2.0
              </Sticker>
            </div>
          </div>
          <div className="grid gap-3 self-center">
            {LINKS.map((l) => (
              <a key={l.title} href={l.href} target="_blank" rel="noreferrer" className="rx-link-row">
                <l.icon size={18} />
                <span className="min-w-0 flex-1">
                  <strong>{l.title}</strong>
                  <small>{l.body}</small>
                </span>
                <ArrowUpRight size={16} />
              </a>
            ))}
          </div>
        </div>
      </Wrap>
    </section>
  );
}

/* ----------------------------------- FAQ --------------------------------- */

const FAQS = [
  {
    q: "Do I have to replace my CI?",
    a: "No. Alror runs as a step after your build. On GitHub Actions, use the check and deploy actions; anywhere else, run the alror binary. Your build, tests and registry stay as they are.",
  },
  {
    q: "How is the risk score calculated?",
    a: "Alror reads the diff against your base branch: change size, affected services, critical services, sensitive paths, test coverage changes, AI authorship and recent rollbacks. Every point is listed with its reason. You can inspect the rules and tune your policy.",
  },
  {
    q: "What makes a rollout roll back?",
    a: "A stage fails when the canary exceeds your per-metric regression limit and the Mann-Whitney test agrees. Alror compares error rate and latency against the baseline. Start in shadow mode to see its decisions before enabling automatic rollback.",
  },
  {
    q: "Which platforms are supported?",
    a: "Kubernetes through Argo Rollouts, and Amazon ECS in beta. Verification reads Prometheus or Datadog, and notifications go to Slack. GitHub Actions integrates directly; other CI systems can run the CLI.",
  },
  {
    q: "Does my code or data leave my environment?",
    a: "In local mode, nothing phones home: state is stored as JSON under .alror/. In connected mode, the CLI writes deployment events to your self-hosted workspace. Metrics are queried from your network by the CLI or runner.",
  },
  {
    q: "What can I self-host?",
    a: "The CLI, workspace console and runner are part of the open-source platform. Run the CLI on its own or host a workspace for shared policies, deployment history, API keys and an audit log. The repository includes Docker setup instructions.",
  },
];

export function RetroFaq() {
  return (
    <section id="faq" aria-label="Frequently asked questions" className="rx-section">
      <Wrap className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-16">
        <div>
          <Heading eyebrow="a few things to know" title="Good questions." marker="Straight answers." tone="lilac" />
          <a href={`${REPO_URL}/discussions`} target="_blank" rel="noreferrer" className="rx-textlink mt-6">
            Join the discussion <ArrowUpRight size={14} />
          </a>
        </div>
        <div className="grid gap-3" data-reveal>
          {FAQS.map((f) => (
            <details key={f.q} className="rx-faq">
              <summary>
                {f.q}
                <span className="rx-faq-plus" aria-hidden>
                  +
                </span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </Wrap>
    </section>
  );
}

/* ----------------------------------- CTA --------------------------------- */

export function RetroCta() {
  return (
    <section id="install" className="rx-cta" aria-labelledby="cta-title">
      <Wrap className="text-center">
        <Mascot className="rx-cta-mascot" />
        <h2 id="cta-title" className="rx-h1 mx-auto max-w-3xl">
          Your next release.
          <br />
          <mark className="rx-mark rx-bg-lime">A little more fearless.</mark>
        </h2>
        <p className="rx-hero-lead mx-auto">Start with a single change. Build confidence from there.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Btn href={QUICKSTART_URL} size="lg">
            Get started with Alror <ArrowRight size={17} />
          </Btn>
          <Btn href={REPO_URL} size="lg" tone="paper">
            <GithubLogo /> View on GitHub
          </Btn>
        </div>
      </Wrap>
    </section>
  );
}

/* --------------------------------- Footer -------------------------------- */

const COLUMNS = [
  {
    title: "Platform",
    links: [
      { label: "Risk scoring", href: "#risk" },
      { label: "Progressive delivery", href: "#verify" },
      { label: "Workspace console", href: "#console" },
      { label: "Learn", href: "/learn" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Quickstart", href: QUICKSTART_URL },
      { label: "Documentation", href: DOCS_URL },
      { label: "CLI & SDKs", href: "#cli" },
      { label: "Releases", href: `${REPO_URL}/releases` },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: REPO_URL },
      { label: "Contributing", href: `${REPO_URL}/blob/main/CONTRIBUTING.md` },
      { label: "Discussions", href: `${REPO_URL}/discussions` },
      { label: "Security", href: `${REPO_URL}/blob/main/SECURITY.md` },
    ],
  },
];

export function RetroFooter() {
  return (
    <footer className="rx-footer">
      <Marquee tone="lime" items={["open source", "apache-2.0", "made for production", "built in the open", "self-hosted"]} />
      <Wrap className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Brand />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed">The open-source release platform. Built for the way you ship today.</p>
          <span className="rx-badge mt-5">● status: shipping safely</span>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="rx-eyebrow">{c.title}</p>
            <ul className="mt-3 grid gap-2 text-[14px]">
              {c.links.map((l) => (
                <li key={l.label}>
                  <a href={l.href} className="rx-footlink" {...(l.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Wrap>
      <Wrap className="flex flex-wrap justify-between gap-2 border-t-2 border-[var(--rx-ink)] py-5 text-[13px]">
        <p>© {new Date().getFullYear()} Alror</p>
        <p>Built in the open. Made for production.</p>
      </Wrap>
    </footer>
  );
}
