import type { Metadata } from "next";
import Link from "next/link";
import { AccessDenied } from "@/components/console/access-denied";
import { ConfirmAction } from "@/components/console/confirm-action";
import { CopyButton } from "@/components/console/copy-button";
import { Card, Field, Pill } from "@/components/console/primitives";
import { AlertRulesForm } from "@/components/console/settings/alert-rules-form";
import { AlertSecret } from "@/components/console/settings/alert-secret";
import { requireSession } from "@/lib/console/auth";
import { ago, dateTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { getAlertSettings } from "@/lib/server/data/alert-settings";
import { getPolicy } from "@/lib/server/data/policy";
import { env } from "@/lib/server/env";
import { revokeSecret } from "./actions";

export const metadata: Metadata = { title: "Integrations" };

const DATADOG_PAYLOAD = `{
  "id": "$ID",
  "title": "$EVENT_TITLE",
  "alert_id": "$ALERT_ID",
  "alert_scope": "$ALERT_SCOPE",
  "alert_transition": "$ALERT_TRANSITION",
  "alert_type": "$ALERT_TYPE",
  "aggregate": "$AGGREG_KEY",
  "priority": "$PRIORITY",
  "tags": "$TAGS",
  "date": "$DATE"
}`;

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] text-con-fg3">{label}</div>
      <div className="flex items-start gap-2 rounded-md border border-con-line bg-con-bg p-2.5">
        <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12px] leading-relaxed text-con-fg">{code}</pre>
        <CopyButton text={code} iconOnly label={`Copy ${label}`} />
      </div>
    </div>
  );
}

export default async function IntegrationsPage() {
  const session = await requireSession();
  if (!isAdminRole(session.role)) return <AccessDenied what="integrations" />;
  const ctx = ctxFor(session);
  const [s, policy] = await Promise.all([getAlertSettings(ctx), getPolicy(ctx)]);
  const base = env.publicUrl();
  const url = (source: string) => `${base}/api/v1/alerts/${source}`;

  return (
    <div className="space-y-6">
      <Card
        title="Alert webhooks"
        description="Send alerts to Alror and every incident gets a ranked list of the deployments most likely to have caused it."
        aside={
          <>
            {s.secret_set && <ConfirmAction action={revokeSecret} fields={{}} label="Revoke" prompt="Alert webhooks stop working until you create a new secret." />}
            <AlertSecret baseUrl={base} exists={s.secret_set} />
          </>
        }
      >
        <dl className="divide-y divide-con-row">
          <Field label="Secret">
            {s.secret_set ? (
              <span className="inline-flex items-center gap-2">
                <code className="font-mono text-[13px]">{s.secret_prefix}…</code>
                <Pill tone="good">Active</Pill>
              </span>
            ) : (
              <Pill tone="idle">Not created</Pill>
            )}
          </Field>
          {s.secret_rotated_at && (
            <Field label="Created">
              <span title={dateTime(s.secret_rotated_at)}>{ago(s.secret_rotated_at)}</span>
            </Field>
          )}
          <Field label="Slack">
            {policy.slack_webhook ? (
              <span className="text-con-fg">New incidents are posted to the Slack channel</span>
            ) : (
              <Link href="/app/marketplace/slack" className="text-con-fg2 hover:text-con-fg hover:underline hover:underline-offset-4">
                Install Slack to post incidents
              </Link>
            )}
          </Field>
        </dl>
        <p className="mt-3 text-[12px] text-con-fg3">
          Send the secret as the <code className="font-mono text-con-fg2">X-Alror-Token</code> header, as <code className="font-mono text-con-fg2">Authorization: Bearer</code>, or as{" "}
          <code className="font-mono text-con-fg2">?token=</code> for tools that cannot set headers. Only its hash is stored; rotate it if it leaks. Up to 120 requests per minute.
        </p>
      </Card>

      <Card title="Automatic rollback" description="Off by default. When on, Alror rolls back the top candidate only if every rule passes; otherwise it suggests and people decide.">
        <AlertRulesForm initial={{ auto_rollback: s.auto_rollback, threshold: s.threshold, max_age_minutes: s.max_age_minutes, window_minutes: s.window_minutes }} />
        {s.updated_by && <p className="mt-4 text-[12px] text-con-fg3">Last changed by {s.updated_by}{s.updated_at ? ` ${ago(s.updated_at)}` : ""}.</p>}
      </Card>

      <Card title="Connect a source" description="Each source has its own endpoint. Alerts are deduplicated by fingerprint and resolved when the source sends a resolved event.">
        <div className="space-y-5">
          <Snippet
            label="Prometheus Alertmanager (alertmanager.yml)"
            code={`receivers:
  - name: alror
    webhook_configs:
      - url: ${url("alertmanager")}?token=alrwh_…
        send_resolved: true`}
          />
          <p className="-mt-3 text-[12px] text-con-fg3">
            The service comes from the <code className="font-mono">service</code>, <code className="font-mono">app</code> or <code className="font-mono">job</code> label, the environment from{" "}
            <code className="font-mono">env</code> or <code className="font-mono">environment</code>.
          </p>
          <Snippet label={`Datadog (Webhooks integration, URL ${url("datadog")}?token=…, custom payload)`} code={DATADOG_PAYLOAD} />
          <p className="-mt-3 text-[12px] text-con-fg3">
            Tag monitors with <code className="font-mono">service:</code> and <code className="font-mono">env:</code>. Add the webhook to a monitor message with{" "}
            <code className="font-mono">@webhook-alror</code>.
          </p>
          <Snippet label="Sentry (internal integration webhook URL, with Issue and Alert Rule events)" code={`${url("sentry")}?token=alrwh_…`} />
          <p className="-mt-3 text-[12px] text-con-fg3">
            The Sentry project slug is used as the service unless events carry a <code className="font-mono">service</code> tag.
          </p>
          <Snippet
            label="Any tool (generic JSON)"
            code={`curl -X POST ${url("generic")} \\
  -H "X-Alror-Token: alrwh_…" -H "Content-Type: application/json" \\
  -d '{"title":"Checkout 5xx above 5%","service":"checkout","environment":"production","severity":"critical"}'`}
          />
        </div>
      </Card>
    </div>
  );
}
