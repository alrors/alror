"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin top progress bar shown while a console navigation is in flight.
 * It starts on clicks of same-origin links (or startNavigationProgress() for
 * programmatic router.push) and completes when the URL changes.
 */

const START = "alror:nav-start";

/** Call before router.push(href) so programmatic navigations show progress too. */
export function startNavigationProgress(href?: string) {
  if (href) {
    const url = new URL(href, location.href);
    if (url.pathname === location.pathname && url.search === location.search) return;
  }
  window.dispatchEvent(new Event(START));
}

function isPlainNavigation(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url.pathname + url.search;
}

export function ShellProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const begin = () => {
      if (active.current) return;
      active.current = true;
      if (hide.current) clearTimeout(hide.current);
      setVisible(true);
      setWidth(8);
      // Ease towards 90% and wait there for the URL change.
      requestAnimationFrame(() => setWidth(30));
      trickle.current = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w)), 300);
      // Safety: never leave a bar stuck (e.g. a navigation that was cancelled).
      hide.current = setTimeout(() => finish(), 12000);
    };
    const onClick = (e: MouseEvent) => {
      if (isPlainNavigation(e)) begin();
    };
    window.addEventListener(START, begin);
    // Capture phase: next/link calls preventDefault in its own (bubbling) handler.
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(START, begin);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  function finish() {
    if (trickle.current) clearInterval(trickle.current);
    trickle.current = null;
    if (!active.current) return;
    active.current = false;
    setWidth(100);
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => setWidth(0), 200);
    }, 220);
  }

  const key = `${pathname}?${search.toString()}`;
  useEffect(() => {
    finish();
  }, [key]);

  useEffect(
    () => () => {
      if (trickle.current) clearInterval(trickle.current);
      if (hide.current) clearTimeout(hide.current);
    },
    [],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[2px]">
      <div
        className="h-full bg-con-fg/70 transition-[width,opacity] duration-200 ease-out motion-reduce:transition-none"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
      />
    </div>
  );
}
