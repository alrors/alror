import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Bot, Minus } from "lucide-react";
import { cn } from "@/lib/site";
import type { StageState } from "@/lib/console/analytics";
import { levelTone, riskTone, statusLabel, statusTone, type Tone } from "@/lib/console/format";
import type { Deployment, Level, Status } from "@/lib/console/types";

export type { StageState };

export const toneBg: Record<Tone, string> = {
  good: "bg-con-good",
  warn: "bg-con-warn",
  bad: "bg-con-bad",
  info: "bg-con-info",
  idle: "bg-con-fg3",
};

export const toneText: Record<Tone, string> = {
  good: "text-con-good",
  warn: "text-con-warn",
  bad: "text-con-bad",
  info: "text-con-info",
  idle: "text-con-fg3",
};

export const toneHex: Record<Tone, string> = {
  good: "#35e08f",
  warn: "#f5a524",
  bad: "#f2555a",
  info: "#3b82f6",
  idle: "#737373",
};

/** 6px static status dot. */
export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", toneBg[tone], className)} />;
}

/** Neutral pill with an optional coloured dot. */
export function Pill({ tone, children, className, title }: { tone?: Tone; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-con-row px-2 text-[12px] font-medium text-con-fg",
        className,
      )}
    >
      {tone && <Dot tone={tone} />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <Pill tone={statusTone(status)} className={className}>
      {statusLabel[status] ?? status}
    </Pill>
  );
}

export function LevelBadge({ level }: { level: Level | undefined }) {
  return (
    <Pill tone={levelTone(level)} className="capitalize">
      {level ?? "unknown"}
    </Pill>
  );
}

export function AiBadge({ compact }: { compact?: boolean }) {
  return (
    <Pill title="AI-authored change" className="gap-1 text-con-fg2">
      <Bot size={12} />
      {compact ? "AI" : "AI-authored"}
    </Pill>
  );
}

/** Risk score: number plus a thin 40px bar. */
export function RiskValue({ score, className }: { score: number; className?: string }) {
  const s = Math.max(0, Math.min(100, score));
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label={`Risk ${score} of 100`}>
      <span className="w-6 text-right font-mono text-[13px] tabular-nums text-con-fg">{score}</span>
      <span className="relative h-1 w-10 overflow-hidden rounded-full bg-con-row">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", toneBg[riskTone(score)])} style={{ width: `${s}%` }} />
      </span>
    </span>
  );
}

export function liveWeight(d: Deployment): number {
  if (d.status === "promoted") return 100;
  if (d.status === "rolled_back" || d.status === "failed") return 0;
  return d.weight;
}

export function TrafficBar({ d, className }: { d: Deployment; className?: string }) {
  const w = liveWeight(d);
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative h-1 w-14 overflow-hidden rounded-full bg-con-row">
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", d.status === "rolling" ? "bg-con-info" : "bg-con-fg3")}
          style={{ width: `${w}%` }}
        />
      </span>
      <span className="w-9 font-mono text-[13px] tabular-nums text-con-fg2">{w}%</span>
    </span>
  );
}

/** Compact row of stage segments for a rollout plan. */
export function StagePips({ states, weights, size = "sm" }: { states: StageState[]; weights?: number[]; size?: "sm" | "lg" }) {
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      aria-label={`${states.filter((s) => s === "pass").length} of ${states.length} stages passed`}
    >
      {states.map((s, i) => (
        <span
          key={i}
          title={weights ? `${weights[i]}% · ${s}` : s}
          className={cn(
            "rounded-[2px]",
            size === "lg" ? "h-1.5 w-10" : "h-1 w-3.5",
            s === "pass" && "bg-con-fg2",
            s === "fail" && "bg-con-bad",
            s === "active" && "bg-con-info",
            s === "pending" && "bg-con-line-hover",
            s === "skipped" && "bg-con-row",
          )}
        />
      ))}
    </span>
  );
}

