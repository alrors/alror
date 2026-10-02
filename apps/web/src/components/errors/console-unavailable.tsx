"use client";

import { useRouter } from "next/navigation";
import { WorkspaceUnavailable } from "@/components/errors/workspace-unavailable";
import type { UnavailableKind } from "@/lib/error-kind";

/** Full-page outage screen rendered by the console layout; refreshes the route once the stores answer. */
export function ConsoleUnavailable({ kind, digest, autoCheck = true }: { kind: UnavailableKind; digest?: string; autoCheck?: boolean }) {
  const router = useRouter();
  return (
    <>
      <title>{kind === "cache_unavailable" ? "Cache unavailable · Alror" : "Database unavailable · Alror"}</title>
      <WorkspaceUnavailable kind={kind} digest={digest} variant="page" autoCheck={autoCheck} onRecover={() => router.refresh()} />
    </>
  );
}
