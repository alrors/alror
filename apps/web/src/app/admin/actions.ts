"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requirePlatformAdmin } from "@/lib/server/admin/guard";
import { cancelJobAdmin, requeueJobAdmin } from "@/lib/server/admin/jobs";
import { deleteOrgAdmin, revokeAllKeys, revokeKeyAdmin, setOrgPlan } from "@/lib/server/admin/orgs";
import { removeFromOrgAdmin, resetPasswordAdmin, signOutEverywhere } from "@/lib/server/admin/users";

// Admin server actions. Each one re-checks that the caller is a platform admin
// (404 otherwise) before doing anything; the data functions check again and
// write an audit row in the affected org plus an instance log entry.

export async function changePlanAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await setOrgPlan(admin, field(fd, "org"), field(fd, "plan"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: r.from === r.to ? `${r.slug} is already on ${r.to}.` : `${r.slug}: plan changed from ${r.from} to ${r.to}.` };
  } catch (e) {
    return actionError(e, "Could not change the plan.");
  }
}

export async function revokeAllKeysAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const n = await revokeAllKeys(admin, field(fd, "org"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: n === 0 ? "There were no active keys to revoke." : `Revoked ${n} API key${n === 1 ? "" : "s"}.` };
  } catch (e) {
    return actionError(e, "Could not revoke the keys.");
  }
}

export async function revokeKeyAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const prefix = await revokeKeyAdmin(admin, field(fd, "org"), field(fd, "key"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Key ${prefix}… revoked.` };
  } catch (e) {
    return actionError(e, "Could not revoke the key.");
  }
}

export async function deleteOrgAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  let slug = "";
  try {
    slug = (await deleteOrgAdmin(admin, field(fd, "org"), field(fd, "confirm"))).slug;
  } catch (e) {
    return actionError(e, "Could not delete the organization.");
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/orgs?deleted=${encodeURIComponent(slug)}`);
}

export async function signOutUserAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await signOutEverywhere(admin, field(fd, "user"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: r.sessions === 0 ? `${r.email} had no active sessions.` : `Signed ${r.email} out of ${r.sessions} session${r.sessions === 1 ? "" : "s"}.` };
  } catch (e) {
    return actionError(e, "Could not sign the user out.");
  }
}

export type ResetResult = (ActionResult & { password?: string; email?: string }) | undefined;

export async function resetPasswordAction(_prev: ResetResult, fd: FormData): Promise<ResetResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await resetPasswordAdmin(admin, field(fd, "user"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Temporary password set for ${r.email}.`, password: r.password, email: r.email };
  } catch (e) {
    return actionError(e, "Could not reset the password.");
  }
}

export async function removeFromOrgAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await removeFromOrgAdmin(admin, field(fd, "user"), field(fd, "org"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Removed ${r.email} from ${r.org}.` };
  } catch (e) {
    return actionError(e, "Could not remove the membership.");
  }
}

export async function cancelJobAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await cancelJobAdmin(admin, field(fd, "job"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Job ${r.id.slice(0, 8)} in ${r.org} canceled.` };
  } catch (e) {
    return actionError(e, "Could not cancel the job.");
  }
}

export async function requeueJobAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  try {
    const r = await requeueJobAdmin(admin, field(fd, "job"));
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Job ${r.id.slice(0, 8)} in ${r.org} is queued again.` };
  } catch (e) {
    return actionError(e, "Could not requeue the job.");
  }
}
