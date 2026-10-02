import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { redis } from "../redis";
import { adminsSource, assertAdmin, platformAdmins, type AdminCtx } from "./access";
import { isoTime, num, str } from "./util";

// Instance health for /admin/system. Everything is read live on each request.

export type MigrationStatus = { tag: string; when: number; state: "applied" | "pending" | "changed"; applied_at: string | null };
export type TableStat = { name: string; rows: number; bytes: number };
export type Check = { label: string; ok: boolean; value: string; hint?: string };

const root = () => process.cwd();

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function postgresInfo(admin: AdminCtx) {
  assertAdmin(admin);
  const started = performance.now();
  const [v] = await db.execute<Record<string, unknown>>(sql`
    select version() as version, current_setting('server_version') as short, pg_database_size(current_database()) as size,
      current_database() as name, (select count(*) from pg_stat_activity where datname = current_database())::int as connections,
      pg_postmaster_start_time() as started`);
  const latency = performance.now() - started;
  return {
    version: str(v.short),
    full: str(v.version),
    database: str(v.name),
    size_bytes: num(v.size),
    connections: num(v.connections),
    started_at: isoTime(v.started),
    latency_ms: latency,
  };
}

/** Compares drizzle/meta/_journal.json and the SQL files with drizzle.__drizzle_migrations. */
export async function migrationStatus(admin: AdminCtx): Promise<{ journal: boolean; items: MigrationStatus[]; applied_unknown: number }> {
  assertAdmin(admin);
  const journal = await readJson<{ entries: { tag: string; when: number }[] }>(path.join(root(), "drizzle", "meta", "_journal.json"));
  let applied: { hash: string; created_at: number }[] = [];
  try {
    const rows = await db.execute<Record<string, unknown>>(sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`);
    applied = rows.map((r) => ({ hash: str(r.hash), created_at: num(r.created_at) }));
  } catch {
    applied = [];
  }
  const byWhen = new Map(applied.map((a) => [a.created_at, a]));
  const items: MigrationStatus[] = [];
  for (const e of journal?.entries ?? []) {
    const a = byWhen.get(e.when);
    let hash: string | null = null;
    try {
      hash = createHash("sha256").update(await readFile(path.join(root(), "drizzle", `${e.tag}.sql`), "utf8")).digest("hex");
    } catch {
      hash = null;
    }
    items.push({
      tag: e.tag,
      when: e.when,
      state: !a ? "pending" : hash && a.hash !== hash ? "changed" : "applied",
      applied_at: a ? new Date(a.created_at).toISOString() : null,
    });
  }
  const known = new Set((journal?.entries ?? []).map((e) => e.when));
  return { journal: Boolean(journal), items, applied_unknown: applied.filter((a) => !known.has(a.created_at)).length };
}

export async function tableStats(admin: AdminCtx): Promise<TableStat[]> {
  assertAdmin(admin);
  const tables = await db.execute<{ name: string }>(
    sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  if (tables.length === 0) return [];
  // Names come from the catalog; quote them anyway.
  const q = (n: string) => `"${n.replace(/"/g, '""')}"`;
  const unions = tables
    .map((t) => `select '${t.name.replace(/'/g, "''")}' as name, (select count(*) from public.${q(t.name)})::bigint as rows, pg_total_relation_size('public.${q(t.name)}') as bytes`)
    .join(" union all ");
  const rows = await db.execute<Record<string, unknown>>(sql.raw(unions));
  return rows.map((r) => ({ name: str(r.name), rows: num(r.rows), bytes: num(r.bytes) })).sort((a, b) => a.name.localeCompare(b.name));
}

function infoField(info: string, key: string): string {
  const m = new RegExp(`^${key}:(.*)$`, "m").exec(info);
  return m ? m[1].trim() : "";
}

