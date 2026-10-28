// Weekly impact: counts computed from stored outcomes for a stated window. A number
// is only shown when there is something to count; otherwise the tile says so.

import Link from "next/link";
import { span } from "@/lib/console/format";
import type { Impact } from "@/lib/console/oversight";
import { cn } from "@/lib/site";

type Accent = "mint" | "lilac" | "butter" | "sky";
type Tile = { label: string; value: string | null; detail: string; empty: string; href?: string; emptyHref?: string; accent: Accent };

/** Category colour per tile: top stripe, label dot and value. */
const ACCENT: Record<Accent, { stripe: string; dot: string; value: string }> = {
  mint: { stripe: "[--con-accent:var(--color-con-accent-mint)]", dot: "bg-con-accent-mint", value: "text-con-brand-text" },
  lilac: { stripe: "[--con-accent:var(--color-con-accent-lilac)]", dot: "bg-con-accent-lilac", value: "text-con-accent-lilac-soft" },
  butter: { stripe: "[--con-accent:var(--color-con-accent-butter)]", dot: "bg-con-accent-butter", value: "text-con-accent-butter-soft" },
  sky: { stripe: "[--con-accent:var(--color-con-accent-sky)]", dot: "bg-con-accent-sky", value: "text-con-accent-sky-soft" },
};

function Tile({ t }: { t: Tile }) {
  const a = ACCENT[t.accent];
  const body = (
    <>
      <p className="flex items-center gap-1.5 text-[12px] text-con-fg2">
        <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", a.dot)} />
        {t.label}
      </p>
      {t.value === null ? (
        <p className="mt-2 text-[13px] text-con-fg3">{t.empty}</p>
      ) : (
        <>
          <p className={cn("mt-1.5 font-mono text-[26px] leading-none tracking-tight tabular-nums", a.value)}>{t.value}</p>
          <p className="mt-2 text-[12px] leading-snug text-con-fg3">{t.detail}</p>
        </>
      )}
    </>
  );
  const href = t.value === null ? t.emptyHref : t.href;
  const cls = cn("con-surface con-accent-top block min-w-0 rounded-lg border border-con-line bg-con-panel px-4 py-3.5", a.stripe);
  return href ? (
    <Link href={href} className={cn(cls, "con-ease hover:border-con-line-hover")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function WeeklyImpact({ impact, label }: { impact: Impact; label: string }) {
  const gh = impact.prsEvaluated !== null;
  const noReleases = impact.finished === 0;
  const tiles: Tile[] = [
    {
      label: "Bad releases stopped",
      value: noReleases ? null : String(impact.stopped),
      detail: `rolled back automatically, of ${impact.finished} finished release${impact.finished === 1 ? "" : "s"}`,
      empty: "No data yet: no releases finished",
      href: "/app/deployments?status=rolled_back",
      accent: "mint",
    },
    {
      label: "PRs auto-merged",
      value: !gh || impact.prsEvaluated === 0 ? null : String(impact.prsAutoMerged),
      detail: `of ${impact.prsEvaluated} pull request${impact.prsEvaluated === 1 ? "" : "s"} the gate evaluated`,
      empty: gh ? "No data yet: no pull requests evaluated" : "GitHub not connected",
      href: "/app/github",
      emptyHref: "/app/github",
      accent: "lilac",
    },
    {
      label: "PRs routed to review",
      value: !gh || impact.prsEvaluated === 0 ? null : String(impact.prsRouted),
      detail: "sent to a person by an enforcing gate",
      empty: gh ? "No data yet: no pull requests evaluated" : "GitHub not connected",
      href: "/app/github",
      emptyHref: "/app/github",
      accent: "butter",
    },
    {
      label: "Rollbacks · time to restore",
      value: noReleases ? null : impact.rollbacks === 0 ? "0" : `${impact.rollbacks} · ${span(impact.restoreMs)}`,
      detail: impact.rollbacks === 0 ? "no rollbacks or failed rollouts" : "median from release start to traffic back on stable",
      empty: "No data yet: no releases finished",
      href: "/app/insights",
      accent: "sky",
    },
  ];
  return (
    <section aria-labelledby="impact-heading" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="impact-heading" className="text-[14px] font-semibold tracking-[-0.01em] text-con-fg">
          Impact
        </h2>
        <p className="text-[12px] text-con-fg3">Computed from stored outcomes, {label}</p>
      </div>
      <div className="con-stagger grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {tiles.map((t) => (
          <Tile key={t.label} t={t} />
        ))}
      </div>
    </section>
  );
}
