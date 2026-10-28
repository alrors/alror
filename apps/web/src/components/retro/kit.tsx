import Link from "next/link";
import { cn } from "@/lib/site";

// Building blocks for the retro landing page (styles in retro.css).

export function Wrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-8", className)}>{children}</div>;
}

type BtnProps = {
  href: string;
  children: React.ReactNode;
  tone?: "mint" | "paper" | "ink";
  size?: "md" | "lg";
  className?: string;
};

/** Chunky button with a hard shadow that presses in on click. */
export function Btn({ href, children, tone = "mint", size = "md", className }: BtnProps) {
  const cls = cn("rx-btn", `rx-btn-${tone}`, size === "lg" && "rx-btn-lg", className);
  return href.startsWith("http") ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** A tilted sticker label. */
export function Sticker({ children, tone = "butter", tilt = -3, className }: { children: React.ReactNode; tone?: "butter" | "lime" | "lilac" | "sky" | "mint" | "paper"; tilt?: number; className?: string }) {
  return (
    <span className={cn("rx-sticker", `rx-bg-${tone}`, className)} style={{ "--tilt": `${tilt}deg` } as React.CSSProperties}>
      {children}
    </span>
  );
}

/**
 * A 90s desktop window. `screen` makes the body a dark display that hosts the
 * existing interactive demos (their `.lp` styles stay scoped inside it).
 */
export function RetroWindow({
  title,
  children,
  screen,
  className,
  bodyClassName,
  tone = "lilac",
}: {
  title: string;
  children: React.ReactNode;
  screen?: boolean;
  className?: string;
  bodyClassName?: string;
  tone?: "lilac" | "butter" | "lime" | "sky" | "mint";
}) {
  return (
    <div className={cn("rx-window", className)}>
      <div className={cn("rx-titlebar", `rx-bg-${tone}`)}>
        <span className="rx-titlebar-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="rx-titlebar-title">{title}</span>
        <span className="rx-titlebar-btns" aria-hidden>
          <i>_</i>
          <i>□</i>
          <i>×</i>
        </span>
      </div>
      <div className={cn(screen ? "lp rx-screen" : "rx-window-body", bodyClassName)}>{children}</div>
    </div>
  );
}

/** Section title: pixel headline, highlighted second line and a short lead. */
export function Heading({
  id,
  eyebrow,
  title,
  marker,
  lead,
  tone = "lime",
  center,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  marker?: React.ReactNode;
  lead?: React.ReactNode;
  tone?: "lime" | "butter" | "lilac" | "sky" | "mint";
  center?: boolean;
}) {
  return (
    <div className={cn("rx-heading", center && "rx-heading-center")} data-reveal>
      <p className="rx-eyebrow">
        <span aria-hidden>▶</span> {eyebrow}
      </p>
      <h2 id={id}>
        {title}
        {marker && (
          <>
            <br />
            <mark className={`rx-mark rx-bg-${tone}`}>{marker}</mark>
          </>
        )}
      </h2>
      {lead && <p className="rx-lead">{lead}</p>}
    </div>
  );
}

/** Endless ticker strip. The list is rendered twice for a seamless loop. */
export function Marquee({ items, tone = "ink" }: { items: string[]; tone?: "ink" | "lime" }) {
  const row = (hidden?: boolean) => (
    <ul className="rx-marquee-row" aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <li key={it}>
          <span aria-hidden>✦</span>
          {it}
        </li>
      ))}
    </ul>
  );
  return (
    <div className={cn("rx-marquee", tone === "lime" && "rx-marquee-lime")}>
      <div className="rx-marquee-track">
        {row()}
        {row(true)}
      </div>
    </div>
  );
}
