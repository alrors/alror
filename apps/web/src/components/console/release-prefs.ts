"use client";

// Per-viewer list preferences (density, hidden columns, saved views) kept in
// localStorage. Every access is wrapped: storage can be missing or throw.

import { useCallback, useSyncExternalStore } from "react";

export type Density = "comfortable" | "compact";
export const COLUMNS = [
  { key: "status", label: "Status" },
  { key: "risk", label: "Risk" },
  { key: "stages", label: "Stages" },
  { key: "traffic", label: "Traffic" },
  { key: "duration", label: "Duration" },
  { key: "source", label: "Source" },
  { key: "created", label: "Created" },
] as const;
export type ColumnKey = (typeof COLUMNS)[number]["key"];
export type SavedView = { name: string; query: string };

export type ReleasePrefs = { density: Density; hidden: ColumnKey[]; views: SavedView[] };

const KEY = "alror.releases.prefs.v1";
/** Source is off by default; the rest are on. */
export const DEFAULT_PREFS: ReleasePrefs = { density: "comfortable", hidden: ["source"], views: [] };

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ReleasePrefs = DEFAULT_PREFS;
/** Set when a write failed: serve the in-memory copy instead of storage. */
let memoryOnly = false;

function read(): ReleasePrefs {
  if (memoryOnly) return cached;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const p = raw ? (JSON.parse(raw) as Partial<ReleasePrefs>) : {};
    const keys = COLUMNS.map((c) => c.key) as string[];
    cached = {
      density: p.density === "compact" ? "compact" : "comfortable",
      hidden: Array.isArray(p.hidden) ? (p.hidden.filter((k) => keys.includes(k)) as ColumnKey[]) : DEFAULT_PREFS.hidden,
      views: Array.isArray(p.views)
        ? p.views.filter((v) => v && typeof v.name === "string" && typeof v.query === "string").slice(0, 12)
        : [],
    };
  } catch {
    cached = DEFAULT_PREFS;
  }
  return cached;
}

function write(next: ReleasePrefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: keep the change for this page view only
    memoryOnly = true;
  }
  cached = next;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => e.key === KEY && cb();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useReleasePrefs(): [ReleasePrefs, (patch: Partial<ReleasePrefs>) => void] {
  const prefs = useSyncExternalStore(subscribe, read, () => DEFAULT_PREFS);
  const update = useCallback((patch: Partial<ReleasePrefs>) => write({ ...read(), ...patch }), []);
  return [prefs, update];
}
