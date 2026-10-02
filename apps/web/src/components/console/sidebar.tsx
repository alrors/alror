"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  Blocks,
  BookOpen,
  ChartColumn,
  Compass,
  GitFork,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Server,
  ListChecks,
  Settings,
  Settings2,
  X,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/navbar";
import { SHELL_EVENTS, shellOn, useModKey } from "@/components/console/shell-events";
import { SIDEBAR_COOKIE } from "@/lib/console/prefs";
import { cn } from "@/lib/site";

type Item = { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean; external?: boolean };

const groups: { label: string; items: Item[] }[] = [
  {
    label: "Project",
    items: [
      { href: "/app", label: "Overview", icon: LayoutDashboard, match: (p) => p === "/app" },
      { href: "/app/services", label: "Services", icon: Server, match: (p) => p === "/app/services" || p.startsWith("/app/services/") },
    ],
  },
  {
    label: "Releases",
    items: [
      { href: "/app/deployments", label: "Deployments", icon: Rocket, match: (p) => p.startsWith("/app/deployments") },
      { href: "/app/jobs", label: "Jobs", icon: ListChecks, match: (p) => p.startsWith("/app/jobs") },
      { href: "/app/insights", label: "Insights", icon: ChartColumn, match: (p) => p.startsWith("/app/insights") },
    ],
  },
  {
    label: "Extend",
    items: [
      { href: "/app/github", label: "GitHub", icon: GitFork, match: (p) => p.startsWith("/app/github") },
      { href: "/app/marketplace", label: "Marketplace", icon: Blocks, match: (p) => p.startsWith("/app/marketplace") },
    ],
  },
];
const bottom: Item[] = [
  { href: "/app/onboarding", label: "Getting started", icon: Compass, match: (p) => p.startsWith("/app/onboarding") },
  { href: "/app/policies", label: "Policies", icon: Settings2, match: (p) => p.startsWith("/app/policies") },
  { href: "/app/settings", label: "Settings", icon: Settings, match: (p) => p.startsWith("/app/settings") },
];

/* ------------------------------ Sliding indicator ----------------------------- */

/**
 * A single highlight behind the active item that slides between items instead of
 * jumping. It is positioned with a transform on the DOM node (no re-render).
 */
function useActiveIndicator(deps: unknown[]) {
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[aria-current=page]");
    const b = bar.current;
    if (!b) return;
    if (!el) {
      b.style.opacity = "0";
      placed.current = false;
      return;
    }
    // First placement (or after being hidden) snaps into place; later moves slide.
    b.style.transition = placed.current ? "" : "none";
    b.style.transform = `translateY(${el.offsetTop}px)`;
    b.style.height = `${el.offsetHeight}px`;
    b.style.opacity = "1";
    if (!placed.current) {
      void b.offsetHeight; // commit the snap before re-enabling transitions
      b.style.transition = "";
    }
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const indicator = (
    <span
      ref={bar}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 rounded-md bg-con-row opacity-0 transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
    />
  );
  return { box, indicator };
}

/* ---------------------------------- Items ---------------------------------- */

function NavItem({ item, expanded, active, rolling, onNavigate }: { item: Item; expanded: boolean; active: boolean; rolling?: number; onNavigate?: () => void }) {
  const { href, label, icon: Icon, external } = item;
  const cls = cn(
    "group relative z-[1] flex h-9 w-full items-center whitespace-nowrap rounded-md px-2 text-[14px] transition-colors duration-150",
    active ? "text-con-fg" : "text-con-fg3 hover:bg-con-hover hover:text-con-fg",
  );
  const body = (
    <>
      <span className="relative shrink-0">
        <Icon size={20} strokeWidth={1.6} />
        {!!rolling && (
          <span
            className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-con-info ring-2 ring-con-bg transition-opacity duration-200", expanded ? "opacity-0" : "opacity-100")}
            aria-hidden
          />
        )}
      </span>
      {/* The label shrinks with the sidebar and fades, so the width animation stays smooth. */}
      <span
        className={cn(
          "ml-3 flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none",
          expanded ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!expanded}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {external && <ArrowUpRight size={14} className="shrink-0 text-con-fg3" />}
        {!!rolling && (
          <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-con-bg px-1.5 text-[12px] tabular-nums text-con-fg2">
            <span className="h-1.5 w-1.5 rounded-full bg-con-info" aria-hidden />
            {rolling}
          </span>
        )}
      </span>
      {!expanded && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-con-line bg-con-panel px-2 py-1 text-[12px] text-con-fg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          {label}
          {!!rolling && <span className="ml-1.5 text-con-fg3">{rolling} rolling</span>}
        </span>
      )}
    </>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls} aria-label={label}>
      {body}
    </a>
  ) : (
    <Link href={href} onClick={onNavigate} className={cls} aria-label={label} aria-current={active ? "page" : undefined}>
      {body}
    </Link>
  );
}

