import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmAction } from "@/components/console/confirm-action";
import { CopyButton } from "@/components/console/copy-button";
import { AccessDenied } from "@/components/console/access-denied";
import { Card, EmptyState, Pill, tableCell, tableHead } from "@/components/console/primitives";
import { ApiKeyCreate } from "@/components/console/settings/api-key-create";
import { SCOPE_INFO } from "@/components/console/settings/scopes";
import { requireSession } from "@/lib/console/auth";
import { ago, dateTime, requestTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { listApiKeys, type ApiKey } from "@/lib/server/auth/api-keys";
import { isAdminRole } from "@/lib/server/context";
import { env } from "@/lib/server/env";
import { cn } from "@/lib/site";
import { revokeApiKey } from "../actions";

export const metadata: Metadata = { title: "API keys" };

const DAY = 86_400_000;

/** Plain-words usage state for a key. */
function usage(k: ApiKey, now: number): { label: string; tone: "fg" | "fg2" | "fg3" | "warn" } {
  if (k.revoked_at) return { label: `Revoked ${ago(k.revoked_at)}`, tone: "fg3" };
  if (!k.last_used_at) {
    const age = now - Date.parse(k.created_at);
    return age > 7 * DAY ? { label: "Never used. Revoke it if nobody needs it.", tone: "warn" } : { label: "Not used yet", tone: "fg2" };
  }
  const idle = now - Date.parse(k.last_used_at);
  if (idle < DAY) return { label: `Used ${ago(k.last_used_at)}`, tone: "fg" };
  if (idle > 30 * DAY) return { label: `Idle since ${ago(k.last_used_at)}`, tone: "warn" };
  return { label: `Used ${ago(k.last_used_at)}`, tone: "fg2" };
}

const toneClass = { fg: "text-con-fg", fg2: "text-con-fg2", fg3: "text-con-fg3", warn: "text-con-warn" } as const;

export default async function ApiKeysPage({ searchParams }: PageProps<"/app/settings/api-keys">) {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="API keys" />;
  const sp = await searchParams;
  const showRevoked = sp.revoked === "1";
  const keys = await listApiKeys(ctxFor(session), { includeRevoked: showRevoked });
  const active = keys.filter((k) => !k.revoked_at);
  const now = requestTime();
  const usedWeek = active.filter((k) => k.last_used_at && now - Date.parse(k.last_used_at) < 7 * DAY).length;
  const server = env.publicUrl();
  const login = `alror login --server ${server} --key `;

  return (
    <>
      <Card
        title="API keys"
        description={`${active.length} active key${active.length === 1 ? "" : "s"}, ${usedWeek} used in the last 7 days. Keys are stored as hashes; the full key is shown only when it is created.`}
        aside={<ApiKeyCreate serverUrl={server} autoOpen={sp.new === "1"} />}
        flush
      >
        <div className="flex items-center justify-end border-b border-con-line px-5 py-2 text-[13px]">
          <Link href={showRevoked ? "/app/settings/api-keys" : "/app/settings/api-keys?revoked=1"} className="text-con-fg2 hover:text-con-fg">
            {showRevoked ? "Hide revoked keys" : "Show revoked keys"}
          </Link>
        </div>
        {keys.length === 0 ? (
          <EmptyState title="No API keys yet">Create one for the CLI, your CI or alror runner.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-[14px]">
              <thead className="border-b border-con-line">
                <tr>
                  <th className={tableHead}>Name</th>
                  <th className={tableHead}>Key</th>
                  <th className={tableHead}>Scopes</th>
                  <th className={tableHead}>Last used</th>
                  <th className={tableHead}>Created</th>
                  <th className={cn(tableHead, "text-right")}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="con-stagger">
                {keys.map((k) => {
                  const u = usage(k, now);
                  return (
                    <tr key={k.id} className={cn("border-b border-con-row last:border-0", k.revoked_at && "text-con-fg3")}>
                      <td className={cn(tableCell, "py-2.5")}>
                        <div className={k.revoked_at ? "text-con-fg3" : "text-con-fg"}>{k.name}</div>
                      </td>
                      <td className={cn(tableCell, "font-mono text-[12.5px] text-con-fg2")}>{k.prefix}…</td>
                      <td className={tableCell}>
                        <div className="flex max-w-[280px] flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span key={s} title={SCOPE_INFO.find((x) => x.scope === s)?.detail} className="rounded bg-con-row px-1.5 py-0.5 font-mono text-[11px] text-con-fg2">
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className={cn(tableCell, "max-w-[220px] text-[13px]", toneClass[u.tone])} title={k.last_used_at ? dateTime(k.last_used_at) : undefined}>
                        {u.label}
                      </td>
                      <td className={cn(tableCell, "text-[13px] text-con-fg2")} title={dateTime(k.created_at)}>
                        {ago(k.created_at)}
                        <span className="text-con-fg3"> · {k.created_by ?? "unknown"}</span>
                      </td>
                      <td className={cn(tableCell, "text-right")}>
                        {k.revoked_at ? (
                          <Pill className="text-con-fg3">Revoked</Pill>
                        ) : (
                          <ConfirmAction action={revokeApiKey} fields={{ id: k.id }} label="Revoke" prompt="Clients using it stop working." />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title="What scopes mean" description="Give each key only what its job needs. You pick scopes when you create a key." flush>
          <ul className="divide-y divide-con-row">
            {SCOPE_INFO.map((s) => (
              <li key={s.scope} className="grid gap-1 px-5 py-3 sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-4">
                <code className="font-mono text-[12.5px] text-con-fg">{s.scope}</code>
                <div className="text-[13px]">
                  <div className="text-con-fg2">{s.detail}</div>
                  <div className="mt-0.5 text-[12px] text-con-fg3">
                    Used by <span className="font-mono">{s.usedBy}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Use a key" description="Paste your key after the command. The CLI checks it and saves it in your user config.">
          <div className="space-y-4 text-[13px] text-con-fg2">
            <div>
              <div className="mb-1.5 text-[12px] text-con-fg3">Sign the CLI in</div>
              <div className="flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-2.5">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-con-fg">
                  {login}
                  <span className="text-con-fg3">alr_live_…</span>
                </code>
                <CopyButton text={login} iconOnly label="Copy alror login command" />
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-[12px] text-con-fg3">In CI, use environment variables instead</div>
              <div className="flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-2.5">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-con-fg">
                  ALROR_SERVER={server}
                  <br />
                  ALROR_API_KEY=<span className="text-con-fg3">alr_live_…</span>
                </code>
              </div>
            </div>
            <p className="text-[12px] text-con-fg3">
              &quot;Last used&quot; updates each time a key authenticates. Keys idle for a month, or never used, are good candidates to revoke.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
