import { Fragment } from "react";
import { CopyButton } from "@/components/console/copy-button";
import type { Snippet } from "@/lib/server/marketplace/catalog";
import { cn } from "@/lib/site";

/* Server-renderable building blocks for /app/marketplace/[id]. */

/** `code` and **bold** inside a catalog sentence. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 1 ? (
          <code key={i} className="rounded bg-con-row px-1 py-px font-mono text-[12.5px] text-con-fg">
            {p.slice(1, -1)}
          </code>
        ) : p.startsWith("**") && p.endsWith("**") && p.length > 3 ? (
          <strong key={i} className="font-semibold text-con-fg">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/** Catalog long text: paragraphs separated by blank lines, "- " lines as bullets. */
export function MarketRichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={cn("space-y-3 text-[14px] leading-[1.65] text-con-fg2", className)}>
      {blocks.map((b, i) => {
        const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length && lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="space-y-1.5">
              {lines.map((l, j) => (
                <li key={j} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-con-fg3" />
                  <span className="min-w-0">
                    <Inline text={l.slice(2)} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Inline text={lines.join(" ")} />
          </p>
        );
      })}
    </div>
  );
}

const LANG: Record<Snippet["lang"], string> = { sh: "Shell", powershell: "PowerShell", yaml: "YAML", go: "Go", ts: "TypeScript" };

/** A copyable code block for CLI commands, YAML and library examples. */
export function MarketSnippet({ snippet, className }: { snippet: Snippet; className?: string }) {
  return (
    <div className={cn("min-w-0 overflow-hidden rounded-md border border-con-line bg-con-bg", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-con-line py-1.5 pl-3 pr-1.5">
        <span className="truncate text-[12px] text-con-fg2">
          {snippet.label}
          {snippet.label !== LANG[snippet.lang] && <span className="text-con-fg3"> · {LANG[snippet.lang]}</span>}
        </span>
        <CopyButton text={snippet.code} label={`Copy ${snippet.label}`} iconOnly className="h-7 w-7 border-transparent hover:border-con-line" />
      </div>
      <pre className="con-scroll overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-con-fg">
        <code>{snippet.code}</code>
      </pre>
    </div>
  );
}

/** Numbered setup steps, each with an optional body and snippet. */
export function MarketSteps({ steps }: { steps: { title: string; body?: string; snippet?: Snippet }[] }) {
  return (
    <ol className="space-y-5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-con-line font-mono text-[12px] tabular-nums text-con-fg2">{i + 1}</span>
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <p className="text-[14px] font-medium text-con-fg">{s.title}</p>
            {s.body && (
              <p className="text-[13px] leading-[1.6] text-con-fg2">
                <Inline text={s.body} />
              </p>
            )}
            {s.snippet && <MarketSnippet snippet={s.snippet} />}
          </div>
        </li>
      ))}
    </ol>
  );
}
