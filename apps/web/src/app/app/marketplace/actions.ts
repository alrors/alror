"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { disablePlugin, installPlugin, togglePluginVote, uninstallPlugin, type VoteState } from "@/lib/server/data/plugins";
import { getCatalogItem } from "@/lib/server/marketplace/catalog";

// Marketplace server actions. Each one passes the session's org context to the
// plugins data layer, which checks the role (owners and admins for install,
// configure, disable and uninstall; any member for votes) and writes the audit log.

export type PluginResult = ActionResult | undefined;

const ID_RE = /^[a-z0-9-]{1,64}$/;

/** Installed plugins feed several pages (marketplace, policies, service targets): refresh the whole console. */
function refresh() {
  revalidatePath("/app", "layout");
}

/**
 * Installs a plugin, or saves its configuration (re-enabling it when disabled).
 * Only the catalog's non-env fields are read from the form; env fields (runner
 * secrets such as DD_API_KEY) are never accepted.
 */
export async function savePlugin(_prev: PluginResult, formData: FormData): Promise<PluginResult> {
  const ctx = await requireCtx();
  const id = field(formData, "id");
  const item = ID_RE.test(id) ? getCatalogItem(id) : undefined;
  if (!item) return { error: "No such plugin." };
  const input: Record<string, string> = {};
  for (const f of item.fields) {
    if (f.storage === "env") continue;
    input[f.key] = String(formData.get(f.key) ?? "");
  }
  try {
    const r = await installPlugin(ctx, id, input);
    refresh();
    const was = field(formData, "state");
    const message = r.created ? `${item.name} installed.` : was === "disabled" ? `${item.name} enabled.` : `${item.name} configuration saved.`;
    return { ok: true, message };
  } catch (e) {
    return actionError(e, `Could not save ${item.name}. Try again.`);
  }
}

/** Turns a plugin off but keeps its settings; its policy change is reverted. */
export async function disablePluginAction(_prev: PluginResult, formData: FormData): Promise<PluginResult> {
  const ctx = await requireCtx();
  const id = field(formData, "id");
  const item = ID_RE.test(id) ? getCatalogItem(id) : undefined;
  if (!item) return { error: "No such plugin." };
  try {
    await disablePlugin(ctx, id);
    refresh();
    return { ok: true, message: `${item.name} disabled.` };
  } catch (e) {
    return actionError(e, `Could not disable ${item.name}.`);
  }
}

/** Removes a plugin and its settings; its policy change is reverted. */
export async function uninstallPluginAction(_prev: PluginResult, formData: FormData): Promise<PluginResult> {
  const ctx = await requireCtx();
  const id = field(formData, "id");
  const item = ID_RE.test(id) ? getCatalogItem(id) : undefined;
  if (!item) return { error: "No such plugin." };
  try {
    await uninstallPlugin(ctx, id);
    refresh();
    return { ok: true, message: `${item.name} uninstalled.` };
  } catch (e) {
    return actionError(e, `Could not uninstall ${item.name}.`);
  }
}

export type VoteResult = { ok: true; vote: VoteState } | { ok?: false; error: string };

/** Adds or removes the signed-in user's "I want this" vote on a planned item. */
export async function votePlugin(id: string): Promise<VoteResult> {
  const ctx = await requireCtx();
  if (typeof id !== "string" || !ID_RE.test(id)) return { error: "No such plugin." };
  try {
    const vote = await togglePluginVote(ctx, id);
    refresh();
    return { ok: true, vote };
  } catch (e) {
    return actionError(e, "Could not record the vote. Try again.");
  }
}