export function Card({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
  flush,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (tables, lists). */
  flush?: boolean;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-con-line bg-con-panel", className)}>
      {(title || aside) && (
        <header
          className={cn(
            "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4",
            flush ? "border-b border-con-line pb-4" : "pb-1",
          )}
        >
          <div className="min-w-0">
            {typeof title === "string" ? <h2 className="text-[15px] font-semibold text-con-fg">{title}</h2> : title}
            {description && <p className="mt-0.5 text-[13px] text-con-fg2">{description}</p>}
          </div>
          {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
        </header>
      )}
      <div className={cn("min-w-0 flex-1", !flush && "px-5 pb-5 pt-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {meta && <div className="mb-2 flex flex-wrap items-center gap-2">{meta}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-con-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[14px] text-con-fg2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Link-based segmented control; works without client JS. */
export function Segmented({ items, active }: { items: { label: string; href: string; value: string }[]; active: string }) {
  return (
    <div className="inline-flex h-8 items-center rounded-md border border-con-line p-0.5" role="tablist">
      {items.map((it) => (
        <Link
          key={it.value}
          href={it.href}
          role="tab"
          aria-selected={it.value === active}
          scroll={false}
          className={cn(
            "inline-flex h-full items-center rounded-[4px] px-2.5 text-[13px] transition-colors duration-150",
            it.value === active ? "bg-con-row text-con-fg" : "text-con-fg3 hover:text-con-fg",
          )}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex h-8 items-center justify-center gap-2 rounded-md bg-con-fg px-3 text-[13px] font-medium text-black transition-colors duration-150 hover:bg-white disabled:opacity-60",
  secondary:
    "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-con-line-hover px-3 text-[13px] font-medium text-con-fg transition-colors duration-150 hover:bg-con-hover disabled:opacity-60",
  danger:
    "inline-flex h-8 items-center justify-center gap-2 rounded-md border border-con-bad/40 px-3 text-[13px] font-medium text-con-bad transition-colors duration-150 hover:border-con-bad/70 hover:bg-con-bad/[0.06] disabled:opacity-60",
};

/**
 * Change vs the previous period. `goodWhen` says which direction is an improvement;
 * "neutral" metrics show the arrow without a verdict colour.
 */
export function Delta({ value, goodWhen, suffix = "vs prev." }: { value: number | null; goodWhen: "up" | "down" | "neutral"; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[13px] text-con-fg3">No prior data</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const good = goodWhen === "neutral" || flat ? null : (goodWhen === "up") === up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-mono tabular-nums",
          good === null ? "text-con-fg2" : good ? "text-con-good" : "text-con-bad",
        )}
      >
        <Icon size={14} strokeWidth={2} />
        {Math.abs(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%
      </span>
      <span className="text-con-fg3">{suffix}</span>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-[14px] font-medium text-con-fg">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-[13px] text-con-fg2">{children}</div>}
    </div>
  );
}

/** Label/value row used in summary panels. */
export function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-con-fg2">{label}</dt>
      <dd className={cn("min-w-0 text-right text-[14px] text-con-fg", mono && "break-all font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

export const tableHead = "h-10 px-4 text-left text-[12px] font-medium uppercase text-con-fg3 first:pl-5 last:pr-5 whitespace-nowrap";
export const tableCell = "h-12 px-4 align-middle first:pl-5 last:pr-5";

/* ---------------------------------- Forms ---------------------------------- */

export const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-con-line bg-con-bg px-2.5 text-[13px] text-con-fg outline-none transition-colors duration-150 placeholder:text-con-fg3 focus-visible:border-con-line-hover disabled:text-con-fg3 aria-[invalid=true]:border-con-bad/60";
export const selectClass =
  "h-8 rounded-md border border-con-line bg-con-bg px-2 text-[13px] text-con-fg outline-none transition-colors duration-150 focus-visible:border-con-line-hover disabled:text-con-fg3";
export const labelClass = "block text-[13px] text-con-fg2";
export const hintClass = "text-[12px] text-con-fg3";

/** Label + control + hint/error, stacked. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? <p className="text-[12px] text-con-bad">{error}</p> : hint ? <p className={hintClass}>{hint}</p> : null}
    </div>
  );
}

/** Inline result line for an action: error in red, success in the neutral foreground. */
export function FormStatus({ error, message, className }: { error?: string; message?: string; className?: string }) {
  return (
    <div aria-live="polite" className={cn("text-[12px]", className)}>
      {error ? <p className="text-con-bad">{error}</p> : message ? <p className="text-con-fg2">{message}</p> : null}
    </div>
  );
}

// Pages a member cannot use render <AccessDenied> (src/components/console/access-denied.tsx).
