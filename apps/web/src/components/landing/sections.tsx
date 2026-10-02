import Image from "next/image";
import { ArrowRight, ArrowUpRight, Check, Minus, Plus } from "lucide-react";
import { Button, Container, Eyebrow, Section, SectionHeader } from "../ui";
import { Logo } from "../navbar";
import { GithubLogo } from "./brand-logos";
import { InstallCommand, REPO_URL } from "./install";

export const DOCS_URL = process.env.NEXT_PUBLIC_ALROR_DOCS_URL ?? "http://127.0.0.1:4100";

/* ---------- Comparison ---------- */

type Cell = true | false | "partial" | string;

const rows: { label: string; us: Cell; suite: Cell; diy: Cell }[] = [
  { label: "Risk score on every pull request, with reasons", us: true, suite: false, diy: false },
  { label: "Canary size and bake time set by the risk", us: true, suite: "partial", diy: false },
  { label: "Signal for AI-authored changes", us: true, suite: false, diy: false },
  { label: "Statistical verification at every stage", us: "Mann-Whitney U + effect size", suite: true, diy: "partial" },
  { label: "Automatic rollback with a plain-English reason", us: true, suite: true, diy: "partial" },
  { label: "Keeps your existing CI", us: true, suite: "partial", diy: true },
  { label: "Open-source engine", us: "Apache-2.0", suite: false, diy: "Varies" },
  { label: "What you operate", us: "A CI step, optional runner", suite: "Their control plane", diy: "All of it" },
];

function Mark({ v, strong }: { v: Cell; strong?: boolean }) {
  if (v === true) return <Check className={strong ? "h-4 w-4 text-[#35e08f]" : "h-4 w-4 text-[#a3a3ad]"} strokeWidth={2.25} aria-label="Yes" />;
  if (v === false) return <span className="text-[#3a3a42]" aria-label="No">—</span>;
  if (v === "partial") return <Minus className="h-4 w-4 text-[#6e6e78]" aria-label="Partly" />;
  return <span className={strong ? "text-fg" : "text-[#a3a3ad]"}>{v}</span>;
}

