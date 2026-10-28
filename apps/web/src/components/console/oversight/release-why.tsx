// "Why this outcome": the deciding verdict and the evidence behind it, from stored events.

import { Dot } from "@/components/console/primitives";
import type { ReleaseWhy } from "@/lib/console/oversight";
import { cn } from "@/lib/site";

const BORDER: Record<ReleaseWhy["tone"], string> = {
  good: "border-con-good-edge",
  info: "border-con-info-edge",
  idle: "border-con-line",
  warn: "border-con-warn-edge",
  bad: "border-con-bad-edge",
};

/** Thin tone stripe along the top edge. */
const ACCENT: Record<ReleaseWhy["tone"], string> = {
  good: "[--con-accent:var(--color-con-good)]",
  info: "[--con-accent:var(--color-con-info)]",
  idle: "[--con-accent:var(--color-con-line-hover)]",
  warn: "[--con-accent:var(--color-con-warn)]",
  bad: "[--con-accent:var(--color-con-bad)]",
};

export function ReleaseWhyCard({ why }: { why: ReleaseWhy }) {
  return (
    <section aria-labelledby="why-outcome" className={cn("con-fade-up con-surface con-accent-top rounded-lg border bg-con-panel px-5 py-4", BORDER[why.tone], ACCENT[why.tone])} style={{ animationDelay: "30ms" }}>
      <h2 id="why-outcome" className="text-[12px] font-medium uppercase tracking-wide text-con-fg3">
        Why this outcome
      </h2>
      <p className="mt-1.5 text-[15px] font-medium leading-relaxed text-con-fg">{why.title}</p>
      {why.points.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {why.points.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-con-fg2">
              <Dot tone={p.tone} className="mt-[7px]" />
              <span className="min-w-0 break-words">{p.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] text-con-fg3">Derived from this release&apos;s recorded verdicts and events, compared with the workspace regression limits.</p>
    </section>
  );
}
