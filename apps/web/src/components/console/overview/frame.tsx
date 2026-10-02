"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  Check,
  History,
  LayoutDashboard,
  RotateCcw,
  Server,
  SlidersHorizontal,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { SegmentedSelector } from "@/components/console/selector";
import { OVERVIEW_DENSITY_COOKIE } from "@/lib/console/prefs";
import { cn } from "@/lib/site";
import { Portal, useFloating } from "./float";
import { useLocalValue } from "./store";

/** Widgets the Customize menu can hide, in board order. */
export const WIDGETS = [
  { id: "pulse", label: "Release pulse" },
  { id: "health", label: "Delivery health" },
  { id: "runners", label: "Runners" },
  { id: "risk", label: "Risk mix" },
  { id: "usage", label: "Usage" },
] as const;

type Density = "comfortable" | "compact";
type View = "overview" | "services" | "operations" | "activity";
type Prefs = { hidden: string[]; density: Density; view: View };
const VIEWS = [
  { value: "overview" as const, label: "Overview", Icon: LayoutDashboard },
  { value: "services" as const, label: "Services", Icon: Server },
  { value: "operations" as const, label: "Operations", Icon: Activity },
  { value: "activity" as const, label: "Activity", Icon: History },
];

const KEY = "alror.overview.prefs.v1";
const DEFAULTS: Prefs = {
  hidden: [],
  density: "comfortable",
  view: "overview",
};

function parse(raw: string | null): Prefs {
  if (!raw) return DEFAULTS;
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    const ids = new Set<string>(WIDGETS.map((w) => w.id));
    return {
      hidden: Array.isArray(p.hidden)
        ? p.hidden.filter(
            (h): h is string => typeof h === "string" && ids.has(h),
          )
        : [],
      density: p.density === "compact" ? "compact" : "comfortable",
      view: VIEWS.some((v) => v.value === p.view)
        ? (p.view as View)
        : "overview",
    };
  } catch {
    return DEFAULTS;
  }
}

/** Mirror the density in a cookie so the server can size density-dependent lists (the activity page). Returns true when it changed. */
function syncDensityCookie(d: Density): boolean {
  try {
    const has = document.cookie
      .split("; ")
      .some((c) => c === `${OVERVIEW_DENSITY_COOKIE}=compact`);
    if (has === (d === "compact")) return false;
    document.cookie =
      d === "compact"
        ? `${OVERVIEW_DENSITY_COOKIE}=compact; path=/; max-age=31536000; samesite=lax`
        : `${OVERVIEW_DENSITY_COOKIE}=; path=/; max-age=0; samesite=lax`;
    return true;
  } catch {
    return false;
  }
}

const Ctx = createContext<{ prefs: Prefs; set: (p: Prefs) => void } | null>(
  null,
);

/**
 * Wraps the board. Hidden widgets get display:none by their data-widget id and
 * density is exposed as data-density for group-data variants. Renders the
 * defaults on the server and before storage is read, so the page always works.
 */