export function Compare() {
  return (
    <Section id="compare" label="Comparison">
      <SectionHeader
        eyebrow="06 · Compare"
        title="Release safety without"
        muted="a platform migration."
        lead="Enterprise delivery suites verify rollouts but treat every change the same. DIY scripts rarely verify at all. Alror starts from the change itself."
      />
      <div className="lp-scroll mt-14 overflow-x-auto" data-reveal>
        <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
          <caption className="sr-only">Alror compared with enterprise delivery suites and DIY GitOps</caption>
          <thead>
            <tr className="border-b border-[#1d1d22]">
              <th scope="col" className="w-[38%] py-4 pr-4 font-normal" />
              <th scope="col" className="rounded-t-xl border-x border-t border-[#24242a] bg-[#0e0e11] px-5 py-4 text-[14px] font-semibold text-fg">
                Alror
              </th>
              <th scope="col" className="px-5 py-4 font-normal text-[#a3a3ad]">Enterprise delivery suites</th>
              <th scope="col" className="px-5 py-4 font-normal text-[#a3a3ad]">DIY scripts and GitOps</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className="border-b border-[#16161a]">
                <th scope="row" className="py-3.5 pr-4 font-normal text-[#a3a3ad]">
                  {r.label}
                </th>
                <td
                  className={`border-x border-[#24242a] bg-[#0e0e11] px-5 py-3.5 ${i === rows.length - 1 ? "rounded-b-xl border-b" : ""}`}
                >
                  <Mark v={r.us} strong />
                </td>
                <td className="px-5 py-3.5">
                  <Mark v={r.suite} />
                </td>
                <td className="px-5 py-3.5">
                  <Mark v={r.diy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/* ---------- Trust ---------- */

const principles = [
  {
    title: "Every point has a name",
    body: "The score is rule-based: each point comes from a named factor you can read and argue with. Language models never decide the score or a rollback.",
  },
  {
    title: "Statistics, not a hunch",
    body: "A stage fails only when the canary regresses past its limit and the Mann-Whitney test agrees (p < α). Start in shadow mode to see what it would do.",
  },
  {
    title: "Runs where your deploys run",
    body: "The CLI and alror runner reach your cluster and metrics from your own network. The workspace never queries your metrics, and Datadog keys stay in your environment.",
  },
  {
    title: "Boring, readable state",
    body: "In local mode every deployment and event is a plain JSON file under .alror/ and nothing phones home. Connected mode writes to your self-hosted workspace through a scoped API key.",
  },
];

export function Trust() {
  return (
    <Section id="trust" label="Design principles">
      <SectionHeader
        eyebrow="07 · By design"
        title="You are handing it production."
        muted="So nothing is a black box."
      />
      <div className="mt-14 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <figure className="lp-panel overflow-hidden rounded-2xl" data-reveal>
          <div className="relative aspect-[4/3] lg:aspect-auto lg:h-full lg:min-h-[420px]">
            <Image
              src="/generated/datacenter.webp"
              alt="Halftone photograph: a lone engineer walking down a long data centre aisle between server racks"
              fill
              sizes="(min-width: 1024px) 600px, 100vw"
              className="object-cover"
            />
            <figcaption className="absolute inset-x-0 bottom-0 flex justify-between gap-4 bg-gradient-to-t from-black/85 to-transparent px-4 pt-12 pb-3 text-[12.5px] text-[#d4d4d8]">
              <span>Production is vast. Alror&apos;s reach into it is deliberately small.</span>
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-[#a3a3ad] sm:block">Fig. 02</span>
            </figcaption>
          </div>
        </figure>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {principles.map((p, i) => (
            <div key={p.title} className="lp-panel rounded-2xl p-6" data-reveal style={{ ["--reveal-delay" as string]: `${i * 70}ms` }}>
              <p className="font-mono text-[11px] text-[#55555e]">{String(i + 1).padStart(2, "0")}</p>
              <h3 className="mt-3 text-[16px] font-medium text-fg">{p.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#a3a3ad]">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Pricing ---------- */

const plans = [
  {
    name: "Free",
    price: "$0",
    unit: "for small teams getting started",
    cta: { label: "Create a workspace", href: "/signup" },
    limits: ["3 deploying services", "200 deploys a month", "3 seats"],
  },
  {
    name: "Team",
    price: "$30",
    unit: "per deploying service a month",
    cta: { label: "Start with Team", href: "/signup" },
    featured: true,
    limits: ["Up to 25 deploying services", "2,000 deploys a month", "25 seats"],
  },
  {
    name: "Business",
    price: "$60",
    unit: "per deploying service a month",
    cta: { label: "Start with Business", href: "/signup" },
    limits: ["Up to 200 deploying services", "20,000 deploys a month", "250 seats"],
  },
];

const everyPlan = [
  "Risk check and sticky comment on every PR",
  "Risk-sized canary rollouts",
  "Verification at every stage",
  "Automatic rollback, unlimited",
  "Console, runner and marketplace",
  "Policies, API keys and audit log",
];

export function Pricing() {
  return (
    <Section id="pricing" label="Pricing">
      <SectionHeader
        eyebrow="08 · Pricing"
        title="Priced in public."
        muted="Pay for services you deploy."
        lead="A deploying service is one with at least one production deploy in the month. Every plan runs the full engine; plans differ only in scale."
      />
      <div className="mt-14 grid gap-4 lg:grid-cols-3">
        {plans.map((p, i) => (
          <div
            key={p.name}
            className={`flex flex-col rounded-2xl p-6 ${p.featured ? "lp-panel-2" : "lp-panel"}`}
            data-reveal
            style={{ ["--reveal-delay" as string]: `${i * 70}ms` }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-medium text-fg">{p.name}</h3>
              {p.featured && (
                <span className="rounded-full border border-[#2f2f37] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#a3a3ad]">
                  Most teams
                </span>
              )}
            </div>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="text-[44px] font-semibold leading-none tracking-[-0.04em] text-fg">{p.price}</span>
              <span className="text-[13px] text-[#6e6e78]">{p.unit}</span>
            </p>
            <ul className="mt-6 space-y-2.5 border-t border-[#1d1d22] pt-6 text-[14px]">
              {p.limits.map((l) => (
                <li key={l} className="flex items-center gap-2.5 text-[#d4d4d8]">
                  <Check className="h-4 w-4 shrink-0 text-[#6e6e78]" aria-hidden />
                  {l}
                </li>
              ))}
            </ul>
            <Button href={p.cta.href} variant={p.featured ? "primary" : "secondary"} size="md" className="mt-8 w-full">
              {p.cta.label}
            </Button>
          </div>
        ))}
      </div>
      <div className="lp-panel mt-4 grid gap-6 rounded-2xl p-6 lg:grid-cols-[1fr_2fr] lg:items-center" data-reveal>
        <div>
          <h3 className="text-[15px] font-medium text-fg">Included in every plan</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#6e6e78]">
            The workspace is self-hosted and runs the same engine as the CLI. The CLI and SDKs are free and open source.
          </p>
        </div>
        <ul className="grid gap-x-6 gap-y-2.5 text-[13.5px] text-[#a3a3ad] sm:grid-cols-2">
          {everyPlan.map((f) => (
            <li key={f} className="flex items-center gap-2.5">
              <Check className="h-3.5 w-3.5 shrink-0 text-[#35e08f]" aria-hidden />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* ---------- FAQ ---------- */

const faqs = [
  {
    q: "Do I have to replace my CI?",
    a: "No. Alror runs as a step after your build. On GitHub Actions use the check and deploy actions; anywhere else, run the alror binary. Your build, tests and registry stay as they are.",
  },
  {
    q: "How is the risk score calculated?",
    a: "From the diff against your base branch: size of the change, how many services it touches, whether a service is marked critical, sensitive paths (auth, payment, migrations, IAM and similar), whether tests changed, AI authorship and recent rollbacks on the same services. Every point is listed with its reason, and the total is capped at 100.",
  },
  {
    q: "How do you know a change is AI-authored?",
    a: "From commit authors and trailers your tools already add, such as bot authors or a Co-authored-by line naming a coding agent. It adds 10 points to the score and never blocks a change on its own.",
  },
  {
    q: "What if it rolls back a good release?",
    a: "A stage fails only when the canary is worse than the per-metric limit and the Mann-Whitney test is significant at your α, which keeps false rollbacks rare. Limits and α live in your policy, and shadow mode records recommendations without acting.",
  },
  {
    q: "Which platforms are supported?",
    a: "Kubernetes through Argo Rollouts, and Amazon ECS in beta. Verification reads Prometheus or Datadog; notifications go to Slack. AWS Lambda, Cloud Run, PagerDuty, Opsgenie and GitLab CI are planned; vote for them in the marketplace.",
  },
  {
    q: "Does my code or data leave my environment?",
    a: "In local mode nothing phones home: state is JSON files under .alror/. In connected mode the CLI writes deployments and events to your own self-hosted workspace. Metrics are queried from your network by the CLI or runner, never by the workspace.",
  },
  {
    q: "What is the difference between the CLI and the workspace?",
    a: "The CLI is the engine: risk scoring, rollouts, verification and rollback. The workspace adds the console, a shared policy, API keys, an audit log and alror runner, which runs deploys and rollbacks queued from the console inside your infrastructure.",
  },
];

export function FAQ() {
  return (
    <Section id="faq" label="Frequently asked questions">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.7fr] lg:gap-16">
        <div data-reveal>
          <Eyebrow>09 · FAQ</Eyebrow>
          <h2 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[44px]">
            Questions, <span className="text-[#6e6e78]">answered.</span>
          </h2>
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-[#a3a3ad]">
            Something else? The full documentation ships with the CLI: run <code className="font-mono text-[#d4d4d8]">alror docs --open</code>.
          </p>
        </div>
        <div className="border-t border-[#1d1d22]" data-reveal>
          {faqs.map((f, i) => (
            <details key={f.q} className="group border-b border-[#1d1d22]" open={i === 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-sm py-5 text-[15.5px] font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60">
                {f.q}
                <Plus className="h-4 w-4 shrink-0 text-[#6e6e78] transition-transform duration-200 group-open:rotate-45" aria-hidden />
              </summary>
              <p className="pb-6 pr-8 text-[14.5px] leading-relaxed text-[#a3a3ad]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ---------- Final CTA ---------- */

export function FinalCTA() {
  return (
    <section id="install" aria-labelledby="cta-title" className="lp-rule scroll-mt-20 py-24 sm:py-32">
      <Container>
        <div className="lp-panel grid overflow-hidden rounded-3xl lg:grid-cols-[1.15fr_1fr]" data-reveal>
          <div className="p-7 sm:p-12">
            <Eyebrow>Get started</Eyebrow>
            <h2 id="cta-title" className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-fg sm:text-[44px]">
              Put a gate between merge <span className="text-[#6e6e78]">and production.</span>
            </h2>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[#a3a3ad]">
              Score your current change in a minute. No infrastructure needed: targets and metrics are simulated until you connect yours.
            </p>
            <InstallCommand className="mt-8 max-w-xl" />
            <div className="mt-6 flex flex-wrap gap-3">
              <Button href="/app" size="lg">
                Open the console
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button href={REPO_URL} size="lg" variant="secondary" external>
                <GithubLogo />
                GitHub
              </Button>
              <Button href={DOCS_URL} size="lg" variant="ghost" external>
                Read the docs
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
          <figure className="relative min-h-[280px] border-t border-[#1d1d22] lg:border-t-0 lg:border-l">
            <Image
              src="/generated/pipeline.webp"
              alt="Halftone photograph: cables and pipes converging on one industrial gate, an engineer inspecting it"
              fill
              sizes="(min-width: 1024px) 520px, 100vw"
              className="object-cover"
            />
            <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-5 pt-12 pb-4 text-[12.5px] text-[#d4d4d8]">
              Every change, from every pipeline, through one gate.
            </figcaption>
          </figure>
        </div>
      </Container>
    </section>
  );
}

/* ---------- Footer ---------- */

const cols = [
  {
    title: "Product",
    links: [
      { label: "Risk scoring", href: "#risk" },
      { label: "Verification", href: "#verify" },
      { label: "Console", href: "#console" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Install", href: "#install" },
      { label: "Documentation", href: DOCS_URL, external: true },
      { label: "GitHub", href: REPO_URL, external: true },
      { label: "Releases", href: `${REPO_URL}/releases`, external: true },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "License (Apache-2.0)", href: `${REPO_URL}/blob/main/LICENSE`, external: true },
      { label: "Security policy", href: `${REPO_URL}/blob/main/SECURITY.md`, external: true },
      { label: "Contributing", href: `${REPO_URL}/blob/main/CONTRIBUTING.md`, external: true },
      { label: "Sign in", href: "/login" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="lp-rule py-14">
      <Container>
        <div className="grid gap-10 md:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-[#6e6e78]">
              The release gate between merge and production. Scored, verified, reversible.
            </p>
          </div>
          {cols.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="text-[13px] font-medium text-fg">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...("external" in l && l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                      className="text-[13.5px] text-[#a3a3ad] transition-colors hover:text-fg"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-14 flex flex-col justify-between gap-3 border-t border-[#1d1d22] pt-6 text-[12px] text-[#6e6e78] sm:flex-row">
          <p>© 2026 Alror</p>
          <p>Third-party logos are trademarks of their owners.</p>
        </div>
      </Container>
    </footer>
  );
}
