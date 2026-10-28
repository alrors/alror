"use server";

import { revalidatePath } from "next/cache";
import { actionError, field, type ActionResult } from "@/lib/console/action-result";
import { requireCtx } from "@/lib/server/auth/session";
import { requireAdmin } from "@/lib/server/context";
import { DEFAULT_BOUNDS } from "@/lib/server/tuning/bounds";
import { acceptProposal, dismissProposal, getTuningSettings, refreshTuning, resetTuned, updateTuningSettings } from "@/lib/server/tuning/store";

const done = (message: string): ActionResult => {
  revalidatePath("/app", "layout");
  return { ok: true, message };
};

async function admin() {
  const ctx = await requireCtx();
  requireAdmin(ctx);
  return ctx;
}

export async function acceptTuning(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const p = await acceptProposal(await admin(), field(fd, "id"));
    return done(`Applied: ${p.summary}. CLIs and runners pick it up on their next run.`);
  } catch (e) {
    return actionError(e, "Could not apply the proposal.");
  }
}

export async function dismissTuning(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    await dismissProposal(await admin(), field(fd, "id"));
    return done("Dismissed. The same values are not proposed again for 30 days.");
  } catch (e) {
    return actionError(e, "Could not dismiss the proposal.");
  }
}

export async function rerunTuning(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  void _prev;
  void _fd;
  try {
    const r = await refreshTuning(await admin(), { force: true });
    return done(r.created ? `Analysis done: ${r.created} new proposal${r.created === 1 ? "" : "s"}${r.applied ? `, ${r.applied} applied automatically` : ""}.` : "Analysis done: no new proposals.");
  } catch (e) {
    return actionError(e, "Could not run the analysis.");
  }
}

export async function resetTuning(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const service = field(fd, "service");
    await resetTuned(await admin(), service ? { service } : { weights: true });
    return done(service ? `${service} uses the org policy again.` : "Risk weights reset to the shared rules.");
  } catch (e) {
    return actionError(e, "Could not reset.");
  }
}

const numberField = (fd: FormData, k: string) => {
  const v = Number(field(fd, k));
  return field(fd, k) === "" || !Number.isFinite(v) ? undefined : v;
};

/** Auto-apply and the floors/ceilings shown on the page (percentages in the form). */
export async function saveTuningSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const ctx = await admin();
    const cur = await getTuningSettings(ctx);
    const b = cur.bounds;
    const pctOf = (k: string, dflt: number) => {
      const v = numberField(fd, k);
      return v === undefined ? dflt : v / 100;
    };
    const err = { floor: pctOf("err_floor", b.maxRegression.error_rate.floor), ceiling: pctOf("err_ceiling", b.maxRegression.error_rate.ceiling) };
    const lat = { floor: pctOf("lat_floor", b.maxRegression.latency_p95.floor), ceiling: pctOf("lat_ceiling", b.maxRegression.latency_p95.ceiling) };
    const bakeFloor = numberField(fd, "bake_floor") ?? b.bakeScale.floor;
    for (const [name, r] of [["Error rate", err], ["Latency p95", lat]] as const) {
      if (!(r.floor > 0 && r.floor <= r.ceiling && r.ceiling <= 10)) return { error: `${name}: the floor must be above 0% and not above the ceiling.` };
    }
    if (!(bakeFloor >= 0.1 && bakeFloor <= 1)) return { error: "The bake floor must be between 0.1 and 1." };
    const bounds = { ...b, maxRegression: { ...b.maxRegression, error_rate: err, latency_p95: lat }, bakeScale: { floor: bakeFloor, ceiling: 1 } };
    const isDefault = JSON.stringify(bounds) === JSON.stringify(DEFAULT_BOUNDS);
    await updateTuningSettings(ctx, { auto_apply: fd.get("auto_apply") === "on", bounds: isDefault ? null : bounds });
    return done("Tuning settings saved.");
  } catch (e) {
    return actionError(e, "Could not save the tuning settings.");
  }
}
