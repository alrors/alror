import "server-only";
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password format: scrypt$N$r$p$saltB64$hashB64 (docs/platform-contract.md, section 4).
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
  const salt = Buffer.from(parts[4], "base64");
  const want = Buffer.from(parts[5], "base64");
  if (want.length === 0) return false;
  const got = await scrypt(password, salt, want.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A hash that never verifies, so unknown emails cost the same as wrong passwords. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword(randomBytes(16).toString("hex")));
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function base62(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += BASE62[randomInt(62)];
  return out;
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
