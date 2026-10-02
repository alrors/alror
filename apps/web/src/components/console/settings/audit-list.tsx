"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bot, KeyRound, Search, User, X } from "lucide-react";
import type { AuditEntry } from "@/lib/server/data/audit";
import { cn } from "@/lib/site";

export type AuditRow = AuditEntry & { day: string; dayLabel: string; time: string; full: string };

const ACTORS = [
  { value: "", label: "Everyone" },
  { value: "user", label: "People" },
  { value: "api_key", label: "API keys" },
  { value: "system", label: "System" },
] as const;

const ACTOR_ICON = { user: User, api_key: KeyRound, system: Bot } as const;

/** Audit rows grouped by UTC day, with quick filters over the loaded page. */
export function AuditList({ rows }: { rows: AuditRow[] }) {
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const filtered = rows.filter(
      (r) =>
        (!actor || r.actor_type === actor) &&
        (!query || r.action.includes(query) || r.target.toLowerCase().includes(query) || r.actor_label.toLowerCase().includes(query)),
    );
    const out: { day: string; label: string; items: AuditRow[] }[] = [];
    for (const r of filtered) {
      const last = out[out.length - 1];
      if (last && last.day === r.day) last.items.push(r);
      else out.push({ day: r.day, label: r.dayLabel, items: [r] });
    }
    return out;
  }, [rows, actor, query]);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-2.5">
        <div className="inline-flex h-8 items-center rounded-md border border-con-line p-0.5" role="group" aria-label="Filter by actor">
          {ACTORS.map((a) => (
            <button
              key={a.value || "all"}
              type="button"
              aria-pressed={actor === a.value}
              onClick={() => setActor(a.value)}
              className={cn(
                "inline-flex h-full items-center rounded-[4px] px-2.5 text-[12px] transition-colors duration-150",
                actor === a.value ? "bg-con-row text-con-fg" : "text-con-fg3 hover:text-con-fg",
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg3 focus-within:border-con-line-hover sm:max-w-[280px]">
          <Search size={13} className="shrink-0" />
          <span className="sr-only">Filter this page</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter this page by action, target or actor"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3"
          />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear filter" className="text-con-fg3 hover:text-con-fg">
              <X size={13} />
            </button>
          )}
        </label>
        {(actor || query) && (
          <span className="text-[12px] text-con-fg3">
            {shown} of {rows.length} on this page
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-con-fg3">No entries on this page match the filter.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[14px]">
            <thead className="border-b border-con-line">
              <tr>
                <th className="h-10 w-[96px] whitespace-nowrap px-4 pl-5 text-left text-[12px] font-medium uppercase text-con-fg3">Time</th>
                <th className="h-10 whitespace-nowrap px-4 text-left text-[12px] font-medium uppercase text-con-fg3">Actor</th>
                <th className="h-10 whitespace-nowrap px-4 text-left text-[12px] font-medium uppercase text-con-fg3">Action</th>
                <th className="h-10 whitespace-nowrap px-4 text-left text-[12px] font-medium uppercase text-con-fg3">Target</th>
                <th className="h-10 whitespace-nowrap px-4 pr-5 text-left text-[12px] font-medium uppercase text-con-fg3">Details</th>
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.day} className="con-fade">
                <tr className="border-b border-con-line bg-con-bg/60">
                  <th colSpan={5} scope="rowgroup" className="h-8 px-5 text-left text-[12px] font-medium text-con-fg2">
                    {g.label}
                    <span className="ml-2 font-normal text-con-fg3">
                      {g.items.length} entr{g.items.length === 1 ? "y" : "ies"}
                    </span>
                  </th>
                </tr>
                {g.items.map((e) => {
                  const Icon = ACTOR_ICON[e.actor_type] ?? User;
                  return (
                    <tr key={e.id} className="border-b border-con-row align-top transition-colors duration-150 last:border-0 hover:bg-con-hover/60">
                      <td className="whitespace-nowrap px-4 py-2.5 pl-5 font-mono text-[12px] text-con-fg2" title={e.full}>
                        {e.time}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex max-w-[240px] items-center gap-2">
                          <Icon size={13} className="shrink-0 text-con-fg3" aria-label={e.actor_type.replace("_", " ")} />
                          <span className="truncate text-[13px] text-con-fg">{e.actor_label || e.actor_type}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="rounded bg-con-row px-1.5 py-0.5 font-mono text-[12px] text-con-fg">{e.action}</span>
                      </td>
                      <td className="max-w-[240px] break-all px-4 py-2.5 font-mono text-[12.5px] text-con-fg2">
                        <TargetLink e={e} />
                      </td>
                      <td className="px-4 py-2.5 pr-5">
                        <Meta meta={e.meta} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </>
  );
}

function TargetLink({ e }: { e: AuditEntry }) {
  if (/^dep_/.test(e.target))
    return (
      <Link href={`/app/deployments/${e.target}`} className="hover:text-con-fg hover:underline">
        {e.target}
      </Link>
    );
  if (e.action.startsWith("service."))
    return (
      <Link href={`/app/services/${encodeURIComponent(e.target)}`} className="hover:text-con-fg hover:underline">
        {e.target}
      </Link>
    );
  return <>{e.target || "none"}</>;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "none";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Compact key: value list; `changes` entries render as from → to. */
function Meta({ meta }: { meta: Record<string, unknown> }) {
  const entries = Object.entries(meta ?? {}).filter(([k]) => k !== "changes" && k !== "fields");
  const changes = (meta?.changes ?? null) as Record<string, { from: unknown; to: unknown }> | null;
  if (!entries.length && !changes) return <span className="text-[12px] text-con-fg3">none</span>;
  return (
    <dl className="max-w-[420px] space-y-0.5 text-[12px]">
      {changes &&
        Object.entries(changes).map(([k, c]) => (
          <div key={k} className="flex gap-2">
            <dt className="shrink-0 text-con-fg3">{k}</dt>
            <dd className="min-w-0 break-all font-mono text-con-fg2">
              {fmt(c.from)} → <span className="text-con-fg">{fmt(c.to)}</span>
            </dd>
          </div>
        ))}
      {entries.slice(0, 6).map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="shrink-0 text-con-fg3">{k}</dt>
          <dd className="min-w-0 break-all font-mono text-con-fg2">{fmt(v).slice(0, 160)}</dd>
        </div>
      ))}
    </dl>
  );
}
