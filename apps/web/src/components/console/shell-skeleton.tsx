import { cn } from "@/lib/site";

/**
 * Loading skeleton building blocks for the console's loading.tsx files. Shapes
 * mirror the real pages (header, KPI tiles, cards, tables) so content swaps in
 * without a layout jump. Uses .con-skeleton (shimmer; static under reduced motion).
 */

export function Bone({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn("con-skeleton", className)} style={style} />;
}

/** Screen-reader announcement plus a wrapper that fades the skeleton in after a beat, so fast loads never flash it. */
export function SkeletonPage({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("con-fade space-y-6", className)} style={{ animationDelay: "80ms" }}>
      <span className="sr-only">Loading {label}</span>
      {children}
    </div>
  );
}

export function SkeletonHeader({ actions = 1, meta = false, description = true }: { actions?: number; meta?: boolean; description?: boolean }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 space-y-2.5">
        {meta && <Bone className="h-5 w-40" />}
        <Bone className="h-8 w-56" />
        {description && <Bone className="h-4 w-[min(420px,80vw)]" />}
      </div>
      {actions > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Bone key={i} className="h-8 w-24" />
          ))}
        </div>
      )}
    </div>
  );
}

export function SkeletonCard({ className, title = true, children, bodyClassName }: { className?: string; title?: boolean; children?: React.ReactNode; bodyClassName?: string }) {
  return (
    <div className={cn("rounded-lg border border-con-line bg-con-panel", className)}>
      {title && (
        <div className="space-y-2 px-5 pb-1 pt-4">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-56 max-w-full" />
        </div>
      )}
      <div className={cn("px-5 pb-5 pt-4", bodyClassName)}>{children ?? <Bone className="h-40 w-full" />}</div>
    </div>
  );
}

export function SkeletonKpis({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", count >= 5 ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4", className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-con-line bg-con-panel p-5">
          <Bone className="h-3.5 w-24" />
          <Bone className="h-7 w-20" />
          <Bone className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

const widths = ["w-[70%]", "w-[45%]", "w-[60%]", "w-[35%]", "w-[55%]", "w-[40%]"];

/** Table card: optional toolbar, header row and N rows of cells. */
export function SkeletonTable({ rows = 8, cols = 5, toolbar = true, title = false, className }: { rows?: number; cols?: number; toolbar?: boolean; title?: boolean; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-con-line bg-con-panel", className)}>
      {title && (
        <div className="space-y-2 border-b border-con-line px-5 py-4">
          <Bone className="h-4 w-36" />
          <Bone className="h-3 w-56 max-w-full" />
        </div>
      )}
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-3">
          <Bone className="h-8 w-56" />
          <Bone className="h-8 w-28" />
          <Bone className="h-8 w-28" />
        </div>
      )}
      <div className="flex h-10 items-center gap-6 border-b border-con-line px-5">
        {Array.from({ length: cols }, (_, c) => (
          <Bone key={c} className="h-3 flex-1" style={{ maxWidth: c === 0 ? 120 : 80 }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-12 items-center gap-6 border-b border-con-row px-5 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="flex-1">
              <Bone className={cn("h-3.5", widths[(r + c) % widths.length])} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Vertical list of short lines (event logs, feeds). */
export function SkeletonLines({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Bone className="h-3 w-14 shrink-0" />
          <Bone className={cn("h-3.5", widths[i % widths.length])} />
        </div>
      ))}
    </div>
  );
}

/** Stand-in for a chart area. */
export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-48 items-end gap-1.5", className)}>
      {[38, 52, 44, 63, 58, 72, 49, 66, 80, 61, 74, 57, 69, 83].map((h, i) => (
        <Bone key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
