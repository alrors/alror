"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/site";

/**
 * Modal dialog: dimmed backdrop, Escape and backdrop click close it, focus moves
 * into the panel on open and back to the opener on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const first =
      panel.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      panel.current?.querySelector<HTMLElement>("input:not([type=hidden]):not([disabled]), select, textarea, button");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 py-[10vh]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" aria-label="Close dialog" tabIndex={-1} className="con-fade fixed inset-0 cursor-default bg-black/70" onClick={onClose} />
      <div
        ref={panel}
        className={cn("con-scale-in relative w-full max-w-[480px] rounded-lg border border-con-line bg-con-panel shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)]", className)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-con-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-con-fg">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-con-fg2">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-con-fg3 hover:bg-con-hover hover:text-con-fg">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
