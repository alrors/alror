"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Turns on scroll reveals: marks <html> with `lp-js` (so content stays visible without JS)
 * and adds `is-in` to every [data-reveal] element once it enters the viewport.
 */
export function RevealObserver() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("lp-js");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    const els = document.querySelectorAll("[data-reveal]");
    els.forEach((el) => {
      // Already on screen at load: show without waiting for a scroll.
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) el.classList.add("is-in");
      else io.observe(el);
    });
    return () => {
      io.disconnect();
      root.classList.remove("lp-js");
    };
  }, []);
  return null;
}

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True when the visitor asked for reduced motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/** Whether the element is on screen (continuously tracked). */
export function useInView<T extends Element>(options?: { once?: boolean; margin?: string }) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const once = options?.once ?? false;
  const margin = options?.margin ?? "0px";
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (e.isIntersecting && once) io.disconnect();
      },
      { rootMargin: margin, threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, margin]);
  return [ref, inView] as const;
}

/** Animates a number towards `value` (ease-out), starting when it scrolls into view. */
export function useCountTo(value: number, active: boolean, duration = 900) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!active) return;
    if (reduced) {
      from.current = value;
      const id = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * eased;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, active, duration, reduced]);
  return shown;
}

/** A number that counts up once it is visible. */
export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ once: true });
  const n = useCountTo(value, inView, 1100);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden>
        {Math.round(n)}
        {suffix}
      </span>
      <span className="sr-only">
        {value}
        {suffix}
      </span>
    </span>
  );
}
