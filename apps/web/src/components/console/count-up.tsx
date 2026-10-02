"use client";

import { useEffect, useRef, useState } from "react";

/** Animates a number from 0 to `value` once on mount (and smoothly to new values). */
export function CountUp({
  value,
  decimals = 0,
  duration = 500,
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  duration?: number;
  suffix?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    // Reduced motion: jump straight to the value on the first frame.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }} aria-label={`${value.toFixed(decimals)}${suffix}`}>
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
