"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/console/primitives";
import { cn } from "@/lib/site";

export function CopyButton({ text, label = "Copy", iconOnly, className }: { text: string; label?: string; iconOnly?: boolean; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(text).then(
      () => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      },
      () => {},
    );
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${label}: ${text}`}
      className={cn(iconOnly ? "grid h-7 w-7 place-items-center rounded-md border border-con-line text-con-fg2 hover:text-con-fg" : buttonClass.secondary, className)}
    >
      {done ? <Check size={13} className="con-scale-in" /> : <Copy size={13} />}
      {!iconOnly && (done ? "Copied" : label)}
    </button>
  );
}
