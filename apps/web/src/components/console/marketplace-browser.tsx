"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { MarketCard, type MarketItem } from "@/components/console/marketplace-card";
import { Card, EmptyState } from "@/components/console/primitives";
import { SegmentedSelector, Selector } from "@/components/console/selector";

export type MarketShow = "all" | "installed" | "available" | "planned";
const MARKET_SHOWS: MarketShow[] = ["all", "installed", "available", "planned"];

const SHOW_LABEL: Record<MarketShow, string> = { all: "All", installed: "Installed", available: "Available", planned: "Planned" };

/** Installed covers what is on for the org (built-ins included); Available is what can be added or set up. */
function inShow(item: MarketItem, show: MarketShow): boolean {
  switch (show) {
    case "installed":
      return item.state === "installed" || item.state === "disabled" || item.state === "builtin";
    case "available":
      return item.state === "available" || item.state === "guide";
    case "planned":
      return item.state === "planned";
    default:
      return true;
  }
}

function matches(item: MarketItem, q: string): boolean {
  if (!q) return true;
  return q.split(/\s+/).every((w) => item.search.includes(w));
}

/**
 * The marketplace list: search, category, state, a featured row and the grid,
 * grouped by category. Filtering is instant on the client; the URL keeps the
 * filters so a view can be shared or reloaded.
 */
export function MarketplaceBrowser({
  items,
  categories,
  featured,
  initial,
}: {
  items: MarketItem[];
  categories: { value: string; label: string }[];
  featured: string[];
  initial: { q: string; category: string; show: MarketShow };
}) {
  const [query, setQuery] = useState(initial.q);
  const [category, setCategory] = useState(initial.category);
  const [show, setShow] = useState<MarketShow>(initial.show);
  const q = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (k: string, v: string, empty: string) => (v && v !== empty ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set("q", q, "");
    set("category", category, "");
    set("show", show, "all");
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [q, category, show]);

  const byQuery = useMemo(() => items.filter((i) => matches(i, q)), [items, q]);
  const showCounts = useMemo(
    () => Object.fromEntries(MARKET_SHOWS.map((s) => [s, byQuery.filter((i) => (!category || i.category === category) && inShow(i, s)).length])) as Record<MarketShow, number>,
    [byQuery, category],
  );
  const scoped = useMemo(() => byQuery.filter((i) => inShow(i, show)), [byQuery, show]);
  const visible = useMemo(() => scoped.filter((i) => !category || i.category === category), [scoped, category]);

  const filtersOn = Boolean(q || category || show !== "all");
  const featuredItems = filtersOn ? [] : featured.map((id) => items.find((i) => i.id === id)).filter((i): i is MarketItem => Boolean(i));
  const groups = categories
    .filter((c) => !category || c.value === category)
    .map((c) => ({ ...c, items: visible.filter((i) => i.category === c.value) }))
    .filter((g) => g.items.length > 0);

  const reset = () => {
    setQuery("");
    setCategory("");
    setShow("all");
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[200px] flex-1 items-center gap-2 rounded-md border border-con-line bg-con-bg px-2.5 text-con-fg3 focus-within:border-con-line-hover sm:max-w-xs">
          <Search size={14} aria-hidden />
          <span className="sr-only">Search plugins and libraries</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins and libraries"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-con-fg outline-none placeholder:text-con-fg3"
          />
        </label>
        <Selector
          aria-label="Category"
          className="w-auto"
          minWidth={240}
          value={category}
          onValueChange={setCategory}
          options={[
            { value: "", label: "All categories", meta: scoped.length },
            ...categories.map((c) => ({ value: c.value, label: c.label, meta: scoped.filter((i) => i.category === c.value).length })),
          ]}
        />
        {filtersOn && (
          <button type="button" onClick={reset} className="px-1 text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg">
            Reset
          </button>
        )}
        <SegmentedSelector
          aria-label="Show"
          className="sm:ml-auto"
          value={show}
          onValueChange={(v) => setShow(v as MarketShow)}
          items={MARKET_SHOWS.map((s) => ({
            value: s,
            label: (
              <span className="inline-flex items-center gap-1.5">
                {SHOW_LABEL[s]}
                <span className="font-mono text-[11px] tabular-nums text-con-fg3">{showCounts[s]}</span>
              </span>
            ),
          }))}
        />
      </div>

      {featuredItems.length > 0 && (
        <section aria-labelledby="mk-featured">
          <h2 id="mk-featured" className="mb-3 text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">
            Featured
          </h2>
          <div className="con-stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {featuredItems.map((item) => (
              <MarketCard key={item.id} item={item} featured />
            ))}
          </div>
        </section>
      )}

      {items.length === 0 ? (
        <Card>
          <EmptyState title="The catalog is empty">No plugins or libraries are listed for this workspace yet.</EmptyState>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <EmptyState title="Nothing matches">
            {q ? <>No plugin or library matches &ldquo;{q}&rdquo; with these filters. </> : <>No {SHOW_LABEL[show].toLowerCase()} items in this category. </>}
            <button type="button" onClick={reset} className="text-con-fg underline-offset-4 hover:underline">
              Reset filters
            </button>
          </EmptyState>
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.value} aria-labelledby={`mk-${g.value}`}>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 id={`mk-${g.value}`} className="text-[15px] font-semibold text-con-fg">
                {g.label}
              </h2>
              <span className="font-mono text-[12px] tabular-nums text-con-fg3">{g.items.length}</span>
            </div>
            <div className="con-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {g.items.map((item) => (
                <MarketCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
