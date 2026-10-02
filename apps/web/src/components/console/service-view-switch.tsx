"use client";

import { useState, useSyncExternalStore } from "react";
import { LayoutGrid, List } from "lucide-react";
import { SegmentedSelector } from "@/components/console/selector";

type View = "grid" | "list";

const KEY = "alror.console.services.view";
const EVT = "alror:services-view";

function read(): View | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "grid" || v === "list" ? v : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVT, cb);
  };
}

/**
 * Services toolbar + grid/list body. Both views are server-rendered; this picks one.
 * The choice is remembered per browser (localStorage); `?view=` in the URL wins until toggled.
 */
export function ServiceViewSwitch({
  initial,
  toolbar,
  actions,
  grid,
  list,
  footer,
}: {
  initial: View | null;
  toolbar: React.ReactNode;
  actions?: React.ReactNode;
  grid: React.ReactNode;
  list: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, read, () => null);
  const [picked, setPicked] = useState<View | null>(null);
  const view: View = picked ?? initial ?? stored ?? "grid";

  const choose = (v: View) => {
    setPicked(v);
    try {
      window.localStorage.setItem(KEY, v);
      window.dispatchEvent(new Event(EVT));
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <SegmentedSelector
            aria-label="Layout"
            value={view}
            onValueChange={(v) => choose(v as View)}
            items={[
              { value: "grid", label: null, icon: <LayoutGrid size={14} />, "aria-label": "Grid view", title: "Grid view" },
              { value: "list", label: null, icon: <List size={14} />, "aria-label": "List view", title: "List view" },
            ]}
          />
          {actions}
        </div>
      </div>
      <div key={view} className="con-fade">
        {view === "grid" ? grid : list}
      </div>
      {footer}
    </div>
  );
}
