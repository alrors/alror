import "server-only";
import { createSign } from "node:crypto";
import { appConfig } from "./config";

export class GitHubError extends Error {
  constructor(public status: number, public retryAfter = 0) { super(`GitHub API request failed (HTTP ${status}).`); }
}

export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const seconds = Math.floor(now / 1000);
  const payload = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`;
  return `${payload}.${createSign("RSA-SHA256").update(payload).sign(privateKey, "base64url")}`;
}

export type GitHubTransport = typeof fetch;
export class GitHubClient {
  constructor(private token: string, private transport: GitHubTransport = fetch, private origin = "https://api.github.com") {}
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("GitHub requests need a relative API path.");
    const response = await this.transport(this.origin + path, {
      method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "alror-platform", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new GitHubError(response.status, Number(response.headers.get("retry-after") || 0));
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  async pages<T>(path: string, field?: string, maxPages = 30): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const data = await this.request<T[] | Record<string, T[]>>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const values = field ? (data as Record<string, T[]>)[field] : data as T[];
      if (!Array.isArray(values)) throw new Error("GitHub returned an invalid page.");
      result.push(...values);
      if (values.length < 100) return result;
    }
    throw new Error("GitHub result exceeds the supported pagination limit; human review is required.");
  }
}

type CachedToken = { token: string; expires: number };
const tokens = new Map<string, CachedToken>();
export async function installationClient(installationId: string, repositoryId?: string): Promise<GitHubClient> {
  if (!/^\d+$/.test(installationId) || (repositoryId && !/^\d+$/.test(repositoryId))) throw new Error("Invalid GitHub installation or repository identifier.");
  const { appId, privateKey } = appConfig();
  const key = `${appId}:${installationId}:${repositoryId || "all"}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 90_000) return new GitHubClient(cached.token);
  const app = new GitHubClient(appJwt(appId, privateKey));
  const installation = await app.request<{ suspended_at: string | null }>(`/app/installations/${installationId}`);
  if (installation.suspended_at) throw new Error("The GitHub installation is suspended.");
  const result = await app.request<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, "POST", repositoryId ? { repository_ids: [Number(repositoryId)] } : {});
  tokens.set(key, { token: result.token, expires: Date.parse(result.expires_at) });
  return new GitHubClient(result.token);
}

export function clearInstallationTokens(installationId: string): void {
  for (const key of tokens.keys()) if (key.split(":")[1] === installationId) tokens.delete(key);
}

export function repoPath(fullName: string): string {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p))) throw new Error("Invalid repository name.");
  return `/repos/${parts.map(encodeURIComponent).join("/")}`;
}
