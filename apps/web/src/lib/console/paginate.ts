// Pure pagination helpers shared by every paged console list.

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PER = 25;

export type Page<T> = {
  items: T[];
  page: number; // 1-based, clamped into range
  per: number;
  total: number;
  pages: number; // at least 1
  from: number; // 1-based index of the first item shown (0 when empty)
  to: number;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Reads ?per= and only accepts the offered sizes. */
export function parsePer(v: string | string[] | undefined, allowed: readonly number[] = PAGE_SIZES, fallback = DEFAULT_PER): number {
  const n = Number(first(v));
  return allowed.includes(n) ? n : fallback;
}

/** Reads ?page=; anything unparseable becomes 1. Range clamping happens in paginate(). */
export function parsePage(v: string | string[] | undefined): number {
  const n = Math.floor(Number(first(v)));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function paginate<T>(items: T[], page: number, per: number): Page<T> {
  const size = Math.max(1, Math.floor(per) || DEFAULT_PER);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * size;
  const slice = items.slice(start, start + size);
  return { items: slice, page: p, per: size, total, pages, from: total ? start + 1 : 0, to: start + slice.length };
}

/** Page numbers with ellipses, e.g. [1, "…", 4, 5, 6, "…", 12]. */
export function pageWindow(page: number, pages: number, radius = 1): (number | "…")[] {
  const out: (number | "…")[] = [];
  const lo = Math.max(2, page - radius);
  const hi = Math.min(pages - 1, page + radius);
  out.push(1);
  if (lo > 2) out.push("…");
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push("…");
  if (pages > 1) out.push(pages);
  return out;
}

/** Page metadata for a list paged in the database (items already sliced, total counted separately). */
export function pageMeta<T>(items: T[], total: number, page: number, per: number): Page<T> {
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * per;
  return { items, page: p, per, total, pages, from: total ? start + 1 : 0, to: start + items.length };
}
