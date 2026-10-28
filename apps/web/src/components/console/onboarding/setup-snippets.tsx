"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { CopyButton } from "@/components/console/copy-button";
import { cn } from "@/lib/site";

// Tabbed, copy-ready snippets for the setup checklist. The first tab shown is
// the one inferred by the server; a choice the viewer makes is remembered.

export type Snippet = { id: string; label: string; code: string };

const KEY = "alror:setup-tab";

function readSaved(name: string): string | null {
  try {
    return localStorage.getItem(`${KEY}:${name}`);
  } catch {
    return null;
  }
}
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

export function SetupSnippets({ snippets, initial, name }: { snippets: Snippet[]; initial: string; name: string }) {
  const saved = useSyncExternalStore(subscribe, () => readSaved(name), () => null);
  const [picked, setPicked] = useState<string | null>(null);
  const base = useId();
  const active = [picked, saved, initial].find((id) => id && snippets.some((s) => s.id === id)) ?? snippets[0].id;
  const pick = (id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(`${KEY}:${name}`, id);
    } catch {
      // not remembered; fine
    }
  };
  const cur = snippets.find((s) => s.id === active) ?? snippets[0];

  return (
    <div className="overflow-hidden rounded-md border border-con-line bg-con-bg">
      <div role="tablist" aria-label={name} className="flex items-center gap-1 border-b border-con-line px-2 pt-1.5">
        {snippets.map((s) => (
          <button
            key={s.id}
            id={`${base}-${s.id}`}
            type="button"
            role="tab"
            aria-selected={s.id === cur.id}
            aria-controls={`${base}-panel`}
            onClick={() => pick(s.id)}
            className={cn(
              "-mb-px border-b px-2 pb-1.5 pt-1 text-[12px] transition-colors duration-150",
              s.id === cur.id ? "border-con-fg text-con-fg" : "border-transparent text-con-fg3 hover:text-con-fg2",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto pb-1">
          <CopyButton text={cur.code} iconOnly />
        </span>
      </div>
      <pre id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${cur.id}`} className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-con-fg">
        {cur.code}
      </pre>
    </div>
  );
}
