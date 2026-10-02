import "server-only";
import { readFileSync } from "node:fs";

export function configStatus() {
  const missing = [
    !process.env.ALROR_GITHUB_APP_ID && "ALROR_GITHUB_APP_ID",
    !(process.env.ALROR_GITHUB_PRIVATE_KEY || process.env.ALROR_GITHUB_PRIVATE_KEY_PATH) && "ALROR_GITHUB_PRIVATE_KEY_PATH",
    !process.env.ALROR_GITHUB_WEBHOOK_SECRET && "ALROR_GITHUB_WEBHOOK_SECRET",
  ].filter((v): v is string => Boolean(v));
  return { configured: missing.length === 0, appSlug: process.env.ALROR_GITHUB_APP_SLUG || "alror-platform", missing };
}

export function appConfig() {
  const appId = process.env.ALROR_GITHUB_APP_ID;
  const privateKey = process.env.ALROR_GITHUB_PRIVATE_KEY?.replace(/\\n/g, "\n") ||
    (process.env.ALROR_GITHUB_PRIVATE_KEY_PATH ? readFileSync(process.env.ALROR_GITHUB_PRIVATE_KEY_PATH, "utf8") : "");
  if (!appId || !/^\d+$/.test(appId) || !privateKey) throw new Error("GitHub App ID and private key must be configured.");
  return { appId, privateKey };
}
