"use client";

import { GlobalErrorView } from "@/components/errors/global-error-view";

/** /dev/errors preview of global-error.tsx (which only renders when the root layout fails). */
export function GlobalErrorPreview() {
  const error = Object.assign(new Error("Preview"), { digest: "2489173561" });
  return <GlobalErrorView error={error} retry={() => window.location.reload()} />;
}
