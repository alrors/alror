"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/site";

/**
 * Places a fixed-position element (rendered in a portal on document.body) under
 * its anchor, or above it when there is no room. Follows resize and any scroll,
 * including the console's main[data-scroller], so it is never clipped or painted
 * over by stacking contexts (animated cards) further down the page.
 */
export function useFloating<A extends HTMLElement, F extends HTMLElement>(open: boolean, align: "start" | "center" | "end" = "start", gap = 6) {
  const anchor = useRef<A>(null);
  const floating = useRef<F>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const el = floating.current;
    const a = anchor.current;
    if (!el || !a) return;
    const place = () => {
      const r = a.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let left = align === "end" ? r.right - w : align === "center" ? r.left + r.width / 2 - w / 2 : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const up = vh - r.bottom - gap < h + 8 && r.top > vh - r.bottom;
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(up ? r.top - gap - h : r.bottom + gap)}px`;
      el.style.transformOrigin = `${align === "end" ? "right" : align === "center" ? "center" : "left"} ${up ? "bottom" : "top"}`;
      el.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, gap]);
  return { anchor, floating };
}

/** Renders children into document.body (client only). */
export function Portal({ children }: { children: React.ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

/** (i) button that shows an explanation on hover and keyboard focus. */
export function InfoTip({ label, children, align = "center", className }: { label: string; children: React.ReactNode; align?: "start" | "center" | "end"; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { anchor, floating } = useFloating<HTMLButtonElement, HTMLDivElement>(open, align);
  return (
    <span className={cn("relative inline-flex align-middle", className)} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)}>
      <button
        ref={anchor}
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        onClick={() => setOpen(true)}
        className="inline-grid h-5 w-5 place-items-center rounded text-con-fg3 outline-none transition-colors duration-150 hover:text-con-fg2 focus-visible:text-con-fg focus-visible:ring-1 focus-visible:ring-con-line-hover"
      >
        <Info size={13} strokeWidth={2} />
      </button>
      {open && (
        <Portal>
          <div
            ref={floating}
            id={id}
            role="tooltip"
            style={{ position: "fixed", top: 0, left: 0, visibility: "hidden" }}
            className="con-fade pointer-events-none z-[90] w-64 rounded-md border border-con-line-hover bg-con-bg px-3 py-2 text-left text-[12px] font-normal leading-relaxed text-con-fg2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
          >
            {children}
          </div>
        </Portal>
      )}
    </span>
  );
}
