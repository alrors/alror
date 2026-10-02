import type { Metadata } from "next";
import Link from "next/link";
import { FileCode2 } from "lucide-react";
import { PolicyEditor } from "@/components/console/policy-editor";
import { Card, Pill, tableCell, tableHead } from "@/components/console/primitives";
import { requireSession } from "@/lib/console/auth";
import { ago, requestTime } from "@/lib/console/format";
import { DEFAULT_PLANS, plansFromStored } from "@/lib/console/policy-rules";
import { readProjectConfig } from "@/lib/console/policy";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { listAudit, type AuditEntry } from "@/lib/server/data/audit";
import { DEFAULT_POLICY, getPolicy } from "@/lib/server/data/policy";
import { cn } from "@/lib/site";

export const metadata: Metadata = { title: "Policies" };

export default async function PoliciesPage() {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  // The audit log is for owners and admins (as on Settings, Audit log); members see the policy row's updated_by.
  const [c, policy, history] = await Promise.all([
    readProjectConfig(),
    getPolicy(ctx),
    admin ? listAudit(ctx, { action: "policy.update", limit: 5 }) : Promise.resolve([] as AuditEntry[]),
  ]);
  const now = requestTime();
  const touched = Date.parse(policy.updated_at) > 0;
  const lastAudit = history[0];
  const who = lastAudit?.actor_label || policy.updated_by;
  const updatedLabel = touched
    ? `Last changed ${ago(lastAudit?.at ?? policy.updated_at, now)}${who ? ` by ${who}` : ""}${lastAudit ? ` via ${String(lastAudit.meta.source ?? "the API")}` : ""}.`
    : "Using the built-in defaults; nobody has changed this policy yet.";

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Policies</h1>
          <p className="mt-1 text-[14px] text-con-fg2">How Alror verifies canaries and when it rolls back, for project {c.project}.</p>
        </div>
        {admin && (
          <Link href="/app/settings/audit?category=policy" className="text-[13px] text-con-fg2 hover:text-con-fg">
            Policy history
          </Link>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-con-line bg-con-panel px-4 py-3 text-[13px] text-con-fg2">
        <FileCode2 size={16} className="mt-0.5 shrink-0 text-con-fg3" />
        <span>
          {admin ? "Changes are saved to the organization policy and audit-logged. " : "Only owners and admins can change the policy. "}
          The CLI and every runner read it from <code className="font-mono text-con-fg">GET /api/v1/config</code> on their next run;{" "}
          <code className="font-mono text-con-fg">alror config pull</code> writes it to alror.yaml and{" "}
          <code className="font-mono text-con-fg">alror config push</code> replaces it. {updatedLabel}
        </span>
      </div>

      <PolicyEditor
        readOnly={!admin}
        updatedLabel={updatedLabel}
        defaults={{
          autoRollback: DEFAULT_POLICY.auto_rollback,
          alpha: DEFAULT_POLICY.alpha,
          bakeScale: DEFAULT_POLICY.bake_scale,
          maxRegression: DEFAULT_POLICY.max_regression,
          plans: DEFAULT_PLANS,
        }}
        initial={{
          autoRollback: policy.auto_rollback,
          alpha: policy.alpha,
          bakeScale: policy.bake_scale,
          maxRegression: policy.max_regression,
          plans: plansFromStored(policy.plans),
        }}
      />

      {admin && (
        <Card
          title="Recent policy changes"
          description="From the audit log: who changed what, newest first."
          aside={
            <Link href="/app/settings/audit?category=policy" className="text-[13px] text-con-fg2 hover:text-con-fg">
              Full history
            </Link>
          }
          flush
        >
          {history.length === 0 ? (
            <p className="px-5 py-5 text-[13px] text-con-fg3">No changes recorded yet. The policy is still the built-in default.</p>
          ) : (
            <ol className="con-stagger divide-y divide-con-row">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-con-fg">{h.actor_label || "unknown"}</span>
                    <span className="text-con-fg3"> via {String(h.meta.source ?? "the API")}</span>
                    <span className="mt-0.5 block text-[12px] text-con-fg2">{describeChanges(h.meta)}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-con-fg3" title={h.at}>
                    {ago(h.at, now)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      <Card title="Metrics and notifications" description="Set from alror.yaml with alror config push, or by installing plugins in the Marketplace.">
        <dl className="-my-2.5 divide-y divide-con-row text-[13px]">
          <div className="flex justify-between py-2.5">
            <dt className="text-con-fg2">Metrics provider</dt>
            <dd className="font-mono">{c.metrics.provider}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-con-fg2">Slack notifications</dt>
            <dd>{c.notify.slack ? "On" : "Off"}</dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Services"
        description={`${c.services.length} active services`}
        aside={
          <Link href="/app/services" className="text-[13px] text-con-fg2 hover:text-con-fg">
            Manage services
          </Link>
        }
        flush
      >
        <div id="services" className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead className="border-b border-con-line">
              <tr>
                <th className={tableHead}>Service</th>
                <th className={tableHead}>Target</th>
                <th className={tableHead}>Paths</th>
                <th className={cn(tableHead, "text-right")}>Critical</th>
              </tr>
            </thead>
            <tbody>
              {c.services.map((s) => (
                <tr key={s.name} className="border-b border-con-row last:border-0">
                  <td className={cn(tableCell, "font-medium")}>
                    <Link href={`/app/services/${encodeURIComponent(s.name)}`} className="hover:underline hover:underline-offset-4">
                      {s.name}
                    </Link>
                  </td>
                  <td className={cn(tableCell, "text-con-fg2")}>
                    {s.target}
                    {s.cluster && <span className="text-con-fg3"> · {s.cluster}</span>}
                    {s.namespace && <span className="text-con-fg3"> / {s.namespace}</span>}
                  </td>
                  <td className={cn(tableCell, "font-mono text-[12.5px] text-con-fg2")}>{s.paths.join(", ") || "none"}</td>
                  <td className={cn(tableCell, "text-right")}>
                    {s.critical ? <Pill className="text-con-fg2">Critical</Pill> : <span className="text-con-fg3">No</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  auto_rollback: "rollback mode",
  alpha: "alpha",
  bake_scale: "bake scale",
  max_regression: "thresholds",
  plans: "rollout plans",
  metrics: "metrics provider",
  slack_webhook: "Slack webhook",
};

const short = (v: unknown): string => {
  if (typeof v === "boolean") return v ? "automatic" : "shadow";
  if (typeof v === "number" || typeof v === "string") return String(v);
  return "";
};

/** One line for an audit row: "alpha 0.05 → 0.01, rollout plans" (values only for scalars). */
function describeChanges(meta: Record<string, unknown>): string {
  const changes = meta.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (changes && typeof changes === "object") {
    const parts = Object.entries(changes).map(([k, v]) => {
      const label = FIELD_LABEL[k] ?? k;
      const f = short(v?.from);
      const t = short(v?.to);
      return f && t ? `${label} ${f} → ${t}` : label;
    });
    if (parts.length) return `Changed ${parts.join(", ")}.`;
  }
  const fields = Array.isArray(meta.fields) ? (meta.fields as string[]) : [];
  return fields.length ? `Updated ${fields.map((f) => FIELD_LABEL[f] ?? f).join(", ")}.` : "Updated the policy.";
}