export async function redisInfo(admin: AdminCtx) {
  assertAdmin(admin);
  try {
    const r = redis();
    const t0 = performance.now();
    const pong = await r.ping();
    const latency = performance.now() - t0;
    const [server, memory, keys] = await Promise.all([r.info("server"), r.info("memory"), r.dbsize()]);
    let sessions = 0;
    let cursor = "0";
    let guard = 0;
    do {
      const [next, found] = await r.scan(cursor, "MATCH", "sess:*", "COUNT", 1000);
      cursor = next;
      sessions += found.length;
      guard++;
    } while (cursor !== "0" && guard < 200);
    return {
      ok: pong === "PONG",
      latency_ms: latency,
      version: infoField(server, "redis_version"),
      uptime_s: num(infoField(server, "uptime_in_seconds")),
      used_memory: infoField(memory, "used_memory_human"),
      peak_memory: infoField(memory, "used_memory_peak_human"),
      maxmemory: infoField(memory, "maxmemory_human"),
      keys,
      sessions,
      error: null as string | null,
    };
  } catch (e) {
    return { ok: false, latency_ms: 0, version: "", uptime_s: 0, used_memory: "", peak_memory: "", maxmemory: "", keys: 0, sessions: 0, error: (e as Error).message };
  }
}

export async function appVersion(admin: AdminCtx) {
  assertAdmin(admin);
  const [pkg, next] = await Promise.all([
    readJson<{ name: string; version: string }>(path.join(root(), "package.json")),
    readJson<{ version: string }>(path.join(root(), "node_modules", "next", "package.json")),
  ]);
  // Branch and commit from .git when the app runs from a checkout (absent in images).
  let branch: string | null = null;
  let commit: string | null = null;
  try {
    const head = (await readFile(path.join(root(), ".git", "HEAD"), "utf8")).trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice(4).trim();
      branch = ref.replace(/^refs\/heads\//, "");
      commit = (await readFile(path.join(root(), ".git", ...ref.split("/")), "utf8").catch(() => "")).trim().slice(0, 12) || null;
    } else {
      commit = head.slice(0, 12);
    }
  } catch {
    branch = null;
  }
  return {
    name: pkg?.name ?? "alror-web",
    version: pkg?.version ?? "unknown",
    next: next?.version ?? "unknown",
    node: process.version,
    env: process.env.NODE_ENV ?? "development",
    branch,
    commit,
    uptime_s: Math.round(process.uptime()),
  };
}

const DEV_SECRET = "alror-dev-session-secret-change-me";

/** Configuration checks an operator should see before going live. Values are never secrets. */
export function envChecks(admin: AdminCtx): Check[] {
  assertAdmin(admin);
  const prod = process.env.NODE_ENV === "production";
  const secret = process.env.ALROR_SESSION_SECRET ?? "";
  const publicUrl = process.env.ALROR_PUBLIC_URL ?? "";
  let urlOk = false;
  try {
    const u = new URL(publicUrl);
    urlOk = (u.protocol === "https:" || (!prod && u.protocol === "http:")) && Boolean(u.host);
  } catch {
    urlOk = false;
  }
  const cookieSecure =
    process.env.ALROR_COOKIE_SECURE === "true" ? true : process.env.ALROR_COOKIE_SECURE === "false" ? false : prod;
  const admins = platformAdmins();
  const source = adminsSource();
  return [
    {
      label: "Session secret",
      ok: secret.length >= 32 && secret !== DEV_SECRET,
      value: !secret ? "not set" : secret === DEV_SECRET ? "development default" : secret.length < 32 ? `set, ${secret.length} chars (short)` : `set, ${secret.length} chars`,
      hint: "ALROR_SESSION_SECRET, 32+ random bytes",
    },
    {
      label: "Public URL",
      ok: urlOk,
      value: publicUrl || "not set (defaults to http://localhost:3000)",
      hint: prod ? "ALROR_PUBLIC_URL, https in production" : "ALROR_PUBLIC_URL, used for invite links",
    },
    { label: "Database URL", ok: Boolean(process.env.DATABASE_URL), value: process.env.DATABASE_URL ? "set" : "not set (local default)", hint: "DATABASE_URL" },
    { label: "Redis URL", ok: Boolean(process.env.REDIS_URL), value: process.env.REDIS_URL ? "set" : "not set (local default)", hint: "REDIS_URL" },
    { label: "Secure cookies", ok: cookieSecure || !prod, value: cookieSecure ? "on" : "off", hint: "ALROR_COOKIE_SECURE; on in production by default" },
    {
      label: "Platform admins",
      ok: source === "env" || (!prod && admins.length > 0),
      value: source === "env" ? `${admins.length} configured` : source === "dev-default" ? "development default (admin@acme.test)" : "none",
      hint: "ALROR_PLATFORM_ADMINS, comma-separated emails",
    },
    { label: "Runtime", ok: true, value: prod ? "production" : process.env.NODE_ENV ?? "development" },
  ];
}
