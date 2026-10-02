import "server-only";

/** Number from a raw SQL value (bigint counts come back as strings). */
export const num = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * ISO string from a raw timestamptz value. Raw `db.execute` rows carry Postgres'
 * text form ("2026-10-02 09:15:01.12+00"), which Date cannot always parse.
 */
export function isoTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  let s = String(v).trim().replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escapes LIKE wildcards in user search input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
