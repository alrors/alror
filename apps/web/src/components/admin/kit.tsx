import Link from "next/link";
import { Search } from "lucide-react";
import { CountUp } from "@/components/console/count-up";
import { buttonClass, inputClass, tableCell, tableHead } from "@/components/console/primitives";
import { cn } from "@/lib/site";

export { tableCell, tableHead };

/** KPI tile with an animated value. */
export function Kpi({
  label,
  value,
  decimals = 0,
  suffix,
  hint,
  tone,
  href,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  hint?: React.ReactNode;
  tone?: "warn" | "bad";
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[12px] font-medium uppercase tracking-wide text-con-fg3">{label}</p>
      <p className={cn("mt-2 text-[26px] font-semibold leading-none tracking-[-0.02em] text-con-fg", tone === "warn" && "text-con-warn", tone === "bad" && "text-con-bad")}>
        <CountUp value={value} decimals={decimals} suffix={suffix} />
      </p>
      {hint && <p className="mt-2 truncate text-[12px] text-con-fg3">{hint}</p>}
    </>
  );
  const cls = "block min-w-0 rounded-lg border border-con-line bg-con-panel px-4 py-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "con-lift hover:border-con-line-hover")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Page title row for admin pages. */
export function AdminHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-con-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[13px] text-con-fg2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** GET search box; keeps other params as hidden fields. */
export function SearchBox({
  action,
  q,
  placeholder,
  keep = {},
  children,
}: {
  action: string;
  q: string;
  placeholder: string;
  keep?: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} method="get" role="search" className="flex flex-wrap items-center gap-2 border-b border-con-line px-5 py-2.5">
      {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
        <span className="sr-only">Search</span>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-con-fg3" />
        <input name="q" defaultValue={q} placeholder={placeholder} className={cn(inputClass, "pl-8")} autoComplete="off" />
      </label>
      {children}
      <button type="submit" className={buttonClass.secondary}>
        Search
      </button>
    </form>
  );
}

export const pct = (x: number | null, digits = 0) => (x === null ? "n/a" : `${(x * 100).toFixed(digits)}%`);

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const shortDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "never");

export const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

/** First value of a search param. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
