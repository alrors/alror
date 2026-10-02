import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction. Data-layer functions accept either. */
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

type Cached = { sql: ReturnType<typeof postgres>; db: DB };

// Next dev re-evaluates modules on every edit; keep one pool per process.
const g = globalThis as typeof globalThis & { __alrorDb?: Cached };

function create(): Cached {
  const client = postgres(env.databaseUrl(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 30,
    onnotice: () => {},
  });
  return { sql: client, db: drizzle(client, { schema }) };
}

function cached(): Cached {
  if (!g.__alrorDb) g.__alrorDb = create();
  return g.__alrorDb;
}

/** Lazily created so importing this module (e.g. during `next build`) never opens a connection. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = cached().db as unknown as Record<PropertyKey, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export async function closeDb(): Promise<void> {
  if (g.__alrorDb) {
    await g.__alrorDb.sql.end({ timeout: 5 });
    g.__alrorDb = undefined;
  }
}

export { schema };
