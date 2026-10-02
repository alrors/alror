import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { listEnvironments, type Environment } from "@/lib/server/data/environments";
import { requireCtx } from "./auth";
import { ENV_COOKIE } from "./prefs";

/** The org's environments (production, staging, …), once per request. */
export const environments = cache(async (): Promise<Environment[]> => listEnvironments(await requireCtx()));

/**
 * The environment the console is filtered to: `?environment=` when given (and
 * valid), else the switcher cookie, else null (all environments).
 */
export async function selectedEnvironment(param?: string | string[]): Promise<string | null> {
  const envs = await environments();
  const p = Array.isArray(param) ? param[0] : param;
  if (p !== undefined) return p && envs.some((e) => e.name === p) ? p : null;
  const c = (await cookies()).get(ENV_COOKIE)?.value;
  return c && envs.some((e) => e.name === c) ? c : null;
}
