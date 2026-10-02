import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  GitPullRequest,
  Plus,
  Scale,
  Server,
} from "lucide-react";
import { Button, Container, Eyebrow, Section } from "../ui";
import { Logo, LogoMark } from "../navbar";
import { GithubLogo } from "./brand-logos";
import { DOCS_URL, QUICKSTART_URL, REPO_URL } from "./links";

const faqs = [
  {
    q: "Do I have to replace my CI?",
    a: "No. Alror runs as a step after your build. On GitHub Actions, use the check and deploy actions; anywhere else, run the alror binary. Your build, tests, and registry stay as they are.",
  },
  {
    q: "How is the risk score calculated?",
    a: "Alror reads the diff against your base branch: change size, affected services, critical services, sensitive paths, test coverage changes, AI authorship, and recent rollbacks. Every point is listed with its reason. You can inspect the rules and tune your policy.",
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
    a: "The CLI, workspace console, and runner are part of the open-source platform. Run the CLI on its own or host a workspace for shared policies, deployment history, API keys, and an audit log. The repository includes Docker setup instructions.",
  },
];

export function OpenSource() {
  return (
    <section
      id="open-source"
      className="lp-community lp-rule"
      aria-labelledby="community-title"
    >
      <Container>
        <div className="lp-community-card" data-reveal>
          <div>
            <Eyebrow>Built in the open</Eyebrow>
            <h2 id="community-title">
              Your infrastructure.
              <br />
              <span>Your platform.</span>
            </h2>
            <p>
              Release safety should be something you can inspect, run, and make
              your own. Alror is open source, from the CLI to the console. Read
              the code. Shape what comes next.
            </p>
            <div className="lp-community-actions">
              <Button href={REPO_URL} external variant="secondary" size="md">
                <GithubLogo /> Explore the source <ArrowUpRight size={13} />
              </Button>
              <span className="lp-footer-license">
                <Scale size={13} />
                Apache-2.0
              </span>
            </div>
          </div>
          <div className="lp-community-links">
            <a
              href={`${REPO_URL}/blob/main/docker/README.md`}
              target="_blank"
              rel="noreferrer"
            >
              <Server />
              <span>
                <strong>Run it on your terms</strong>
                <small>Self-host the workspace in your infrastructure.</small>
              </span>
              <ArrowUpRight />
            </a>
            <a
              href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}
              target="_blank"
              rel="noreferrer"
            >
              <GitPullRequest />
              <span>
                <strong>Build with us</strong>
                <small>Your first issue. Your next pull request.</small>
              </span>
              <ArrowUpRight />
            </a>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              <BookOpen />
              <span>
                <strong>Understand every decision</strong>
                <small>Explore the engine, policies, and architecture.</small>
              </span>
              <ArrowUpRight />
            </a>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function FAQ() {
  return (
    <Section id="faq" label="Frequently asked questions">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-20">
        <div data-reveal>
          <Eyebrow>A few things to know</Eyebrow>
          <h2 className="mt-4 text-[36px] font-medium leading-[1.12] tracking-[-0.045em] sm:text-[44px]">
            Good questions.
            <br />
            <span className="text-[#7c8a80]">Straight answers.</span>
          </h2>
          <p className="mt-5 max-w-xs text-sm leading-7 text-[#9ca79f]">
            Dig into the details, or start a conversation with the project.
          </p>
          <a
            href={`${REPO_URL}/discussions`}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 text-xs text-[#b1cbbb]"
          >
            Join the discussion <ArrowUpRight size={13} />
          </a>
        </div>
        <div className="border-t border-[#253128]" data-reveal>
          {faqs.map((f) => (
            <details key={f.q} className="group border-b border-[#253128]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[14px] font-medium text-[#dce4df]">
                {f.q}
                <Plus
                  className="h-4 w-4 shrink-0 text-[#8da295] transition-transform group-open:rotate-45"
                  aria-hidden
                />
              </summary>
              <p className="pb-6 pr-6 text-[13px] leading-7 text-[#9ca79f]">
                {f.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FinalCTA() {
  return (
    <section
      id="install"
      className="lp-final lp-rule"
      aria-labelledby="cta-title"
    >
      <LogoMark />
      <h2 id="cta-title">
        Your next release.
        <br />
        <span>A little more fearless.</span>
      </h2>
      <p>Start with a single change. Build confidence from there.</p>
      <div className="lp-hero-actions">
        <Button
          href={QUICKSTART_URL}
          external
          size="lg"
          className="lp-button-accent"
        >
          Get started with Alror <ArrowRight size={15} />
        </Button>
        <Button href={REPO_URL} external size="lg" variant="secondary">
          <GithubLogo /> View on GitHub
        </Button>
      </div>
    </section>
  );
}

const columns = [
  {
    title: "Platform",
    links: [
      { label: "Risk scoring", href: "#risk" },
      { label: "Progressive delivery", href: "#verify" },
      { label: "Workspace console", href: "#console" },
      { label: "Open source", href: "#open-source" },
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

export function Footer() {
  return (
    <footer className="lp-footer lp-rule">
      <Container>
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <Logo />
            <p>
              The open-source release platform.
              <br />
              Built for the way you ship today.
            </p>
            <a
              className="lp-footer-license"
              href={`${REPO_URL}/blob/main/LICENSE`}
              target="_blank"
              rel="noreferrer"
            >
              <Code2 size={13} /> Open source · Apache-2.0
            </a>
          </div>
          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p>{col.title}</p>
              <ul>
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.href.startsWith("http")
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="lp-footer-bottom">
          <p>© {new Date().getFullYear()} Alror</p>
          <p>Built in the open. Made for production.</p>
        </div>
      </Container>
    </footer>
  );
}
