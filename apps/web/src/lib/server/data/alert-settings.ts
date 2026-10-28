import "server-only";
import { eq } from "drizzle-orm";
import { requireAdmin, type OrgCtx } from "../context";
import { db, type Tx } from "../db";
import { orgAlertSettings, users } from "../db/schema";
import { invalid } from "../errors";
import { base62, safeEqual, sha256Hex } from "../auth/crypto";
import { writeAudit } from "./audit";

// Alert intake settings per org: the webhook secret (only its sha256 is stored)
// and the automatic rollback rules. Owners and admins change them; the intake
// endpoint (POST /api/v1/alerts/{source}) authenticates with the secret.

export const ALERT_TOKEN_PREFIX = "alrwh_";
export const ALERT_TOKEN_RE = /^alrwh_[0-9A-Za-z]{40}$/;
/** alrwh_ plus the first 8 random characters: the lookup key, safe to show. */
const PREFIX_LEN = ALERT_TOKEN_PREFIX.length + 8;

export type AlertSettings = {
  secret_set: boolean;
  /** e.g. "alrwh_Ab3dE6gH"; null when no secret exists. */
  secret_prefix: string | null;
  secret_rotated_at: string | null;
  auto_rollback: boolean;
  threshold: number;
  max_age_minutes: number;
  window_minutes: number;
  updated_at: string | null;
  updated_by: string | null;
};

export const DEFAULT_ALERT_SETTINGS = { auto_rollback: false, threshold: 80, max_age_minutes: 30, window_minutes: 120 } as const;

export async function getAlertSettings(ctx: OrgCtx, tx: Tx = db): Promise<AlertSettings> {
  const [row] = await tx
    .select({ s: orgAlertSettings, by: users.email })
    .from(orgAlertSettings)
    .leftJoin(users, eq(users.id, orgAlertSettings.updatedBy))
    .where(eq(orgAlertSettings.orgId, ctx.orgId))
    .limit(1);
  if (!row) return { secret_set: false, secret_prefix: null, secret_rotated_at: null, ...DEFAULT_ALERT_SETTINGS, updated_at: null, updated_by: null };
  const s = row.s;
  return {
    secret_set: Boolean(s.secretHash),
    secret_prefix: s.secretHash ? s.secretPrefix : null,
    secret_rotated_at: s.secretRotatedAt?.toISOString() ?? null,
    auto_rollback: s.autoRollback,
    threshold: s.threshold,
    max_age_minutes: s.maxAgeMinutes,
    window_minutes: s.windowMinutes,
    updated_at: s.updatedAt.toISOString(),
    updated_by: row.by ?? null,
  };
}

/**
 * Creates or replaces the org's alert webhook secret and returns it once. The
 * previous secret stops working immediately. Owners and admins only.
 */
export async function rotateAlertSecret(ctx: OrgCtx, opts: { authorized?: boolean } = {}): Promise<{ token: string; prefix: string }> {
  if (!opts.authorized) requireAdmin(ctx);
  const token = ALERT_TOKEN_PREFIX + base62(40);
  const prefix = token.slice(0, PREFIX_LEN);
  const now = new Date();
  const set = { secretPrefix: prefix, secretHash: sha256Hex(token), secretRotatedAt: now, updatedAt: now, updatedBy: ctx.actor.userId ?? null };
  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ hash: orgAlertSettings.secretHash }).from(orgAlertSettings).where(eq(orgAlertSettings.orgId, ctx.orgId)).limit(1);
    await tx
      .insert(orgAlertSettings)
      .values({ orgId: ctx.orgId, ...set })
      .onConflictDoUpdate({ target: orgAlertSettings.orgId, set });
    await writeAudit(ctx, prev?.hash ? "alerts.secret_rotate" : "alerts.secret_create", prefix, {}, tx);
    return { token, prefix };
  });
}

/** Removes the secret: alert webhooks are rejected until a new one is created. */
export async function revokeAlertSecret(ctx: OrgCtx): Promise<void> {
  requireAdmin(ctx);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(orgAlertSettings)
      .set({ secretPrefix: null, secretHash: null, updatedAt: new Date(), updatedBy: ctx.actor.userId ?? null })
      .where(eq(orgAlertSettings.orgId, ctx.orgId))
      .returning({ org: orgAlertSettings.orgId });
    if (row) await writeAudit(ctx, "alerts.secret_revoke", "alerts", {}, tx);
  });
}

export type AlertSettingsPatch = Partial<Pick<AlertSettings, "auto_rollback" | "threshold" | "max_age_minutes" | "window_minutes">>;

/** Updates the automatic rollback rules. Owners and admins only; validates ranges; audited. */
export async function updateAlertSettings(ctx: OrgCtx, patch: AlertSettingsPatch): Promise<AlertSettings> {
  requireAdmin(ctx);
  const int = (v: number | undefined, lo: number, hi: number, name: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || v < lo || v > hi) throw invalid(`${name} must be a whole number from ${lo} to ${hi}.`);
    return v;
  };
  const threshold = int(patch.threshold, 50, 100, "Confidence threshold");
  const maxAge = int(patch.max_age_minutes, 1, 240, "Deployed within (minutes)");
  const window = int(patch.window_minutes, 5, 1440, "Look-back window (minutes)");
  const set = {
    ...(patch.auto_rollback !== undefined && { autoRollback: Boolean(patch.auto_rollback) }),
    ...(threshold !== undefined && { threshold }),
    ...(maxAge !== undefined && { maxAgeMinutes: maxAge }),
    ...(window !== undefined && { windowMinutes: window }),
    updatedAt: new Date(),
    updatedBy: ctx.actor.userId ?? null,
  };
  await db.transaction(async (tx) => {
    const before = await getAlertSettings(ctx, tx);
    await tx
      .insert(orgAlertSettings)
      .values({ orgId: ctx.orgId, ...set })
      .onConflictDoUpdate({ target: orgAlertSettings.orgId, set });
    const changed = (Object.keys(patch) as (keyof AlertSettingsPatch)[]).filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
    if (changed.length) {
      await writeAudit(
        ctx,
        "alerts.settings_update",
        "alerts",
        Object.fromEntries(changed.map((k) => [k, { from: before[k], to: patch[k] }])),
        tx,
      );
    }
  });
  return getAlertSettings(ctx);
}

/** Resolves an alert webhook token to its org. Constant-time hash comparison; null when unknown or revoked. */
export async function authenticateAlertToken(token: string): Promise<{ orgId: string } | null> {
  if (!ALERT_TOKEN_RE.test(token)) return null;
  const [row] = await db
    .select({ orgId: orgAlertSettings.orgId, hash: orgAlertSettings.secretHash })
    .from(orgAlertSettings)
    .where(eq(orgAlertSettings.secretPrefix, token.slice(0, PREFIX_LEN)))
    .limit(1);
  const want = row?.hash ?? "0".repeat(64);
  const ok = safeEqual(sha256Hex(token), want);
  return ok && row?.hash ? { orgId: row.orgId } : null;
}
