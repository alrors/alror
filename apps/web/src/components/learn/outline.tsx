"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/site";

// Watched lectures are a per-browser convenience (localStorage), not an account record.

const KEY = "alror:learn:watched";
const EVENT = "alror:learn:watched";

function readWatched(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function MarkWatched({ courseSlug, lectureSlug }: { courseSlug: string; lectureSlug: string }) {
  useEffect(() => {
    try {
      const s = readWatched();
      const k = `${courseSlug}/${lectureSlug}`;
      if (s.has(k)) return;
      s.add(k);
      localStorage.setItem(KEY, JSON.stringify([...s].slice(-2000)));
      window.dispatchEvent(new Event(EVENT));
    } catch {
      // storage unavailable: nothing to remember
    }
  }, [courseSlug, lectureSlug]);
  return null;
}

export function LectureOutline({
  courseSlug,
  active,
  lectures,
}: {
  courseSlug: string;
  active: string;
  lectures: { slug: string; title: string; draft: boolean }[];
}) {
  const [watched, setWatched] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sync = () => setWatched(readWatched());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <ol className="px-2 pb-5">
      {lectures.map((l, i) => {
        const on = l.slug === active;
        const done = watched.has(`${courseSlug}/${l.slug}`);
        return (
          <li key={l.slug}>
            <Link
              href={`/learn/${courseSlug}/${l.slug}`}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-md px-3 py-2 text-[13px] leading-snug transition-colors",
                on ? "bg-con-row text-con-fg" : "text-con-fg2 hover:bg-con-hover hover:text-con-fg",
              )}
            >
              <span
                className={cn(
                  "mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] tabular-nums",
                  done ? "border-con-good/50 text-con-good" : on ? "border-con-fg2 text-con-fg" : "border-con-line-hover text-con-fg3",
                )}
              >
                {done ? <Check size={11} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {l.title}
                {l.draft && <span className="ml-1.5 text-[11px] text-con-warn">Draft</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
