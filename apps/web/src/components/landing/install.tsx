"use client";

import { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/site";

export const REPO_URL = "https://github.com/alrors/alror";

const OPTIONS = [
  { id: "sh", label: "macOS / Linux", prompt: "$", cmd: "curl -fsSL https://raw.githubusercontent.com/alrors/alror/main/scripts/install.sh | sh" },
  { id: "ps", label: "Windows", prompt: "PS>", cmd: "irm https://raw.githubusercontent.com/alrors/alror/main/scripts/install.ps1 | iex" },
  { id: "go", label: "Go", prompt: "$", cmd: "go install github.com/alrors/alror/cmd/alror@latest" },
] as const;

/** Install command with platform tabs and a copy button. */
export function InstallCommand({ className }: { className?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const base = useId();
  const opt = OPTIONS[active];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(opt.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the command is still selectable */
    }
  };

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length;
    setActive(next);
    document.getElementById(`${base}-tab-${next}`)?.focus();
  };

  return (
    <div className={cn("lp-panel overflow-hidden rounded-xl text-left", className)}>
      <div role="tablist" aria-label="Install the CLI" className="flex items-center gap-1 border-b border-[#1d1d22] px-2 pt-2">
        {OPTIONS.map((o, i) => (
          <button
            key={o.id}
            id={`${base}-tab-${i}`}
            role="tab"
            type="button"
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "-mb-px border-b px-2.5 pb-2 pt-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-white/60",
              i === active ? "border-[#f4f4f5] text-fg" : "border-transparent text-[#6e6e78] hover:text-[#a3a3ad]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="flex items-center gap-3 py-3 pl-4 pr-2">
        <code className="lp-scroll min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12.5px] leading-6 text-[#d4d4d8]">
          <span className="select-none text-[#6e6e78]">{opt.prompt} </span>
          {opt.cmd}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy install command"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#a3a3ad] transition-colors hover:bg-white/[0.06] hover:text-fg focus-visible:outline-2 focus-visible:outline-white/60"
        >
          {copied ? <Check className="h-4 w-4 text-[#35e08f]" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? "Install command copied" : ""}
      </span>
    </div>
  );
}
