"use client";

import { DeploymentTable } from "@/components/console/deployment-table";
import { useReleasePrefs } from "@/components/console/release-prefs";
import type { Deployment } from "@/lib/console/types";

/** The deployments table with the viewer's remembered density and column choices. */
export function ReleaseTable({ deps, now }: { deps: Deployment[]; now: number }) {
  const [prefs] = useReleasePrefs();
  return <DeploymentTable deps={deps} now={now} hidden={prefs.hidden} density={prefs.density} />;
}
