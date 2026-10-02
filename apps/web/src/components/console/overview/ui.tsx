// Small server-safe building blocks shared by the Overview widgets.

import Link from "next/link";
import { cn } from "@/lib/site";
import { InfoTip } from "./float";

export { InfoTip };

/** Density-aware paddings: the board's wrapper carries data-density (see OverviewFrame). */
export const PAD_X = "px-5 group-data-[density=compact]/ov:px-4";
export const PAD = "px-5 pb-5 pt-3 group-data-[density=compact]/ov:px-4 group-data-[density=compact]/ov:pb-3.5 group-data-[density=compact]/ov:pt-2";
export const GAP = "gap-5 group-data-[density=compact]/ov:gap-3";
export const STACK = "space-y-5 group-data-[density=compact]/ov:space-y-3";

/** Compact 28px button base for inline row actions. */
export const SMALL_BUTTON =
  "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover disabled:opacity-60";
export const GHOST_BUTTON = "border border-con-line text-con-fg2 hover:border-con-line-hover hover:bg-con-hover hover:text-con-fg";

/** A board widget: compact header (title, optional tip, right side) and a body. */
export function Panel({
  title,
  tip,
  tipAlign,
  aside,
  children,
  className,
  bodyClassName,
  flush,
  widget,
  label,
}: {
  title: React.ReactNode;
  tip?: React.ReactNode;
  tipAlign?: "start" | "center" | "end";
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (lists that run edge to edge). */
  flush?: boolean;
  /** Widget id for the Customize menu. */
  widget?: string;
  label?: string;
}) {
  return (
    <section data-widget={widget} aria-label={label} className={cn("flex min-w-0 flex-col rounded-lg border border-con-line bg-con-panel", className)}>
      <header className={cn("flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pb-1 pt-3", PAD_X, "group-data-[density=compact]/ov:min-h-10 group-data-[density=compact]/ov:pt-2.5")}>
        <div className="flex min-w-0 items-center gap-1">
          {typeof title === "string" ? <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-con-fg">{title}</h2> : title}
          {tip && (
            <InfoTip label={typeof title === "string" ? title : "this panel"} align={tipAlign ?? "start"}>
              {tip}
            </InfoTip>
          )}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </header>
      <div className={cn("min-w-0 flex-1", !flush && PAD, bodyClassName)}>{children}</div>
    </section>
  );
}

/** Quiet "View all" style link for panel headers. */
export function PanelLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  const cls = "con-ease rounded px-1 text-[12px] text-con-fg3 outline-none hover:text-con-fg focus-visible:ring-1 focus-visible:ring-con-line-hover";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Small mono count badge. */
export function Count({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-con-row px-1.5 font-mono text-[11px] tabular-nums text-con-fg2", className)}>{children}</span>;
}
