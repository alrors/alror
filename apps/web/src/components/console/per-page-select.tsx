"use client";

import { useRouter } from "next/navigation";
import { Selector } from "@/components/console/selector";

/** "Rows per page" select. Navigates on change; the GET form keeps it working without JS. */
export function PerPageSelect({
  base,
  params,
  perKey,
  value,
  options,
}: {
  base: string;
  params: Record<string, string | undefined>;
  perKey: string;
  value: number;
  options: number[];
}) {
  const router = useRouter();
  const hidden = Object.entries(params).filter(([k, v]) => v && k !== perKey && !k.toLowerCase().includes("page"));
  return (
    <form action={base} method="get" className="flex items-center gap-2">
      {hidden.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor={`per-${perKey}`} className="text-[13px] text-con-fg2">
        Rows per page
      </label>
      <Selector
        id={`per-${perKey}`}
        name={perKey}
        className="w-20"
        minWidth={96}
        align="end"
        searchable={false}
        defaultValue={String(value)}
        onValueChange={(v) => {
          const q = new URLSearchParams(hidden as [string, string][]);
          if (v !== "25") q.set(perKey, v);
          const s = q.toString();
          router.push(s ? `${base}?${s}` : base);
        }}
        options={options.map((o) => ({ value: String(o), label: String(o) }))}
      />
      <noscript>
        <button type="submit" className="h-8 rounded-md border border-con-line px-2 text-[13px] text-con-fg2">
          Apply
        </button>
      </noscript>
    </form>
  );
}
