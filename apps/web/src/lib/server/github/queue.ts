import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { githubDeliveries } from "../db/schema";

export type Delivery = typeof githubDeliveries.$inferSelect;
export const MAX_ATTEMPTS = 8;
export const LEASE_SECONDS = 180;

/** MVP serializes GitHub work globally. Multiple worker replicas still cannot process two PRs concurrently. */
export async function claimDelivery(): Promise<Delivery | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(174912304, 1)`);
    await tx.execute(sql`update ${githubDeliveries} set status = 'failed', finished_at = now(), error = 'Worker retry limit reached.'
      where attempts >= ${MAX_ATTEMPTS} and (status = 'queued' or (status = 'processing' and lease_expires_at < now()))`);
    const token = randomUUID();
    const rows = await tx.execute<{ id: string }>(sql`
      update ${githubDeliveries} set status = 'processing', attempts = attempts + 1,
        lease_token = ${token}, lease_expires_at = now() + make_interval(secs => ${LEASE_SECONDS})
      where id = (
        select id from ${githubDeliveries}
        where attempts < ${MAX_ATTEMPTS} and ((status = 'queued' and available_at <= now()) or (status = 'processing' and lease_expires_at < now()))
          and not exists (select 1 from ${githubDeliveries} live where live.status = 'processing' and live.lease_expires_at >= now())
        order by available_at, created_at limit 1 for update skip locked
      ) returning id`);
    if (!rows[0]) return null;
    const [row] = await tx.select().from(githubDeliveries).where(eq(githubDeliveries.id, rows[0].id));
    return row;
  });
}

function owned(delivery: Delivery) {
  return and(eq(githubDeliveries.id, delivery.id), eq(githubDeliveries.status, "processing"), eq(githubDeliveries.leaseToken, delivery.leaseToken || ""), sql`${githubDeliveries.leaseExpiresAt} > now()`);
}
export async function heartbeatDelivery(delivery: Delivery): Promise<boolean> {
  const rows = await db.update(githubDeliveries).set({ leaseExpiresAt: sql`now() + make_interval(secs => ${LEASE_SECONDS})` }).where(owned(delivery)).returning({ id: githubDeliveries.id });
  return rows.length === 1;
}
export async function assertLease(delivery: Delivery): Promise<void> {
  const [row] = await db.select({ id: githubDeliveries.id }).from(githubDeliveries).where(owned(delivery));
  if (!row) throw new Error("GitHub worker lost its lease; evaluation stopped.");
}
export async function completeDelivery(delivery: Delivery): Promise<void> {
  await db.update(githubDeliveries).set({ status: "done", finishedAt: new Date(), leaseToken: null, leaseExpiresAt: null, error: null }).where(owned(delivery));
}
export async function failDelivery(delivery: Delivery, message: string, retryAfterSeconds = 0): Promise<void> {
  const terminal = delivery.attempts >= MAX_ATTEMPTS;
  const delay = Math.min(3600, Math.max(retryAfterSeconds, 5 * 2 ** delivery.attempts));
  await db.update(githubDeliveries).set({ status: terminal ? "failed" : "queued", finishedAt: terminal ? new Date() : null,
    availableAt: new Date(Date.now() + delay * 1000), leaseToken: null, leaseExpiresAt: null, error: message.slice(0, 500) }).where(owned(delivery));
}
