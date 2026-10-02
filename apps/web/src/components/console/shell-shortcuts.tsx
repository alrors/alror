"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/console/dialog";
import { startNavigationProgress } from "@/components/console/shell-progress";
import { SHELL_EVENTS, isTyping, shellEmit, shellOn, useModKey } from "@/components/console/shell-events";

/** "g" then a letter jumps to a page. */
export const GO_TO: { key: string; label: string; href: string }[] = [
  { key: "o", label: "Overview", href: "/app" },
  { key: "s", label: "Services", href: "/app/services" },
  { key: "d", label: "Deployments", href: "/app/deployments" },
  { key: "j", label: "Jobs", href: "/app/jobs" },
  { key: "i", label: "Insights", href: "/app/insights" },
  { key: "m", label: "Marketplace", href: "/app/marketplace" },
  { key: "p", label: "Policies", href: "/app/policies" },
  { key: ",", label: "Settings", href: "/app/settings" },
];

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-con-line bg-con-bg px-1 font-sans text-[11px] text-con-fg2">
      {children}
    </kbd>
  );
}

/**
 * Global keyboard shortcuts for the console and the "?" shortcuts sheet.
 * Ctrl/⌘+K (palette) lives in the top bar and Ctrl/⌘+B (sidebar) in the sidebar.
 */
export function ShellShortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const pendingG = useRef<number>(0);
  const mod = useModKey();

  useEffect(() => shellOn(SHELL_EVENTS.openShortcuts, () => setOpen(true)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e)) return;
      if (document.querySelector("[aria-modal=true]") && e.key !== "?") return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      const now = Date.now();
      if (pendingG.current && now - pendingG.current < 1200) {
        pendingG.current = 0;
        const target = GO_TO.find((g) => g.key === e.key.toLowerCase());
        if (target) {
          e.preventDefault();
          startNavigationProgress(target.href);
          router.push(target.href);
        }
        return;
      }
      if (e.key === "g") pendingG.current = now;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const general: { keys: React.ReactNode; label: string }[] = [
    { keys: <><Kbd>{mod}</Kbd><Kbd>K</Kbd></>, label: "Search and run commands" },
    { keys: <><Kbd>{mod}</Kbd><Kbd>B</Kbd></>, label: "Collapse or expand the sidebar" },
    { keys: <Kbd>?</Kbd>, label: "Show this sheet" },
    { keys: <Kbd>Esc</Kbd>, label: "Close dialogs and menus" },
  ];

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" description="Shortcuts work anywhere in the console except while typing in a field." className="max-w-[560px]">
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">General</h3>
          <ul className="space-y-1.5">
            {general.map((g) => (
              <li key={g.label} className="flex items-center justify-between gap-3 text-[13px] text-con-fg2">
                <span>{g.label}</span>
                <span className="flex shrink-0 gap-1">{g.keys}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-[0.04em] text-con-fg3">Go to</h3>
          <ul className="space-y-1.5">
            {GO_TO.map((g) => (
              <li key={g.key} className="flex items-center justify-between gap-3 text-[13px] text-con-fg2">
                <span>{g.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Kbd>G</Kbd>
                  <span className="text-[11px] text-con-fg3">then</span>
                  <Kbd>{g.key.toUpperCase()}</Kbd>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="mt-5 flex justify-end border-t border-con-line pt-4">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            shellEmit(SHELL_EVENTS.openPalette);
          }}
          className="text-[13px] text-con-fg2 transition-colors duration-150 hover:text-con-fg"
        >
          Open the command palette
        </button>
      </div>
    </Dialog>
  );
}
