"use client";

import { useState } from "react";
import { kindOf } from "@/lib/error-kind";

// The body of app/global-error.tsx, which replaces the root layout when it
// fails. Global styles may not have loaded (or may be what failed), so this uses
// inline styles and system fonts only. /dev/errors renders it directly as a preview.

const c = {
  bg: "#121212",
  panel: "#171717",
  line: "#2e2e2e",
  fg: "#ededed",
  fg2: "#a1a1a1",
  fg3: "#737373",
};
const font = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const button: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 32,
  padding: "0 12px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  fontFamily: font,
  cursor: "pointer",
  textDecoration: "none",
};

export function GlobalErrorView({ error, retry }: { error: Error & { digest?: string }; retry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const kind = kindOf(error);
  const title =
    kind === "database_unavailable"
      ? "Alror can't reach its database"
      : kind === "cache_unavailable"
        ? "Alror can't reach its cache (Redis)"
        : "Alror couldn't load this page";
  const body =
    kind === "database_unavailable" || kind === "cache_unavailable"
      ? "Start the local services with docker compose up -d, check DATABASE_URL and REDIS_URL, then try again."
      : "Something failed before the page could render. Trying again usually works. If it keeps happening, send the error reference to whoever runs your Alror instance.";

  return (
    <div
      style={{
        minHeight: "100dvh",
        margin: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 16px",
        boxSizing: "border-box",
        background: c.bg,
        color: c.fg,
        fontFamily: font,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <main style={{ width: "100%", maxWidth: 520 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="0.5" y="0.5" width="23" height="23" rx="7" fill="#151518" stroke="#2d2d32" />
          <path d="M7 18v-7a5 5 0 0 1 10 0v7" stroke="#f2f2f3" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="15.5" r="1.9" fill="#35e08f" />
        </svg>
        <h1 style={{ margin: "24px 0 0", fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: "-0.025em" }}>{title}</h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6, color: c.fg2 }}>{body}</p>
        <div style={{ marginTop: 28, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => (retry ? retry() : window.location.reload())}
            style={{ ...button, border: "none", background: c.fg, color: "#000" }}
          >
            Try again
          </button>
          {/* A full page load on purpose: the root layout (and maybe the router) just failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" style={{ ...button, border: "1px solid #3e3e3e", background: "transparent", color: c.fg }}>
            Go to the home page
          </a>
        </div>
        {error.digest && (
          <div
            style={{
              marginTop: 36,
              paddingTop: 16,
              borderTop: `1px solid ${c.line}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: c.fg3,
              flexWrap: "wrap",
            }}
          >
            <span>Error reference</span>
            <code style={{ fontFamily: mono, fontSize: 12, color: c.fg2, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 4, padding: "2px 6px" }}>
              {error.digest}
            </code>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(error.digest ?? "").then(
                  () => setCopied(true),
                  () => {},
                )
              }
              style={{ ...button, height: 24, padding: "0 8px", fontSize: 12, border: `1px solid ${c.line}`, background: "transparent", color: c.fg2 }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
