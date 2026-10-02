import type { ActorType, Role, Scope } from "./db/schema";
import { forbidden } from "./errors";

/** Who is acting. Every data-layer call carries one, together with the org it acts in. */
export type Actor = {
  type: ActorType;
  /** user id, api key id, or null for the system */
  id: string | null;
  /** email, key name or "system", for audit rows */
  label: string;
  userId?: string;
  keyId?: string;
  role?: Role;
  scopes: Scope[];
};

/** Org-scoped request context. Data-layer functions take this first, so every query is scoped by construction. */
export type OrgCtx = { orgId: string; actor: Actor };

export const ALL_SCOPES: Scope[] = ["deploy:read", "deploy:write", "jobs:run", "config:write"];

export function isAdminRole(role: Role | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Scopes a console session gets: members read and deploy, owners and admins also write config. */
export function scopesForRole(role: Role): Scope[] {
  return isAdminRole(role) ? ["deploy:read", "deploy:write", "config:write"] : ["deploy:read", "deploy:write"];
}

export function systemActor(): Actor {
  return { type: "system", id: null, label: "system", scopes: ALL_SCOPES };
}

export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.type === "system" || actor.scopes.includes(scope);
}

export function requireScope(ctx: OrgCtx, scope: Scope): void {
  if (!hasScope(ctx.actor, scope)) throw forbidden(`This action needs the ${scope} scope.`);
}

/** Owner or admin session (members, keys, services, policy management). */
export function requireAdmin(ctx: OrgCtx): void {
  if (ctx.actor.type === "system") return;
  if (ctx.actor.type !== "user" || !isAdminRole(ctx.actor.role)) throw forbidden("Only owners and admins can do that.");
}
