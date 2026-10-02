import type { ReactNode } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/navbar";
import { cn } from "@/lib/site";

// Shared frame for error, not-found, access and outage screens. Server-safe (no hooks).
//
//   variant "page":  full viewport, its own slim header (outside the console shell)
//   variant "panel": sits in the console's content column, under the top bar

export const errorLink =
  "inline-flex items-center gap-1.5 text-[13px] text-con-fg2 underline-offset-4 transition-colors duration-150 hover:text-con-fg hover:underline";

export function ErrorView({
  variant = "panel",
  mark,
  eyebrow,
  title,
  children,
  actions,
  links,
  aside,
  footer,
  className,
}: {
  variant?: "page" | "panel";
  /** Replaces the gate mark (e.g. the loader while retrying). */
  mark?: ReactNode;
  /** Small mono label above the title: "404", "Error", "503". */
  eyebrow?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  /** Primary and secondary buttons. */
  actions?: ReactNode;
  /** A quiet row of text links under the actions. */
  links?: ReactNode;
  /** Extra content below (suggestions, checks, details). */
  aside?: ReactNode;
  /** Bottom line: error reference, status. */
  footer?: ReactNode;
  className?: string;
}) {
  const body = (
    <div className={cn("con-fade-up w-full max-w-[560px]", className)}>
      <div className="flex items-center gap-3">
        {mark ?? <LogoMark className="h-10 w-10" />}
        {eyebrow && (
          <span className="rounded-full border border-con-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-con-fg3">{eyebrow}</span>
        )}
      </div>
      <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.025em] text-con-fg sm:text-[28px]">{title}</h1>
      {children && <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-con-fg2">{children}</div>}
      {actions && <div className="mt-7 flex flex-wrap items-center gap-2">{actions}</div>}
      {links && <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">{links}</div>}
      {aside && <div className="mt-9">{aside}</div>}
      {footer && <div className="mt-9 border-t border-con-line pt-4">{footer}</div>}
    </div>
  );

  if (variant === "panel") {
    return <div className="flex justify-center px-0 pb-16 pt-[6vh] sm:pt-[9vh]">{body}</div>;
  }
  return (
    <main className="flex min-h-dvh flex-1 flex-col bg-con-bg text-con-fg">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-5">
        <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.03em] text-con-fg">
          <LogoMark className="h-6 w-6" />
          alror
        </Link>
      </header>
      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-[8vh] sm:items-center sm:pt-0">{body}</div>
    </main>
  );
}
