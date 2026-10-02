"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { createApiKey as createKey, revokeApiKey as revokeKey } from "@/lib/server/auth/api-keys";
import { changeRole as setRole, createInvite as newInvite, removeMember as dropMember, revokeInvite as dropInvite } from "@/lib/server/auth/members";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { ROLES, SCOPES, type Role, type Scope } from "@/lib/server/db/schema";
import { updateOrg } from "@/lib/server/data/orgs";
import { env } from "@/lib/server/env";

// Settings actions. Every one re-validates the session and the data layer
// enforces owner/admin (requireAdmin) and org scoping.

export async function saveGeneral(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  try {
    await updateOrg(ctx, { name: field(formData, "name"), slug: field(formData, "slug") });
  } catch (e) {
    return actionError(e, "Could not save the organization.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved." };
}

const isRole = (v: string): v is Role => (ROLES as readonly string[]).includes(v);

export async function changeRole(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const role = field(formData, "role");
  if (!isRole(role)) return { error: "Choose owner, admin or member." };
  try {
    await setRole(ctx, field(formData, "user"), role);
  } catch (e) {
    return actionError(e, "Could not change the role.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Role updated." };
}

export async function removeMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const user = field(formData, "user");
  // Leaving the org yourself goes through the same call; managing others needs owner/admin.
  try {
    if (user !== ctx.actor.userId) requireAdmin(ctx);
    await dropMember(ctx, user);
  } catch (e) {
    return actionError(e, "Could not remove the member.");
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Member removed." };
}

export type InviteResult = (ActionResult & { link?: string; email?: string; expires_at?: string }) | undefined;

export async function createInvite(_prev: InviteResult, formData: FormData): Promise<InviteResult> {
  const ctx = await requireCtx();
  const role = field(formData, "role") || "member";
  if (!isRole(role)) return { error: "Choose owner, admin or member." };
  try {
    const { token, invite } = await newInvite(ctx, { email: field(formData, "email"), role });
    revalidatePath("/app/settings/invites");
    return { ok: true, link: `${env.publicUrl()}/invite/${token}`, email: invite.email, expires_at: invite.expires_at };
  } catch (e) {
    return actionError(e, "Could not create the invite.");
  }
}

export async function revokeInvite(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  try {
    await dropInvite(ctx, field(formData, "id"));
  } catch (e) {
    return actionError(e, "Could not revoke the invite.");
  }
  revalidatePath("/app/settings/invites");
  return { ok: true, message: "Invite revoked." };
}

export type KeyResult = (ActionResult & { token?: string; name?: string; scopes?: Scope[] }) | undefined;

export async function createApiKey(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  const ctx = await requireCtx();
  const scopes = formData.getAll("scopes").map(String);
  if (scopes.length === 0) return { error: "Pick at least one scope." };
  if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s))) return { error: "Unknown scope." };
  try {
    const { key, token } = await createKey(ctx, { name: field(formData, "name"), scopes: scopes as Scope[] });
    revalidatePath("/app/settings/api-keys");
    return { ok: true, token, name: key.name, scopes: key.scopes };
  } catch (e) {
    return actionError(e, "Could not create the key.");
  }
}

export async function revokeApiKey(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await requireCtx();
  const id = field(formData, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "API key not found." };
  try {
    await revokeKey(ctx, id);
  } catch (e) {
    return actionError(e, "Could not revoke the key.");
  }
  revalidatePath("/app/settings/api-keys");
  return { ok: true, message: "Key revoked." };
}
