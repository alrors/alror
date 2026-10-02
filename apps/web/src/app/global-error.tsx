"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { GlobalErrorView } from "@/components/errors/global-error-view";

// Replaces the root layout when it fails, so it brings its own <html> and <body>
// and does not depend on globals.css (inline styles only).
export default function GlobalError({ error, retry, reset }: { error: Error & { digest?: string }; retry?: () => void; reset?: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <html lang="en" style={{ colorScheme: "dark", background: "#121212" }}>
      <body style={{ margin: 0, background: "#121212" }}>
        <title>Something went wrong · Alror</title>
        <GlobalErrorView error={error} retry={retry ?? reset} />
      </body>
    </html>
  );
}
