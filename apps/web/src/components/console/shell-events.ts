import { useSyncExternalStore } from "react";

/**
 * Tiny window-event bus so shell pieces (top bar, sidebar, palette, shortcuts)
 * can ask each other to do things without sharing React state.
 */
export const SHELL_EVENTS = {
  toggleSidebar: "alror:toggle-sidebar",
  openPalette: "alror:open-palette",
  openShortcuts: "alror:open-shortcuts",
  openDeploy: "alror:open-deploy",
} as const;

export type ShellEvent = (typeof SHELL_EVENTS)[keyof typeof SHELL_EVENTS];

export function shellEmit(name: ShellEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}

export function shellOn(name: ShellEvent, fn: () => void): () => void {
  window.addEventListener(name, fn);
  return () => window.removeEventListener(name, fn);
}

/** True when the keyboard event comes from a text field, so global shortcuts should not fire. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

/** "Ctrl" on Windows/Linux, "⌘" on macOS (client only; falls back to Ctrl). */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl";
}

const noSubscribe = () => () => {};

/** Modifier label that is stable during hydration ("Ctrl" on the server). */
export function useModKey(): string {
  return useSyncExternalStore(noSubscribe, modKey, () => "Ctrl");
}
