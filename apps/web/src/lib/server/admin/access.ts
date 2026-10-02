import "server-only";
import type { SessionContext } from "../auth/accounts";
import type { Actor, OrgCtx } from "../context";
import { ApiError } from "../errors";

// Platform admins operate the whole Alror instance (every org), unlike org
// owners/admins who manage one org in /app/settings. Who is one comes from the
// environment, not the database:
//
//   ALROR_PLATFORM_ADMINS=ops@example.com,me@example.com
//
// Unset in development: admin@acme.test (the seed's owner). Unset in production: nobody.

export const DEV_DEFAULT_ADMINS = ["admin@acme.test"];

export function platformAdmins(): string[] {
  const raw = process.env.ALROR_PLATFORM_ADMINS;
  if (raw === undefined || raw.trim() === "") return process.env.NODE_ENV === "production" ? [] : DEV_DEFAULT_ADMINS;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether the admin list comes from the environment or the development default. */
export function adminsSource(): "env" | "dev-default" | "none" {
  const raw = process.env.ALROR_PLATFORM_ADMINS;
  if (raw !== undefined && raw.trim() !== "") return "env";
  return process.env.NODE_ENV === "production" ? "none" : "dev-default";
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdmins().includes(email.trim().toLowerCase());
}

/** A validated platform admin: their console session plus an actor for audit rows. */
export type AdminCtx = { session: SessionContext; email: string; userId: string; actor: Actor };

export function toAdmin(s: SessionContext): AdminCtx {
  return {
    session: s,
    email: s.user.email,
    userId: s.user.id,
    // Audit rows show who did it and that it came from the admin area.
    actor: { type: "user", id: s.user.id, label: `${s.user.email} (platform admin)`, userId: s.user.id, role: "owner", scopes: [] },
  };
}

/** An org-scoped context for reusing org data-layer reads on behalf of the admin. */
export function orgCtxFor(admin: AdminCtx, orgId: string): OrgCtx {
  return { orgId, actor: admin.actor };
}

/** Throws unless `admin` is a platform admin; every admin data function calls this first. */
export function assertAdmin(admin: AdminCtx | null | undefined): asserts admin is AdminCtx {
  if (!admin || !isPlatformAdmin(admin.email)) throw new ApiError(404, "not_found", "Not found.");
}