export function OverviewFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [raw, setRaw] = useLocalValue(KEY);
  const prefs = useMemo(() => parse(raw), [raw]);
  // Keep the density cookie in step; refresh so server-sized lists follow.
  useEffect(() => {
    if (syncDensityCookie(prefs.density)) router.refresh();
  }, [prefs.density, router]);
  const set = (p: Prefs) =>
    setRaw(
      p.hidden.length ||
        p.density !== DEFAULTS.density ||
        p.view !== DEFAULTS.view
        ? JSON.stringify(p)
        : null,
    );
  const css = prefs.hidden
    .map((id) => `[data-ov] [data-widget="${id}"]{display:none!important}`)
    .join("");
  return (
    <Ctx.Provider value={{ prefs, set }}>
      <div
        data-ov
        data-density={prefs.density}
        data-view={prefs.view}
        className={cn("group/ov dashboard", className)}
      >
        {css && <style>{css}</style>}
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** Dedicated panels with keyboard navigation and a remembered selection. */
export function OverviewViewSwitcher() {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <div
      className="dash-view-switch"
      role="tablist"
      aria-label="Dashboard view"
    >
      {VIEWS.map(({ value, label, Icon }, index) => (
        <button
          key={value}
          id={`dashboard-tab-${value}`}
          type="button"
          role="tab"
          aria-selected={ctx.prefs.view === value}
          aria-controls={`dashboard-panel-${value}`}
          tabIndex={ctx.prefs.view === value ? 0 : -1}
          onClick={() => ctx.set({ ...ctx.prefs, view: value })}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? VIEWS.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      VIEWS.length) %
                    VIEWS.length;
            ctx.set({ ...ctx.prefs, view: VIEWS[next].value });
            document
              .getElementById(`dashboard-tab-${VIEWS[next].value}`)
              ?.focus();
          }}
        >
          <Icon size={15} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

export function OverviewPanel({
  view,
  children,
}: {
  view: View;
  children: React.ReactNode;
}) {
  const ctx = useContext(Ctx);
  return (
    <div
      id={`dashboard-panel-${view}`}
      role="tabpanel"
      aria-labelledby={`dashboard-tab-${view}`}
      tabIndex={0}
      hidden={(ctx?.prefs.view ?? "overview") !== view}
      data-overview-content={view}
      className="dash-view-content"
    >
      {children}
    </div>
  );
}

export function OverviewAlerts({ count }: { count: number }) {
  const ctx = useContext(Ctx);
  if (!count || !ctx) return null;
  return (
    <button
      className="dash-alert-link"
      type="button"
      onClick={() => {
        ctx.set({ ...ctx.prefs, view: "overview" });
        document.getElementById("dashboard-tab-overview")?.focus();
      }}
    >
      {count} to review
    </button>
  );
}

/** "Customize" button with a popover to show and hide widgets and pick a density. */
export function CustomizeMenu() {
  const ctx = useContext(Ctx);
  const [open, setOpen] = useState(false);
  const id = useId();
  const { anchor, floating } = useFloating<HTMLButtonElement, HTMLDivElement>(
    open,
    "end",
    8,
  );

  useEffect(() => {
    if (!open) return;
    const inside = (n: EventTarget | null) =>
      n instanceof Node &&
      Boolean(anchor.current?.contains(n) || floating.current?.contains(n));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        anchor.current?.focus();
      }
    };
    // Focus the first option, so keyboard users land in the menu.
    floating.current?.querySelector<HTMLElement>("button")?.focus();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchor, floating]);

  if (!ctx) return null;
  const { prefs, set } = ctx;
  const hidden = new Set(prefs.hidden);
  const available = prefs.view === "operations" ? WIDGETS : [];
  const toggle = (w: string) =>
    set({
      ...prefs,
      hidden: hidden.has(w)
        ? prefs.hidden.filter((h) => h !== w)
        : [...prefs.hidden, w],
    });
  const changed = prefs.hidden.length > 0 || prefs.density !== DEFAULTS.density;

  return (
    <>
      <button
        aria-label="Customize dashboard"
        ref={anchor}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover",
          open
            ? "border-con-line-hover bg-con-hover text-con-fg"
            : "border-con-line text-con-fg2 hover:border-con-line-hover hover:text-con-fg",
        )}
      >
        <SlidersHorizontal size={14} />
        <span className="hidden sm:inline">Customize</span>
        {prefs.hidden.length > 0 && (
          <span className="font-mono text-[11px] tabular-nums text-con-fg3">
            {WIDGETS.length - prefs.hidden.length}/{WIDGETS.length}
          </span>
        )}
      </button>
      {open && (
        <Portal>
          <div
            ref={floating}
            id={id}
            role="dialog"
            aria-label="Customize overview"
            style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
            onBlur={(e) => {
              const next = e.relatedTarget;
              if (
                next instanceof Node &&
                !floating.current?.contains(next) &&
                !anchor.current?.contains(next)
              )
                setOpen(false);
            }}
            className="con-scale-in z-[80] w-[260px] rounded-lg border border-con-line-hover bg-con-panel p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
          >
            {available.length > 0 && (
              <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-con-fg3">
                Widgets
              </div>
            )}
            <ul>
              {available.map((w) => {
                const on = !hidden.has(w.id);
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(w.id)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-con-fg2 outline-none transition-colors duration-150 hover:bg-con-hover hover:text-con-fg focus-visible:bg-con-hover"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border transition-colors duration-150",
                          on
                            ? "border-con-fg2 bg-con-fg2 text-black"
                            : "border-con-line-hover",
                        )}
                      >
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className={cn(on ? "text-con-fg" : "text-con-fg3")}>
                        {w.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-con-row px-2 pb-1.5 pt-2.5">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-con-fg3">
                Density
              </div>
              <SegmentedSelector
                aria-label="Density"
                size="sm"
                className="w-full [&>*]:flex-1"
                value={prefs.density}
                onValueChange={(v) =>
                  set({
                    ...prefs,
                    density: v === "compact" ? "compact" : "comfortable",
                  })
                }
                items={[
                  { value: "comfortable", label: "Comfortable" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            </div>
            {changed && (
              <button
                type="button"
                onClick={() => set({ ...DEFAULTS, view: prefs.view })}
                className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-con-fg3 transition-colors duration-150 hover:bg-con-hover hover:text-con-fg"
              >
                <RotateCcw size={12} />
                Reset to default
              </button>
            )}
          </div>
        </Portal>
      )}
    </>
  );
}
