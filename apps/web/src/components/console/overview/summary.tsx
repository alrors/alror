import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CircleCheck,
  CircleHelp,
  GitPullRequest,
  Layers,
  Rocket,
  ShieldCheck,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import type { Deployment } from "@/lib/console/types";
import { CountUp } from "../count-up";

export function OverviewSummary({
  releases,
  live,
  attention,
  rangeLabel,
}: {
  releases: Deployment[];
  live: number;
  attention: number;
  rangeLabel: string;
}) {
  const promoted = releases.filter((d) => d.status === "promoted").length;
  const finished = releases.filter((d) =>
    ["promoted", "rolled_back", "failed"].includes(d.status),
  ).length;
  const cards = [
    {
      label: "Releases",
      value: releases.length,
      hint: rangeLabel,
      icon: Rocket,
      href: "/app/deployments",
      tone: "neutral",
    },
    {
      label: "Successfully released",
      value: finished ? (promoted / finished) * 100 : null,
      suffix: "%",
      hint: finished
        ? `${promoted} of ${finished} completed releases`
        : "Waiting for your first result",
      icon: CircleCheck,
      href: "/app/deployments?status=promoted",
      tone: "good",
    },
    {
      label: "In progress",
      value: live,
      hint: live
        ? "Releasing to more traffic in stages"
        : "No releases in progress",
      icon: Layers,
      href: "#live-releases",
      tone: "info",
    },
    {
      label: "Needs a look",
      value: attention,
      hint: attention
        ? "Release and job events to review"
        : "No attention items right now",
      icon: attention ? TriangleAlert : ShieldCheck,
      href: "#attention",
      tone: attention ? "warn" : "good",
    },
  ];
  return (
    <section className="dash-summary" aria-label="Workspace at a glance">
      {cards.map((c) => (
        <Link
          key={c.label}
          href={c.href}
          className="dash-stat"
          data-tone={c.tone}
        >
          <div className="dash-stat-label">
            <span>{c.label}</span>
            <c.icon size={16} strokeWidth={1.6} aria-hidden />
          </div>
          <strong>
            {c.value === null ? (
              <span aria-label="No completed releases">—</span>
            ) : (
              <CountUp
                value={c.value}
                decimals={c.suffix ? 1 : 0}
                suffix={c.suffix}
              />
            )}
          </strong>
          <div className="dash-stat-caption">
            <span>{c.hint}</span>
            <ArrowUpRight size={13} aria-hidden />
          </div>
        </Link>
      ))}
    </section>
  );
}

export function WorkspaceGuide({
  docsUrl,
  admin,
}: {
  docsUrl: string;
  admin: boolean;
}) {
  return (
    <aside className="dash-guide" aria-labelledby="workspace-guide-title">
      <div className="dash-guide-heading">
        <span className="dash-guide-icon">
          <BookOpen size={18} />
        </span>
        <div>
          <span className="dash-eyebrow">A little guidance</span>
          <h2 id="workspace-guide-title">Make yourself at home.</h2>
        </div>
      </div>
      <p>
        From your first service to your next release. Everything you need to
        find your way.
      </p>
      <nav aria-label="Workspace guidance">
        <Link href="/app/onboarding">
          <Terminal size={16} />
          <span>
            <strong>Connect your workflow</strong>
            <small>Set up the CLI and your first release</small>
          </span>
          <ArrowRight size={14} />
        </Link>
        <Link href={admin ? "/app/policies" : "/app/services"}>
          <ShieldCheck size={16} />
          <span>
            <strong>
              {admin ? "Set your safety rules" : "Explore your services"}
            </strong>
            <small>
              {admin
                ? "Choose when to pause or roll back"
                : "See what's running and its release history"}
            </small>
          </span>
          <ArrowRight size={14} />
        </Link>
        <a href={docsUrl} target="_blank" rel="noreferrer">
          <GitPullRequest size={16} />
          <span>
            <strong>Explore the documentation</strong>
            <small>Go deeper when you&apos;re ready</small>
          </span>
          <ArrowUpRight size={14} />
        </a>
      </nav>
      <details className="dash-glossary">
        <summary>
          <CircleHelp size={14} />
          New to progressive delivery?<span>+</span>
        </summary>
        <dl>
          <dt>Service</dt>
          <dd>An application or worker you deploy independently.</dd>
          <dt>Canary</dt>
          <dd>
            A new version receiving a small share of traffic before a wider
            release.
          </dd>
          <dt>Promoted</dt>
          <dd>A release that passed verification and reached all traffic.</dd>
          <dt>Rollback</dt>
          <dd>Returning traffic to the previous version after a regression.</dd>
          <dt>Runner</dt>
          <dd>
            The process in your infrastructure that executes queued deployments.
          </dd>
        </dl>
      </details>
    </aside>
  );
}
