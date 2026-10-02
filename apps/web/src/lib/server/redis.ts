import "server-only";
import Redis from "ioredis";
import { env } from "./env";

// Redis holds sessions, login rate limits, the job queue signal and pub/sub fan-out.
// Keys (docs/platform-contract.md):
//   sess:<id>               session JSON, 7-day sliding TTL
//   rl:login:<ip|email>     login attempt counters, 15-minute window
//   jobs:<orgId>            LPUSH on enqueue, BRPOP by /jobs/claim (signal only; Postgres is the truth)
//   org:<orgId>:events      pub/sub channel relayed by /api/v1/stream

type Cached = { main?: Redis; sub?: Redis; hub?: Hub };
const g = globalThis as typeof globalThis & { __alrorRedis?: Cached };
const store = (): Cached => (g.__alrorRedis ??= {});

function connect(name: string): Redis {
  const r = new Redis(env.redisUrl(), {
    connectionName: `alror-web:${name}`,
    maxRetriesPerRequest: 3,
    enableAutoPipelining: true,
    lazyConnect: false,
  });
  r.on("error", (e) => console.error(`[alror] redis (${name}):`, e.message));
  return r;
}

/** Shared command connection. */
export function redis(): Redis {
  const s = store();
  if (!s.main) s.main = connect("main");
  return s.main;
}

/** A fresh connection for blocking commands (BRPOP). The caller must quit() it. */
export function blockingConnection(): Redis {
  const r = new Redis(env.redisUrl(), { connectionName: "alror-web:block", maxRetriesPerRequest: 1 });
  r.on("error", () => {});
  return r;
}

export async function closeRedis(): Promise<void> {
  const s = store();
  await Promise.all([s.main?.quit().catch(() => {}), s.sub?.quit().catch(() => {})]);
  g.__alrorRedis = undefined;
}

// ---------- Sessions ----------

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export type SessionRecord = { userId: string; orgId: string; createdAt: string };

const sessKey = (id: string) => `sess:${id}`;

export async function putSession(id: string, rec: SessionRecord): Promise<void> {
  await redis().set(sessKey(id), JSON.stringify(rec), "EX", SESSION_TTL_SECONDS);
}

/** Reads a session and slides its TTL. */
export async function readSession(id: string): Promise<SessionRecord | null> {
  const r = redis();
  const raw = await r.get(sessKey(id));
  if (!raw) return null;
  await r.expire(sessKey(id), SESSION_TTL_SECONDS);
  try {
    const rec = JSON.parse(raw) as SessionRecord;
    return rec && typeof rec.userId === "string" && typeof rec.orgId === "string" ? rec : null;
  } catch {
    return null;
  }
}

export async function updateSessionOrg(id: string, orgId: string): Promise<boolean> {
  const rec = await readSession(id);
  if (!rec) return false;
  await putSession(id, { ...rec, orgId });
  return true;
}

export async function deleteSession(id: string): Promise<void> {
  await redis().del(sessKey(id));
}

// ---------- Rate limiting ----------

export type RateLimit = { allowed: boolean; count: number; retryAfter: number };

/** Current count for a fixed window without incrementing it. */
export async function rateLimitPeek(key: string, limit: number): Promise<RateLimit> {
  const r = redis();
  const [count, ttl] = await Promise.all([r.get(key), r.ttl(key)]);
  const n = Number(count ?? 0);
  return { allowed: n < limit, count: n, retryAfter: n >= limit ? Math.max(1, ttl) : 0 };
}

/** Counts one hit in a fixed window. */
export async function rateLimitHit(key: string, limit: number, windowSeconds: number): Promise<RateLimit> {
  const r = redis();
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, windowSeconds);
  const ttl = await r.ttl(key);
  return { allowed: n <= limit, count: n, retryAfter: n > limit ? Math.max(1, ttl) : 0 };
}

export async function rateLimitReset(key: string): Promise<void> {
  await redis().del(key);
}

// ---------- Job queue signal ----------

export const jobsKey = (orgId: string) => `jobs:${orgId}`;

export async function signalJob(orgId: string, jobId: string): Promise<void> {
  const r = redis();
  await r.lpush(jobsKey(orgId), jobId);
  // The list is only a wake-up signal; cap it so unclaimed signals never pile up.
  await r.ltrim(jobsKey(orgId), 0, 999);
}

// ---------- Pub/sub ----------

export const orgChannel = (orgId: string) => `org:${orgId}:events`;

export type OrgEvent =
  | { type: "deployment.updated"; deployment: unknown }
  | { type: "deployment.event"; deployment_id: string; event: unknown }
  | { type: "job.updated"; job: unknown };

/** Never throws: a Redis outage must not fail the write that triggered it. */
export async function publish(orgId: string, message: OrgEvent): Promise<void> {
  try {
    await redis().publish(orgChannel(orgId), JSON.stringify({ ...message, at: new Date().toISOString() }));
  } catch (e) {
    console.error("[alror] publish failed:", (e as Error).message);
  }
}

type Listener = (type: string, data: string) => void;

/** One subscriber connection per process, fanned out to every SSE stream in memory. */
class Hub {
  private listeners = new Map<string, Set<Listener>>();
  constructor(private sub: Redis) {
    sub.on("message", (channel: string, data: string) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      let type = "message";
      try {
        type = String((JSON.parse(data) as { type?: string }).type ?? "message");
      } catch {
        // pass the raw payload through
      }
      for (const fn of set) {
        try {
          fn(type, data);
        } catch {
          // one broken stream must not affect the others
        }
      }
    });
  }

  async add(channel: string, fn: Listener): Promise<() => Promise<void>> {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return async () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.listeners.delete(channel);
        await this.sub.unsubscribe(channel).catch(() => {});
      }
    };
  }
}

export async function subscribeOrg(orgId: string, fn: Listener): Promise<() => Promise<void>> {
  const s = store();
  if (!s.hub) {
    s.sub = connect("sub");
    s.hub = new Hub(s.sub);
  }
  return s.hub.add(orgChannel(orgId), fn);
}
