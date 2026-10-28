"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { cn } from "@/lib/site";

export type ChecklistItem = { title: string; summary: string; done: boolean; body: React.ReactNode };

/**
 * Setup progress: a bar that fills to the share of finished steps, then the steps.
 * The next unfinished step is open; finished ones fold to one line and can be reopened.
 */
export function ShellChecklist({ steps }: { steps: ChecklistItem[] }) {
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);
  const [open, setOpen] = useState<Set<number>>(() => new Set(next >= 0 ? [next] : []));
  const toggle = (i: number) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const pct = Math.round((done / Math.max(steps.length, 1)) * 100);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-con-line bg-con-panel px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-[14px] text-con-fg">
            <CountUp value={done} className="font-semibold" /> of {steps.length} steps done
          </div>
          <div className="text-[13px] text-con-fg2">
            {next >= 0 ? (
              <>
                Next: <span className="text-con-fg">{steps[next].title}</span>
              </>
            ) : (
              "All set"
            )}
          </div>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-con-row"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done}
          aria-label="Setup progress"
        >
          <div className="con-grow-x h-full rounded-full bg-con-fg2" style={{ width: `${pct}%`, animationDuration: "0.9s" }} />
        </div>
        <ol className="mt-3 flex gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <li key={s.title} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", s.done ? "bg-con-fg3" : i === next ? "bg-con-line-hover" : "bg-con-row")} />
          ))}
        </ol>
      </div>

      <ol className="con-stagger space-y-3">
        {steps.map((s, i) => {
          const isOpen = open.has(i);
          const current = i === next;
          return (
            <li
              key={s.title}
              className={cn(
                "rounded-lg border bg-con-panel transition-colors duration-200",
                current ? "border-con-line-hover" : "border-con-line",
              )}
            >
              <button type="button" onClick={() => toggle(i)} aria-expanded={isOpen} className="flex w-full items-center gap-4 px-5 py-4 text-left">
                <span
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[13px] font-medium tabular-nums transition-colors duration-200",
                    s.done ? "border-con-line-hover bg-con-row text-con-fg" : current ? "border-con-fg3 text-con-fg" : "border-con-line text-con-fg3",
                  )}
                  aria-label={s.done ? "Done" : `Step ${i + 1}`}
                >
                  {s.done ? <Check size={14} className="con-scale-in" style={{ animationDelay: `${200 + i * 80}ms` }} /> : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[15px] font-semibold", s.done ? "text-con-fg2" : "text-con-fg")}>{s.title}</span>
                  {!isOpen && <span className="block truncate text-[13px] text-con-fg3">{s.done ? "Done" : s.summary}</span>}
                </span>
                {current && <span className="hidden rounded-full border border-con-line px-2 py-0.5 text-[11px] text-con-fg2 sm:inline">Up next</span>}
                <ChevronDown size={15} className={cn("shrink-0 text-con-fg3 transition-transform duration-200 motion-reduce:transition-none", isOpen && "rotate-180")} />
              </button>
              {/* grid-rows 0fr -> 1fr animates the height of the step body. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="min-h-0 overflow-hidden" inert={!isOpen}>
                  <div className="px-5 pb-5 pl-16 text-[13px] leading-relaxed text-con-fg2">{s.body}</div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
