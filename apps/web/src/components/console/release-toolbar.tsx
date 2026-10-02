"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, Columns3, Download, Rows2, Rows4, X } from "lucide-react";
import { COLUMNS, useReleasePrefs, type ColumnKey } from "@/components/console/release-prefs";
import { buttonClass } from "@/components/console/primitives";
import { SegmentedSelector, Selector } from "@/components/console/selector";
import { cn } from "@/lib/site";

type Params = Record<string, string | undefined>;

function query(params: Params, patch: Params = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v !== undefined && v !== "") q.set(k, v);
  return q.toString();
}

/**
 * List options: sort, column visibility, density, CSV export and saved views.
 * Density, columns and saved views stay in this browser (localStorage).
 */
export function ReleaseToolbar({
  params,
  sorts,
  sort,
  total,
}: {
  /** Active filters (without page). */
  params: Params;
  sorts: readonly { value: string; label: string }[];
  sort: string;
  total: number;
}) {
  const router = useRouter();
  const [prefs, update] = useReleasePrefs();
  const [naming, setNaming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const current = query({ ...params, page: undefined });

  const toggleColumn = (k: ColumnKey) => update({ hidden: prefs.hidden.includes(k) ? prefs.hidden.filter((x) => x !== k) : [...prefs.hidden, k] });
  const saveView = (name: string) => {
    const n = name.trim().slice(0, 40);
    if (!n) return;
    update({ views: [...prefs.views.filter((v) => v.name !== n), { name: n, query: current }].slice(-12) });
    setNaming(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-2.5">
      {/* Saved views */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {prefs.views.length === 0 && !naming && <span className="text-[12px] text-con-fg3">No saved views yet.</span>}
        {prefs.views.map((v) => {
          const on = v.query === current;
          return (
            <span
              key={v.name}
              className={cn(
                "con-ease group inline-flex h-7 items-center rounded-md border text-[12px]",
                on ? "border-con-line-hover bg-con-row text-con-fg" : "border-con-line text-con-fg2 hover:border-con-line-hover hover:text-con-fg",
              )}
            >
              <button type="button" onClick={() => router.push(v.query ? `/app/deployments?${v.query}` : "/app/deployments")} className="inline-flex h-full items-center gap-1.5 pl-2 pr-1">
                <Bookmark size={12} className="text-con-fg3" />
                {v.name}
              </button>
              <button
                type="button"
                aria-label={`Delete saved view ${v.name}`}
                onClick={() => update({ views: prefs.views.filter((x) => x.name !== v.name) })}
                className="grid h-full w-6 place-items-center text-con-fg3 hover:text-con-fg"
              >
                <X size={12} />
              </button>
            </span>
          );
        })}
        {naming ? (
          <form
            className="con-fade inline-flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              saveView(nameRef.current?.value ?? "");
            }}
          >
            <input
              ref={nameRef}
              autoFocus
              maxLength={40}
              placeholder="View name"
              aria-label="Name for this view"
              onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
              className="h-7 w-36 rounded-md border border-con-line bg-con-bg px-2 text-[12px] text-con-fg outline-none placeholder:text-con-fg3 focus-visible:border-con-line-hover"
            />
            <button type="submit" className="h-7 rounded-md border border-con-line-hover px-2 text-[12px] text-con-fg hover:bg-con-hover">
              Save
            </button>
            <button type="button" onClick={() => setNaming(false)} className="h-7 px-1 text-[12px] text-con-fg3 hover:text-con-fg">
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="con-ease inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-con-fg2 hover:bg-con-hover hover:text-con-fg"
            title="Save the current filters and sort as a view in this browser"
          >
            + Save view
          </button>
        )}
      </div>

      {/* Sort */}
      <Selector
        size="sm"
        variant="field"
        className="w-auto"
        aria-label="Sort deployments"
        prefix="Sort"
        align="end"
        minWidth={200}
        value={sort}
        onValueChange={(v) => {
          const q = query({ ...params, page: undefined }, { sort: v === "newest" ? undefined : v });
          router.push(q ? `/app/deployments?${q}` : "/app/deployments");
        }}
        options={sorts.map((s) => ({ value: s.value, label: s.label }))}
      />

      {/* Columns */}
      <details className="group relative">
        <summary className="con-ease inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md border border-con-line px-2 text-[12px] text-con-fg2 hover:border-con-line-hover hover:text-con-fg [&::-webkit-details-marker]:hidden">
          <Columns3 size={13} />
          Columns
        </summary>
        <div className="con-scale-in absolute right-0 z-20 mt-1.5 w-44 origin-top-right rounded-md border border-con-line bg-con-panel p-1.5 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)]">
          {COLUMNS.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-con-fg2 hover:bg-con-hover hover:text-con-fg">
              <input type="checkbox" checked={!prefs.hidden.includes(c.key)} onChange={() => toggleColumn(c.key)} className="h-3.5 w-3.5 accent-[#ededed]" />
              {c.label}
            </label>
          ))}
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-con-fg3">Some columns only show on wide screens.</p>
        </div>
      </details>

      {/* Density */}
      <SegmentedSelector
        size="sm"
        aria-label="Row density"
        value={prefs.density}
        onValueChange={(v) => update({ density: v as "comfortable" | "compact" })}
        items={[
          { value: "comfortable", label: null, icon: <Rows2 size={13} />, "aria-label": "Comfortable rows", title: "Comfortable rows" },
          { value: "compact", label: null, icon: <Rows4 size={13} />, "aria-label": "Compact rows", title: "Compact rows" },
        ]}
      />

      {/* Export */}
      <a
        href={`/app/deployments/export${current ? `?${current}` : ""}`}
        download
        className={cn(buttonClass.secondary, "h-7 px-2 text-[12px]", total === 0 && "pointer-events-none opacity-50")}
        aria-disabled={total === 0}
        title="Download every deployment matching these filters as CSV"
      >
        <Download size={13} />
        CSV
      </a>
    </div>
  );
}
