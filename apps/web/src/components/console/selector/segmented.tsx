"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/site";

export type SegmentedItem = {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Navigate instead of calling onValueChange (URL-driven views such as ?range=). */
  href?: string;
  /** Accessible name, needed when the item shows only an icon. */
  "aria-label"?: string;
  title?: string;
};

/**
 * Segmented control for 2 to 5 choices with one highlight that slides between
 * segments. Buttons act as a radio group (arrow keys move the choice); items with
 * an href render links, and the highlight moves on click before the page arrives.
 * With `name` a hidden input carries the value in forms.
 */
export function SegmentedSelector({
  items,
  value,
  defaultValue,
  onValueChange,
  name,
  size = "md",
  className,
  "aria-label": label,
}: {
  items: SegmentedItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? items[0]?.value ?? "");
  const base = value ?? inner;
  // Links: show the clicked segment right away, until the new page sends its value.
  const [picked, setPicked] = useState<{ v: string; base: string } | null>(null);
  const current = picked && picked.base === base ? picked.v : base;
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const isLinks = items.some((i) => i.href);

  useLayoutEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-seg-value="${CSS.escape(current)}"]`);
    const b = bar.current;
    if (!b || !box.current) return;
    if (!el) {
      b.style.opacity = "0";
      return;
    }
    b.style.transition = placed.current ? "" : "none";
    b.style.transform = `translateX(${el.offsetLeft}px)`;
    b.style.width = `${el.offsetWidth}px`;
    b.style.opacity = "1";
    if (!placed.current) {
      void b.offsetWidth;
      b.style.transition = "";
    }
    placed.current = true;
    box.current.dataset.ready = "1";
  }, [current, items.length]);

  const select = (v: string) => {
    if (v === current) return;
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isLinks) return;
    const i = items.findIndex((it) => it.value === current);
    let n = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % items.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    select(items[n].value);
    box.current?.querySelector<HTMLElement>(`[data-seg-value="${CSS.escape(items[n].value)}"]`)?.focus();
  };

  const seg = (on: boolean) =>
    cn(
      "relative z-[1] inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-con-line-hover",
      size === "sm" ? "px-2 text-[12px]" : "px-2.5 text-[13px]",
      on ? "text-con-fg group-data-[ready=1]/seg:bg-transparent bg-con-row" : "text-con-fg3 hover:text-con-fg",
    );

  return (
    <div
      ref={box}
      role={isLinks ? undefined : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("group/seg relative inline-flex shrink-0 items-center rounded-md border border-con-line p-0.5", size === "sm" ? "h-7" : "h-8", className)}
    >
      {name && <input type="hidden" name={name} value={current} />}
      <span
        ref={bar}
        aria-hidden
        className="pointer-events-none absolute bottom-0.5 left-0 top-0.5 rounded-[4px] bg-con-row opacity-0 transition-[transform,width,opacity] duration-200 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
      />
      {items.map((it) => {
        const on = it.value === current;
        const body = (
          <>
            {it.icon}
            {it.label}
          </>
        );
        return it.href ? (
          <Link
            key={it.value}
            href={it.href}
            scroll={false}
            data-seg-value={it.value}
            aria-current={on ? "page" : undefined}
            aria-label={it["aria-label"]}
            title={it.title}
            onClick={() => setPicked({ v: it.value, base })}
            className={seg(on)}
          >
            {body}
          </Link>
        ) : (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={it["aria-label"]}
            title={it.title}
            tabIndex={on ? 0 : -1}
            data-seg-value={it.value}
            onClick={() => select(it.value)}
            className={seg(on)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
