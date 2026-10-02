"use client";

import { useCallback, useSyncExternalStore } from "react";

// Tiny localStorage-backed store for per-viewer Overview preferences. Reads and
// writes are wrapped in try/catch: when storage is blocked (private mode,
// policy), values live in memory for this page view, and the server snapshot
// (null) keeps the server render and hydration on the defaults.

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeLocal(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the in-memory copy above is used instead.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The raw stored string for `key` (null on the server, before hydration, or when unset). */
export function useLocalValue(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const set = useCallback((v: string | null) => writeLocal(key, v), [key]);
  return [value, set];
}
