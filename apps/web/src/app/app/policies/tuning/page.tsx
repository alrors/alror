import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, RefreshCw, RotateCcw, X } from "lucide-react";
import { ConfirmAction } from "@/components/console/confirm-action";
import { Card, Pill, tableCell, tableHead } from "@/components/console/primitives";
import { TuningSettings } from "@/components/console/tuning-settings";
import { requireSession } from "@/lib/console/auth";
import { ago, requestTime } from "@/lib/console/format";
import { ctxFor } from "@/lib/server/auth/accounts";
import { isAdminRole } from "@/lib/server/context";
import { listServices } from "@/lib/server/data/services";
import { factorLabel, type FactorKey } from "@/lib/server/decision/score";
import { pct } from "@/lib/server/tuning/bounds";
import { analyseTuning, getTuningSettings, listProposals, refreshTuning, type Proposal } from "@/lib/server/tuning/store";
import { cloneOverride, type BakeFinding, type MetricFinding, type ServiceOverride } from "@/lib/server/tuning/thresholds";
import type { ExpectedEffect, FactorFinding } from "@/lib/server/tuning/weights";
import { cn } from "@/lib/site";
import { acceptTuning, dismissTuning, rerunTuning, resetTuning, saveTuningSettings } from "./actions";

export const metadata: Metadata = { title: "Tuning" };

const STATUS_TONE: Record<string, string> = {
  proposed: "text-con-fg",
  unchanged: "text-con-fg2",
  insufficient: "text-con-fg3",
  out_of_bounds: "text-con-fg3",
};

