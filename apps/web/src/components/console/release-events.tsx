"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { hm, span } from "@/lib/console/format";
import type { DeployEvent, EventKind } from "@/lib/console/types";
import { cn } from "@/lib/site";

const PREVIEW = 12;

const GROUPS: { value: string; label: string; kinds: EventKind[] | null }[] = [
  { value: "all", label: "All", kinds: null },
  { value: "progress", label: "Progress", kinds: ["created", "step", "promoted"] },
  { value: "verdicts", label: "Verdicts", kinds: ["verdict"] },
  { value: "problems", label: "Rollbacks and errors", kinds: ["rolled_back", "error"] },
];

const kindDot: Record<EventKind, string> = {
  created: "bg-con-fg3",
  step: "bg-con-info",
  verdict: "bg-con-good",
  promoted: "bg-con-good",
  rolled_back: "bg-con-warn",
  error: "bg-con-bad",
};

/** The deployment's event log with kind filters, text search and a short preview. */
export function ReleaseEvents({ events }: { events: DeployEvent[] }) {
  const [group, setGroup] = useState("all");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const t0 = events.length ? Date.parse(events[0].at) : 0;

  const counts = useMemo(
    () => Object.fromEntries(GROUPS.map((g) => [g.value, g.kinds ? events.filter((e) => g.kinds!.includes(e.kind)).length : events.length])),
    [events],
  );
  const shown = useMemo(() => {
    const kinds = GROUPS.find((g) => g.value === group)?.kinds;
    const needle = q.trim().toLowerCase();
    return events.filter((e) => (!kinds || kinds.includes(e.kind)) && (!needle || e.message.toLowerCase().includes(needle) || e.kind.includes(needle)));
  }, [events, group, q]);
  const list = all ? shown : shown.slice(0, PREVIEW);

  if (events.length === 0) return <p className="px-5 py-8 text-center text-[13px] text-con-fg3">No events recorded.</p>;

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-con-line px-5 py-2.5 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter events">
          {GROUPS.map((g) => (
            <button
              key={g.value}
              type="button"
              aria-pressed={group === g.value}
              onClick={() => setGroup(g.value)}
              disabled={counts[g.value] === 0 && g.value !== "all"}
              className={cn(
                "con-ease inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] disabled:opacity-40",
                group === g.value ? "border-con-line-hover bg-con-row text-con-fg" : "border-con-line text-con-fg2 hover:border-con-line-hover hover:text-con-fg",
              )}
            >
              {g.label}
              <span className="tabular-nums text-con-fg3">{counts[g.value]}</span>
            </button>
          ))}
        </div>
        <label className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2 text-con-fg3 focus-within:border-con-line-hover sm:ml-auto sm:w-56">
          <Search size={13} className="shrink-0" />
          <span className="sr-only">Search events</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search messages"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-con-fg outline-none placeholder:text-con-fg3"
          />
        </label>
      </div>

      {list.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-con-fg3">No events match.</p>
      ) : (
        <ol key={`${group}:${all}`} className="con-stagger">
          {list.map((e, i) => {
            const dot = e.kind === "verdict" && e.verdict && !e.verdict.pass ? "bg-con-bad" : e.kind === "verdict" && !e.verdict ? "bg-con-warn" : kindDot[e.kind];
            return (
              <li key={i} className="grid grid-cols-[56px_minmax(0,1fr)] items-baseline gap-x-4 border-b border-con-row px-5 py-2.5 last:border-0 sm:grid-cols-[56px_64px_110px_minmax(0,1fr)]">
                <span className="font-mono text-[12.5px] tabular-nums text-con-fg2">{hm(e.at)}</span>
                <span className="hidden font-mono text-[12px] tabular-nums text-con-fg3 sm:block">+{span(Date.parse(e.at) - t0)}</span>
                <span className="hidden items-center gap-2 text-[13px] text-con-fg2 sm:flex">
                  <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
                  {e.kind.replace("_", " ")}
                </span>
                <span className="min-w-0 break-words text-[13px] text-con-fg">{e.message}</span>
              </li>
            );
          })}
        </ol>
      )}

      {shown.length > PREVIEW && (
        <div className="border-t border-con-line px-5 py-3">
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] text-con-fg2 hover:text-con-fg">
            {all ? "Show fewer" : `Show all ${shown.length} events`}
          </button>
        </div>
      )}
    </div>
  );
}