function GroupLabel({ label, expanded, divider }: { label: string; expanded: boolean; divider: boolean }) {
  return (
    <div className="relative h-7 w-full" aria-hidden={!expanded}>
      <span
        className={cn(
          "absolute inset-x-0 top-1 truncate whitespace-nowrap px-2 text-[12px] font-medium text-con-fg3 transition-opacity duration-200 motion-reduce:transition-none",
          expanded ? "opacity-100" : "opacity-0",
        )}
      >
        {label}
      </span>
      {divider && (
        <span
          className={cn("absolute left-1.5 top-1/2 h-px w-6 bg-con-line transition-opacity duration-200 motion-reduce:transition-none", expanded ? "opacity-0" : "opacity-100")}
        />
      )}
    </div>
  );
}

function Nav({ docsUrl, rolling, expanded, onNavigate }: { docsUrl: string; rolling: number; expanded: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { box, indicator } = useActiveIndicator([pathname]);
  const docs: Item = { href: docsUrl, label: "Docs", icon: BookOpen, match: () => false, external: true };
  const all = [...groups, { label: "Resources", items: [docs] }];
  return (
    <nav aria-label="Console" ref={box} className="relative flex flex-col gap-1.5">
      {indicator}
      {all.map((g, i) => (
        <div key={g.label} className="flex w-full flex-col gap-0.5">
          <GroupLabel label={g.label} expanded={expanded} divider={i > 0} />
          {g.items.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              expanded={expanded}
              active={item.match(pathname)}
              rolling={item.href === "/app/deployments" ? rolling : undefined}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function BottomNav({ expanded, onNavigate }: { expanded: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { box, indicator } = useActiveIndicator([pathname]);
  return (
    <div ref={box} className="relative flex flex-col gap-0.5">
      {indicator}
      {bottom.map((item) => (
        <NavItem key={item.href} item={item} expanded={expanded} active={item.match(pathname)} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

/**
 * Collapsible navigation: expanded (220px, labels) or an icon rail (60px, tooltips).
 * The choice lives in a cookie so the server renders the right width on first paint.
 */
export function Sidebar({ docsUrl, rolling, initialCollapsed }: { docsUrl: string; rolling: number; initialCollapsed: boolean }) {
  const [expanded, setExpanded] = useState(!initialCollapsed);
  const mod = useModKey();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.cookie = `${SIDEBAR_COOKIE}=${expanded ? "expanded" : "collapsed"}; path=/; max-age=31536000; samesite=lax`;
  }, [expanded]);

  useEffect(() => {
    const toggle = () => setExpanded((e) => !e);
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "b") {
        ev.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    const off = shellOn(SHELL_EVENTS.toggleSidebar, toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      off();
    };
  }, []);

  return (
    <aside
      className={cn(
        "hidden min-h-0 shrink-0 flex-col border-r border-con-line bg-con-bg px-3 py-3 transition-[width] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none md:flex",
        expanded ? "w-[220px] overflow-hidden" : "w-[60px] overflow-visible",
      )}
      data-expanded={expanded}
    >
      {/* The nav scrolls on its own on short screens, so the bottom items always stay in view.
          Collapsed, it stays overflow-visible so the hover labels are not clipped. */}
      <div className={cn("min-h-0 w-full flex-1", expanded && "con-scroll -mx-1 overflow-y-auto overflow-x-hidden px-1")}>
        <Nav docsUrl={docsUrl} rolling={rolling} expanded={expanded} />
      </div>
      <div className="flex w-full flex-col gap-0.5 border-t border-con-line pt-3">
        <BottomNav expanded={expanded} />
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          title={expanded ? `Collapse (${mod}+B)` : `Expand (${mod}+B)`}
          className="group relative flex h-9 w-full items-center whitespace-nowrap rounded-md px-2 text-[14px] text-con-fg3 transition-colors duration-150 hover:bg-con-hover hover:text-con-fg"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-expanded={expanded}
        >
          {expanded ? <PanelLeftClose size={20} strokeWidth={1.6} className="shrink-0" /> : <PanelLeftOpen size={20} strokeWidth={1.6} className="shrink-0" />}
          <span
            className={cn(
              "ml-3 flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-opacity duration-200 motion-reduce:transition-none",
              expanded ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">Collapse</span>
            <kbd className="shrink-0 rounded border border-con-line px-1 font-sans text-[11px] text-con-fg3">{mod} B</kbd>
          </span>
        </button>
      </div>
    </aside>
  );
}

/** Hamburger + drawer for small screens. */
export function MobileNav({ docsUrl, rolling }: { docsUrl: string; rolling: number }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-con-line text-con-fg2 hover:text-con-fg md:hidden"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
      >
        <Menu size={17} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button aria-label="Close navigation" className="con-fade absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="shell-slide-in absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col border-r border-con-line bg-con-bg">
            <div className="flex h-14 items-center justify-between border-b border-con-line px-4">
              <Link href="/app" onClick={() => setOpen(false)} className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.03em]">
                <LogoMark className="h-6 w-6" />
                alror
              </Link>
              <button
                className="grid h-8 w-8 place-items-center rounded-md text-con-fg2 hover:text-con-fg"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-1 flex-col justify-between px-3 py-4">
              <Nav docsUrl={docsUrl} rolling={rolling} expanded onNavigate={() => setOpen(false)} />
              <div className="border-t border-con-line pt-3">
                <BottomNav expanded onNavigate={() => setOpen(false)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
