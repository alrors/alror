"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** "Error reference" line with a copy button, shown when Next provides a digest. */
export function ErrorReference({ digest, children }: { digest?: string | null; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  if (!digest && !children) return null;
  const copy = () => {
    if (!digest) return;
    navigator.clipboard?.writeText(digest).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[12px] text-con-fg3">
      {digest ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">Error reference</span>
          <code className="min-w-0 truncate rounded border border-con-line bg-con-panel px-1.5 py-0.5 font-mono text-[12px] text-con-fg2">{digest}</code>
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy error reference"}
            title={copied ? "Copied" : "Copy"}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-con-line text-con-fg3 transition-colors duration-150 hover:border-con-line-hover hover:text-con-fg"
          >
            {copied ? <Check size={12} className="con-scale-in" /> : <Copy size={12} />}
          </button>
        </span>
      ) : (
        <span />
      )}
      {children}
    </div>
  );
}
