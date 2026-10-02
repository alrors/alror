import { cn } from "@/lib/site";

/** Risk bar segments, coloured like the CLI: green → amber → red by position. */
export function RiskSegments({ score, className, size = "md" }: { score: number; className?: string; size?: "sm" | "md" }) {
  const filled = Math.round(score / 5);
  return (
    <span className={cn("flex gap-[3px]", className)} aria-hidden>
      {Array.from({ length: 20 }, (_, i) => {
        const on = i < filled;
        const color = i < 7 ? "#35e08f" : i < 14 ? "#f5a524" : "#f2555a";
        return (
          <span
            key={i}
            className={cn("rounded-[1.5px] transition-colors duration-300", size === "sm" ? "h-2.5 w-[5px]" : "h-3.5 w-[6px]")}
            style={{ background: on ? color : "#25252b", transitionDelay: `${i * 18}ms` }}
          />
        );
      })}
    </span>
  );
}
