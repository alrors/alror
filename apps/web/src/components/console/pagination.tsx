import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PerPageSelect } from "@/components/console/per-page-select";
import { cn } from "@/lib/site";
import { DEFAULT_PER, pageWindow, PAGE_SIZES, type Page } from "@/lib/console/paginate";

type Params = Record<string, string | undefined>;

export function hrefWith(base: string, params: Params, patch: Params): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v !== undefined && v !== "") q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

const box =
  "inline-grid h-8 min-w-8 place-items-center rounded-md border px-2 text-[13px] tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-con-fg3";
const enabled = "border-con-line text-con-fg2 hover:border-con-line-hover hover:bg-con-hover hover:text-con-fg";
const disabled = "cursor-not-allowed border-con-line/60 text-con-fg3/50";

function Nav({ href, label, rel, children }: { href: string | null; label: string; rel?: string; children: React.ReactNode }) {
  return href ? (
    <Link href={href} rel={rel} aria-label={label} className={cn(box, enabled)} scroll>
      {children}
    </Link>
  ) : (
    <span aria-label={label} aria-disabled="true" className={cn(box, disabled)}>
      {children}
    </span>
  );
}

/**
 * Footer pagination with plain links (works without JS). `params` are the active
 * filters to preserve; `pageKey`/`perKey` let one page host several paged lists.
 */
export function Pagination({
  meta,
  noun,
  base,
  params,
  pageKey = "page",
  perKey = "per",
  showPer = true,
  className,
}: {
  meta: Page<unknown>;
  noun: string;
  base: string;
  params: Params;
  pageKey?: string;
  perKey?: string;
  showPer?: boolean;
  className?: string;
}) {
  const { page, pages, from, to, total, per } = meta;
  const keep: Params = { ...params, [perKey]: per !== DEFAULT_PER ? String(per) : undefined };
  const link = (p: number) => hrefWith(base, keep, { [pageKey]: p > 1 ? String(p) : undefined });
  const prev = page > 1 ? link(page - 1) : null;
  const next = page < pages ? link(page + 1) : null;

  return (
    <nav
      aria-label={`${noun} pagination`}
      className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-con-line px-5 py-3", className)}
    >
      <div className="flex items-center gap-4 text-[13px] text-con-fg2">
        <span className="hidden sm:inline">
          {total === 0 ? (
            `No ${noun}`
          ) : (
            <>
              Showing <span className="tabular-nums text-con-fg">{from}–{to}</span> of{" "}
              <span className="tabular-nums text-con-fg">{total}</span> {noun}
            </>
          )}
        </span>
        {showPer && (
          <span className="hidden md:inline-flex">
            <PerPageSelect base={base} params={params} perKey={perKey} value={per} options={[...PAGE_SIZES]} />
          </span>
        )}
      </div>

      {/* Mobile: Prev · Page 2 of 8 · Next */}
      <div className="flex w-full items-center justify-between gap-2 sm:hidden">
        <Nav href={prev} label="Previous page" rel="prev">
          <span className="flex items-center gap-1 px-1">
            <ChevronLeft size={14} /> Prev
          </span>
        </Nav>
        <span className="text-[13px] tabular-nums text-con-fg2">
          Page {page} of {pages}
        </span>
        <Nav href={next} label="Next page" rel="next">
          <span className="flex items-center gap-1 px-1">
            Next <ChevronRight size={14} />
          </span>
        </Nav>
      </div>

      <div className="hidden items-center gap-1 sm:flex">
        <Nav href={page > 1 ? link(1) : null} label="First page">
          <ChevronsLeft size={14} />
        </Nav>
        <Nav href={prev} label="Previous page" rel="prev">
          <ChevronLeft size={14} />
        </Nav>
        {pageWindow(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="inline-grid h-8 w-6 place-items-center text-[13px] text-con-fg3" aria-hidden>
              …
            </span>
          ) : p === page ? (
            <span key={p} aria-current="page" aria-label={`Page ${p}`} className={cn(box, "border-con-line-hover bg-con-row text-white")}>
              {p}
            </span>
          ) : (
            <Link key={p} href={link(p)} aria-label={`Page ${p}`} className={cn(box, enabled)}>
              {p}
            </Link>
          ),
        )}
        <Nav href={next} label="Next page" rel="next">
          <ChevronRight size={14} />
        </Nav>
        <Nav href={page < pages ? link(pages) : null} label="Last page">
          <ChevronsRight size={14} />
        </Nav>
      </div>
    </nav>
  );
}