export default async function TuningPage() {
  const session = await requireSession();
  const ctx = ctxFor(session);
  const admin = isAdminRole(session.role);
  // Admins' visits keep proposals current (throttled); members only read.
  if (admin) {
    try {
      await refreshTuning(ctx);
    } catch (e) {
      console.error("[alror tuning] analysis failed", e);
    }
  }
  const [settings, analysis, open, history, svcs] = await Promise.all([
    getTuningSettings(ctx),
    analyseTuning(ctx),
    listProposals(ctx, { status: ["open"] }),
    listProposals(ctx, { status: ["accepted", "dismissed"], limit: 10 }),
    listServices(ctx),
  ]);
  const now = requestTime();
  const b = settings.bounds;
  const overrides = svcs.map((s) => ({ name: s.name, o: cloneOverride(s.policy_override) })).filter((s) => Object.keys(s.o).length);
  const weights = Object.entries(settings.risk_weights) as [FactorKey, number][];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/app/policies" className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-con-fg2 hover:text-con-fg">
            <ArrowLeft size={14} /> Policies
          </Link>
          <h1 className="text-[28px] font-semibold tracking-[-0.025em]">Tuning</h1>
          <p className="mt-1 max-w-3xl text-[14px] text-con-fg2">
            Per-service limits and bake times learned from verdict history, and risk weights learned from which releases were rolled back.
            Each proposal shows its data window and evidence. Nothing changes until an admin accepts it
            {settings.auto_apply ? " (auto-apply is on for this organization)" : ""}.
          </p>
        </div>
        {admin && (
          <ConfirmAction action={rerunTuning} fields={{}} label="Re-run analysis" confirmLabel="Run now" prompt="Re-read history now?" tone="secondary" icon={<RefreshCw size={14} />} />
        )}
      </div>

      <p className="text-[13px] text-con-fg3">
        {settings.last_run_at ? `Last analysed ${ago(settings.last_run_at, now)}.` : "Not analysed yet."} Thresholds use the last {b.windowDays} days of measured verdicts
        (synthetic verdicts are never evidence); weights use the last {b.weights.windowDays} days of release outcomes.
      </p>

      <Card
        title={`Proposals${open.length ? ` (${open.length})` : ""}`}
        description={admin ? "Accept writes a per-service policy override or the org's risk weights, and an audit entry." : "Only owners and admins can accept or dismiss proposals."}
        flush
      >
        {open.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-con-fg3">No open proposals. The status below says what each service still needs.</p>
        ) : (
          <ol className="divide-y divide-con-row">
            {open.map((p) => (
              <ProposalRow key={p.id} p={p} now={now} admin={admin} />
            ))}
          </ol>
        )}
      </Card>

      <Card title="Services" description={`Normal variation per metric over ${b.windowDays} days. A value is proposed only with ${b.minChecks} healthy checks from ${b.minReleases} releases.`} flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="border-b border-con-line">
              <tr>
                <th className={tableHead}>Service</th>
                <th className={tableHead}>Releases</th>
                <th className={tableHead}>Thresholds</th>
                <th className={tableHead}>Bake</th>
              </tr>
            </thead>
            <tbody>
              {analysis.services.map((s) => (
                <tr key={s.service} className="border-b border-con-row align-top last:border-0">
                  <td className={cn(tableCell, "py-3 font-medium")}>{s.service}</td>
                  <td className={cn(tableCell, "py-3 tabular-nums text-con-fg2")}>
                    {s.healthyReleases}/{s.releases} clean
                    {s.syntheticChecksIgnored > 0 && <span className="block text-[12px] text-con-fg3">{s.syntheticChecksIgnored} synthetic checks ignored</span>}
                  </td>
                  <td className={cn(tableCell, "py-3")}>
                    <ul className="space-y-1">
                      {s.metrics.map((m) => (
                        <li key={m.kind + m.metric} className={STATUS_TONE[m.status]}>
                          <span className="font-mono text-[12px]">{m.metric}</span> {limitLabel(m, m.current)}
                          {m.proposed !== undefined && <> → {limitLabel(m, m.proposed)}</>}
                          <span className="block text-[12px] text-con-fg3">{m.note}</span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={cn(tableCell, "py-3", STATUS_TONE[s.bake.status])}>
                    ×{s.bake.current}
                    {s.bake.proposed !== undefined && <> → ×{s.bake.proposed}</>}
                    <span className="block max-w-[260px] text-[12px] text-con-fg3">{s.bake.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Learned risk weights"
        description={analysis.weights.status === "insufficient" ? analysis.weights.note : `${analysis.weights.note} Weights multiply the shared rules' points for this organization only; rules.json is unchanged.`}
        aside={admin && weights.length > 0 ? <ConfirmAction action={resetTuning} fields={{ service: "" }} label="Reset weights" confirmLabel="Reset" prompt="Back to the shared rules?" icon={<RotateCcw size={14} />} /> : undefined}
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="border-b border-con-line">
              <tr>
                <th className={tableHead}>Factor</th>
                <th className={tableHead}>Weight</th>
                <th className={tableHead}>Releases with / without</th>
                <th className={tableHead}>Finding</th>
              </tr>
            </thead>
            <tbody>
              {analysis.weights.factors.map((f) => (
                <tr key={f.key} className="border-b border-con-row align-top last:border-0">
                  <td className={cn(tableCell, "py-3 font-medium")}>{f.label}</td>
                  <td className={cn(tableCell, "py-3 tabular-nums", STATUS_TONE[f.status])}>
                    ×{f.current}
                    {f.proposed !== undefined && <> → ×{f.proposed}</>}
                  </td>
                  <td className={cn(tableCell, "py-3 tabular-nums text-con-fg2")}>
                    {f.stats.with} ({f.stats.withRollbacks} rolled back) / {f.stats.without} ({f.stats.withoutRollbacks})
                  </td>
                  <td className={cn(tableCell, "py-3 text-[12px]", STATUS_TONE[f.status])}>{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="In effect" description="Values accepted from earlier proposals. GET /api/v1/config serves them as services[].policy and risk.weights." flush>
        {overrides.length === 0 && weights.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-con-fg3">Nothing tuned yet: every service uses the org policy and risk uses the shared rules.</p>
        ) : (
          <ul className="divide-y divide-con-row">
            {overrides.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[13px]">
                <span>
                  <span className="font-medium">{s.name}</span>
                  <span className="block text-[12px] text-con-fg2">{describeOverride(s.o)}</span>
                </span>
                {admin && <ConfirmAction action={resetTuning} fields={{ service: s.name }} label="Use org policy" confirmLabel="Reset" prompt={`Reset ${s.name}?`} icon={<RotateCcw size={14} />} />}
              </li>
            ))}
            {weights.length > 0 && (
              <li className="px-5 py-3 text-[13px]">
                <span className="font-medium">Risk weights</span>
                <span className="block text-[12px] text-con-fg2">{weights.map(([k, v]) => `${factorLabel(k)} ×${v}`).join(", ")}</span>
              </li>
            )}
          </ul>
        )}
      </Card>

      <Card title="Settings" description="Tuning never proposes a value outside these bounds, and one proposal moves a value by at most ±50%.">
        <TuningSettings
          action={saveTuningSettings}
          readOnly={!admin}
          initial={{
            autoApply: settings.auto_apply,
            errFloor: round(b.maxRegression.error_rate.floor * 100),
            errCeiling: round(b.maxRegression.error_rate.ceiling * 100),
            latFloor: round(b.maxRegression.latency_p95.floor * 100),
            latCeiling: round(b.maxRegression.latency_p95.ceiling * 100),
            bakeFloor: b.bakeScale.floor,
          }}
        />
      </Card>

      {history.length > 0 && (
        <Card title="Decided" description="Accepted and dismissed proposals, newest first. Full detail is in the audit log." flush>
          <ol className="divide-y divide-con-row">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  {p.summary}
                  <span className="block text-[12px] text-con-fg3">
                    {p.status === "accepted" ? (p.auto_applied ? "Applied automatically" : "Accepted") : "Dismissed"} by {p.decided_label ?? "unknown"}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] text-con-fg3">{p.decided_at ? ago(p.decided_at, now) : ""}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function limitLabel(m: MetricFinding, v: number): string {
  return m.kind === "max_regression" ? `+${pct(v)}` : `+${v} abs.`;
}

function describeOverride(o: ServiceOverride): string {
  const parts = [
    ...Object.entries(o.max_regression ?? {}).map(([k, v]) => `${k} +${pct(v)}`),
    ...Object.entries(o.max_increase ?? {}).map(([k, v]) => `${k} max increase ${v}`),
    ...(o.bake_scale ? [`bake ×${o.bake_scale}`] : []),
  ];
  return parts.join(", ") || "no values";
}

function ProposalRow({ p, now, admin }: { p: Proposal; now: number; admin: boolean }) {
  const ev = p.evidence as {
    window?: { from: string; to: string; days: number };
    releases?: number; healthy_releases?: number; rollbacks?: number; skipped?: number;
    metrics?: MetricFinding[]; bake?: BakeFinding; factors?: FactorFinding[]; effect?: ExpectedEffect;
  };
  const window = ev.window ? `${ev.window.from.slice(0, 10)} to ${ev.window.to.slice(0, 10)} (${ev.window.days} days)` : "unknown window";
  const changedMetrics = (ev.metrics ?? []).filter((m) => m.status === "proposed");
  const changedFactors = (ev.factors ?? []).filter((f) => f.status === "proposed");
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="text-con-fg2">{p.kind === "service_policy" ? "Service thresholds" : "Risk weights"}</Pill>
            <span className="text-[14px] font-medium">{p.summary}</span>
          </div>
          <p className="mt-1 text-[12px] text-con-fg3">
            Proposed {ago(p.created_at, now)} · data {window} ·{" "}
            {p.kind === "service_policy"
              ? `${ev.healthy_releases ?? 0} clean of ${ev.releases ?? 0} releases`
              : `${ev.releases ?? 0} releases, ${ev.rollbacks ?? 0} rollbacks${ev.skipped ? `, ${ev.skipped} manual or default scores skipped` : ""}`}
          </p>
        </div>
        {admin && (
          <div className="flex shrink-0 items-start gap-2">
            <ConfirmAction action={dismissTuning} fields={{ id: p.id }} label="Dismiss" confirmLabel="Dismiss" tone="secondary" icon={<X size={14} />} />
            <ConfirmAction action={acceptTuning} fields={{ id: p.id }} label="Accept" confirmLabel="Apply" prompt="Apply these values?" tone="secondary" icon={<Check size={14} />} />
          </div>
        )}
      </div>
      <ul className="space-y-2 text-[13px]">
        {changedMetrics.map((m) => (
          <li key={m.kind + m.metric} className="rounded-md border border-con-line px-3 py-2">
            <span className="font-mono text-[12px]">{m.metric}</span> {m.kind === "max_regression" ? "max regression" : "max increase"} {limitLabel(m, m.current)} → <span className="font-medium">{limitLabel(m, m.proposed!)}</span>
            <span className="block text-[12px] text-con-fg2">{m.note}</span>
            <span className="block text-[12px] text-con-fg3">
              {m.stats.checks} healthy checks from {m.stats.releases} releases · median {signed(m.stats.p50)} · p95 {signed(m.stats.p95)} · max {signed(m.stats.max)}.
              Expected effect: {m.stats.healthyOver ?? 0} of {m.stats.checks} healthy checks would have exceeded the new limit;{" "}
              {m.stats.regressions ? `${m.stats.regressionsCaught} of ${m.stats.regressions} measured regressions still caught.` : "no measured regressions in the window."}
            </span>
          </li>
        ))}
        {ev.bake?.status === "proposed" && (
          <li className="rounded-md border border-con-line px-3 py-2">
            Bake ×{ev.bake.current} → <span className="font-medium">×{ev.bake.proposed}</span>
            <span className="block text-[12px] text-con-fg2">{ev.bake.note}</span>
          </li>
        )}
        {changedFactors.map((f) => (
          <li key={f.key} className="rounded-md border border-con-line px-3 py-2">
            {f.label} ×{f.current} → <span className="font-medium">×{f.proposed}</span>
            <span className="block text-[12px] text-con-fg2">{f.note}</span>
            <span className="block text-[12px] text-con-fg3">
              {f.stats.with} releases with it ({f.stats.withRollbacks} rolled back), {f.stats.without} without ({f.stats.withoutRollbacks}).
            </span>
          </li>
        ))}
        {ev.effect && (
          <li className="text-[12px] text-con-fg2">
            Expected effect on the same releases: rolled-back releases average {ev.effect.rolledBack.before} → {ev.effect.rolledBack.after} points
            ({ev.effect.rolledBackCautious.before} → {ev.effect.rolledBackCautious.after} of {ev.effect.rolledBack.n} on a medium or high plan); promoted
            releases {ev.effect.promoted.before} → {ev.effect.promoted.after} ({ev.effect.promotedHigh.before} → {ev.effect.promotedHigh.after} of {ev.effect.promoted.n} on the high plan).
          </li>
        )}
      </ul>
    </li>
  );
}

const signed = (v: number | undefined) => (v === undefined ? "n/a" : `${v >= 0 ? "+" : ""}${pct(v, 1)}`);
