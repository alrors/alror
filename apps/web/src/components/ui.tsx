import Link from "next/link";
import { cn } from "@/lib/site";

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  external?: boolean;
};

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70";

export function Button({ href, children, variant = "primary", size = "sm", className, external }: ButtonProps) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors duration-150",
    focus,
    size === "sm" && "h-8 px-3 text-[13px]",
    size === "md" && "h-10 px-4 text-sm",
    size === "lg" && "h-11 px-5 text-[15px]",
    variant === "primary" && "bg-[#f4f4f5] text-[#0a0a0b] hover:bg-white",
    variant === "secondary" && "border border-[#2a2a31] bg-[#121215] text-fg hover:border-[#3a3a42] hover:bg-[#17171b]",
    variant === "ghost" && "text-[#a3a3ad] hover:text-fg",
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-8", className)}>{children}</div>;
}

/** A page section with a hairline rule on top. */
export function Section({
  id,
  className,
  children,
  label,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section id={id} aria-label={label} className={cn("lp-rule scroll-mt-20 py-24 sm:py-32", className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Mono label above a heading, e.g. "02 · Risk". */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[11px] uppercase tracking-[0.16em] text-[#6e6e78]", className)}>{children}</p>
  );
}

/** Mono uppercase label (kept for older landing components). */
export function Tag({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{children}</span>;
}

/** Left-aligned heading block: label, two-tone title, optional lead on the right at desktop widths. */
export function SectionHeader({
  eyebrow,
  tag,
  title,
  muted,
  lead,
  id,
}: {
  eyebrow?: string;
  /** @deprecated use eyebrow */
  tag?: string;
  title: React.ReactNode;
  muted?: React.ReactNode;
  lead?: React.ReactNode;
  id?: string;
  /** @deprecated ignored */
  align?: "center" | "left";
}) {
  eyebrow = eyebrow ?? tag ?? "";
  return (
    <div className="lp-section-header max-w-[880px]" data-reveal>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.035em] text-balance text-fg sm:text-[44px]">
        {title}
        {muted && <span className="block text-[#6e6e78]">{muted}</span>}
      </h2>
      {lead && <p className="mt-5 max-w-[640px] text-[16px] leading-relaxed text-[#a3a3ad] sm:text-[17px]">{lead}</p>}
    </div>
  );
}

/** Window chrome for product UI: title bar with three neutral dots. */
export function Window({
  title,
  right,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("lp-panel overflow-hidden rounded-xl", className)}>
      <div className="flex h-10 items-center gap-3 border-b border-[#1d1d22] px-4">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a31]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a31]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a2a31]" />
        </span>
        {title && <span className="truncate font-mono text-[11px] tracking-[0.04em] text-[#6e6e78]">{title}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
