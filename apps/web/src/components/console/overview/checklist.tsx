import Link from "next/link";
import { Check } from "lucide-react";
import { Card } from "@/components/console/primitives";
import { cn } from "@/lib/site";

export type ChecklistStep = { title: string; body: string; done: boolean; href: string; cta: string };

export function OverviewChecklist({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card
      title="Get started"
      description={`${done} of ${steps.length} done. Finish these to ship your first verified rollout.`}
      aside={
        <Link href="/app/onboarding" className="text-[13px] text-con-fg2 hover:text-con-fg">
          Full guide
        </Link>
      }
    >
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-con-row" aria-hidden>
        <div className="con-grow-x h-full rounded-full bg-con-fg2" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="con-stagger space-y-1">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3 rounded-md px-1 py-2">
            <span
              className={cn(
                "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium",
                s.done ? "border-con-fg2 bg-con-fg2 text-black" : "border-con-line-hover text-con-fg3",
              )}
              aria-hidden
            >
              {s.done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[13px] font-medium", s.done ? "text-con-fg3 line-through decoration-con-fg3/60" : "text-con-fg")}>{s.title}</span>
              {!s.done && <span className="block text-[12px] text-con-fg3">{s.body}</span>}
            </span>
            {!s.done && (
              <Link href={s.href} className="shrink-0 text-[12px] text-con-fg2 hover:text-con-fg">
                {s.cta}
              </Link>
            )}
            <span className="sr-only">{s.done ? "done" : "not done"}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

