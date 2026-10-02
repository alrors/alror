import { cn } from "@/lib/site";
import styles from "./loader.module.css";

/** Small ring spinner for buttons and inline waits; inherits the text colour. */
export function Spinner({ size = 14, className, label }: { size?: number; className?: string; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={styles.spin} />
    </svg>
  );
}

/** The Alror gate mark with a light tracing the arch: the brand loader for full-page waits. */
export function AlrorLoader({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("shrink-0", className)} aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="#151518" stroke="#2d2d32" />
      <path d="M7 18v-7a5 5 0 0 1 10 0v7" stroke="#f2f2f3" strokeOpacity="0.18" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M7 18v-7a5 5 0 0 1 10 0v7" pathLength={100} stroke="#f2f2f3" strokeWidth="2.2" strokeLinecap="round" className={styles.trace} />
      <circle cx="12" cy="15.5" r="1.9" fill="#35e08f" />
    </svg>
  );
}

/** Centered loader with a label, for a card or panel whose content is on its way. */
export function LoadingPanel({ label = "Loading", detail, className }: { label?: string; detail?: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-3 px-6 py-10 text-center", styles.delayed, className)}>
      <Spinner size={20} className="text-con-fg2" />
      <div>
        <div className="text-[13px] text-con-fg2">{label}</div>
        {detail && <div className="mt-0.5 text-[12px] text-con-fg3">{detail}</div>}
      </div>
    </div>
  );
}

/** Full-screen brand loader, used while the workspace itself is loading. */
export function PageLoader({ label = "Loading your workspace" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 bg-con-bg text-con-fg">
      <div className={cn("flex flex-col items-center gap-4", styles.delayed)}>
        <AlrorLoader size={52} />
        <span className="text-[13px] text-con-fg3">{label}</span>
      </div>
    </div>
  );
}
