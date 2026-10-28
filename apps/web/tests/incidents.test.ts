// Unit tests for alert normalisers, the "what changed?" ranking and the automatic
// rollback rules. Pure functions: no database or server needed.
//
//   node --conditions=react-server --import tsx --test tests/incidents.test.ts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AlertPayloadError, normalizeAlerts, normalizeEnvironment, normalizeSeverity, parseTags } from "../src/lib/incidents/normalize";
import {
  decideAutoRollback,
  rankCandidates,
  scoreCandidate,
  serviceMatch,
  WEIGHTS,
  type CandidateInput,
  type RankedCandidate,
} from "../src/lib/incidents/rank";
import { slackIncidentMessage } from "../src/lib/incidents/slack";

const NOW = new Date("2026-10-28T12:00:00Z");

describe("normalisers", () => {
  test("alertmanager: one entry per alert, labels and annotations mapped", () => {
    const body = {
      version: "4",
      status: "firing",
      receiver: "alror",
      groupLabels: { alertname: "HighErrorRate" },
      commonLabels: { alertname: "HighErrorRate", severity: "critical", env: "prod" },
      commonAnnotations: {},
      alerts: [
        {
          status: "firing",
          labels: { alertname: "HighErrorRate", service: "checkout", severity: "critical", env: "prod" },
          annotations: { summary: "Checkout 5xx above 5%" },
          startsAt: "2026-10-28T11:50:00Z",
          endsAt: "0001-01-01T00:00:00Z",
          fingerprint: "c0ffee1234",
        },
        {
          status: "resolved",
          labels: { alertname: "HighLatency", app: "search", severity: "warning", namespace: "staging" },
          annotations: {},
          startsAt: "2026-10-28T11:40:00Z",
        },
      ],
    };
    const [a, b] = normalizeAlerts("alertmanager", body, NOW);
    assert.equal(a.source, "alertmanager");
    assert.equal(a.status, "firing");
    assert.equal(a.title, "Checkout 5xx above 5%");
    assert.equal(a.service, "checkout");
    assert.equal(a.environment, "production");
    assert.equal(a.severity, "critical");
    assert.equal(a.started_at.toISOString(), "2026-10-28T11:50:00.000Z");
    assert.equal(a.fingerprint, "c0ffee1234");

    assert.equal(b.status, "resolved");
    assert.equal(b.title, "HighLatency");
    assert.equal(b.service, "search");
    assert.equal(b.environment, "production", "commonLabels env wins over the namespace fallback");
    assert.equal(b.severity, "warning");
    assert.match(b.fingerprint, /^h[0-9a-f]{32}$/, "hash of the labels when Alertmanager sends no fingerprint");
    // Same labels, same fingerprint.
    assert.equal(normalizeAlerts("alertmanager", body, NOW)[1].fingerprint, b.fingerprint);
  });

  test("alertmanager: payload without alerts is rejected", () => {
    assert.throws(() => normalizeAlerts("alertmanager", { status: "firing" }, NOW), AlertPayloadError);
  });

  test("datadog: tags, transition, priority and epoch-ms dates", () => {
    const firing = {
      id: "7364823",
      title: "[Triggered on {service:api}] API error rate is high",
      alert_id: "12345",
      alert_scope: "service:api,env:prod",
      alert_transition: "Triggered",
      alert_type: "error",
      tags: "service:api,env:prod,team:core",
      date: "1793188200000",
      priority: "P2",
    };
    const [a] = normalizeAlerts("datadog", firing, NOW);
    assert.equal(a.status, "firing");
    assert.equal(a.title, "API error rate is high");
    assert.equal(a.service, "api");
    assert.equal(a.environment, "production");
    assert.equal(a.severity, "critical");
    assert.equal(a.started_at.getTime(), 1793188200000);
    assert.equal(a.fingerprint, "12345:service:api,env:prod");

    const [r] = normalizeAlerts("datadog", { ...firing, alert_transition: "Recovered", alert_type: "success" }, NOW);
    assert.equal(r.status, "resolved");
    assert.equal(r.fingerprint, a.fingerprint, "recovery resolves the same alert");

    const [w] = normalizeAlerts("datadog", { title: "Disk", alert_type: "warning", aggregate: "agg1" }, NOW);
    assert.equal(w.severity, "warning");
    assert.equal(w.fingerprint, "agg1");
    assert.equal(w.started_at.getTime(), NOW.getTime(), "no date: now");
    assert.throws(() => normalizeAlerts("datadog", { tags: "x:y" }, NOW), AlertPayloadError);
  });

  test("sentry: internal integration issue alert", () => {
    const body = {
      action: "triggered",
      data: {
        event: {
          title: "TypeError: cannot read properties of undefined",
          level: "error",
          environment: "production",
          datetime: "2026-10-28T11:55:00Z",
          issue_id: "4501",
          tags: [
            ["environment", "production"],
            ["service", "web-frontend"],
          ],
        },
        triggered_rule: "New issue",
      },
    };
    const [a] = normalizeAlerts("sentry", body, NOW);
    assert.equal(a.title, "TypeError: cannot read properties of undefined");
    assert.equal(a.service, "web-frontend");
    assert.equal(a.environment, "production");
    assert.equal(a.severity, "error");
    assert.equal(a.started_at.toISOString(), "2026-10-28T11:55:00.000Z");
    assert.equal(a.fingerprint, "4501");
    assert.equal(a.status, "firing");
  });

  test("sentry: issue webhook and resolution, project slug as the service", () => {
    const issue = { id: "99", title: "Timeout in billing", level: "fatal", status: "unresolved", firstSeen: "2026-10-28T11:30:00Z", project: { slug: "billing" } };
    const [a] = normalizeAlerts("sentry", { action: "created", data: { issue } }, NOW);
    assert.equal(a.service, "billing");
    assert.equal(a.severity, "critical");
    assert.equal(a.fingerprint, "99");
    const [r] = normalizeAlerts("sentry", { action: "resolved", data: { issue: { ...issue, status: "resolved" } } }, NOW);
    assert.equal(r.status, "resolved");
    assert.equal(r.fingerprint, "99");
  });

  test("sentry: legacy webhook plugin", () => {
    const [a] = normalizeAlerts(
      "sentry",
      { id: "321", project: "payments", project_slug: "payments", message: "Card declined spike", level: "warning", event: { environment: "prod", timestamp: 1793188000 } },
      NOW,
    );
    assert.equal(a.service, "payments");
    assert.equal(a.environment, "production");
    assert.equal(a.severity, "warning");
    assert.equal(a.started_at.getTime(), 1793188000 * 1000);
    assert.equal(a.fingerprint, "321");
  });

  test("generic: one object, a batch, defaults and resolution", () => {
    const [a] = normalizeAlerts("generic", { title: "Queue backlog", service: "worker", environment: "stg", severity: "P1", started_at: "2026-10-28T11:58:00Z" }, NOW);
    assert.equal(a.environment, "staging");
    assert.equal(a.severity, "critical");
    assert.match(a.fingerprint, /^h[0-9a-f]{32}$/);

    const batch = normalizeAlerts("generic", { alerts: [{ title: "A", fingerprint: "fa", labels: { service: "x" } }, { title: "B", status: "resolved", fingerprint: "fb" }] }, NOW);
    assert.equal(batch.length, 2);
    assert.equal(batch[0].service, "x");
    assert.equal(batch[0].severity, "warning");
    assert.equal(batch[1].status, "resolved");
    assert.throws(() => normalizeAlerts("generic", { service: "x" }, NOW), /title/);
    assert.throws(() => normalizeAlerts("generic", [1, 2], NOW), AlertPayloadError);
  });

  test("helpers", () => {
    assert.equal(normalizeEnvironment(" PROD "), "production");
    assert.equal(normalizeEnvironment("eu-west"), "eu-west");
    assert.equal(normalizeSeverity("sev2"), "error");
    assert.equal(normalizeSeverity("low"), "info");
    assert.equal(normalizeSeverity("whatever"), "warning");
    assert.deepEqual(parseTags(["service:a", "env:prod", "bare"]), { service: "a", env: "prod" });
  });
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const START = new Date("2026-10-28T12:00:00Z");
const minsBefore = (m: number) => new Date(START.getTime() - m * 60_000).toISOString();

function dep(over: Partial<CandidateInput> & { id: string; ago: number }): CandidateInput {
  const { ago, ...rest } = over;
  return {
    service: "checkout",
    image: `${over.id}:v1`,
    environment: "production",
    status: "promoted",
    created_at: minsBefore(ago),
    updated_at: minsBefore(Math.max(0, ago - 10)),
    risk_score: 40,
    risk_level: "medium",
    related_services: [],
    verdicts: [],
    ...rest,
  };
}

const alert = { service: "checkout", environment: "production", started_at: START };

describe("ranking", () => {
  test("weights add up to 100", () => {
    assert.equal(Object.values(WEIGHTS).reduce((a, b) => a + b, 0), 100);
  });

  test("service match: exact, related (touched or name extension), none, unknown", () => {
    assert.equal(serviceMatch("checkout", { service: "Checkout", related_services: [] }), "exact");
    assert.equal(serviceMatch("checkout", { service: "cart", related_services: ["checkout"] }), "related");
    assert.equal(serviceMatch("checkout", { service: "checkout-worker", related_services: [] }), "related");
    assert.equal(serviceMatch("checkout", { service: "checkoutx", related_services: [] }), "none");
    assert.equal(serviceMatch("api", { service: "billing", related_services: [] }), "none");
    assert.equal(serviceMatch("", { service: "billing", related_services: [] }), "unknown");
  });

  test("every signal is explained and the score is their sum", () => {
    const c = scoreCandidate(alert, dep({ id: "d1", ago: 12, status: "rolling", risk_score: 60 }))!;
    assert.deepEqual(
      c.signals.map((s) => s.signal),
      ["service", "recency", "risk", "state", "metrics", "environment"],
    );
    for (const s of c.signals) assert.ok(s.detail.length > 0);
    assert.equal(c.score, Math.round(c.signals.reduce((a, s) => a + s.points, 0)));
    // exact 40 + recency 25*(1-12/120)=22.5 + risk 9 + rolling 10 + metrics 0
    assert.equal(c.score, 82);
    assert.equal(c.service_match, "exact");
    assert.equal(c.minutes_before, 12);
  });

  test("exact beats related beats none; closer beats older", () => {
    const ranked = rankCandidates(alert, [
      dep({ id: "none", ago: 5, service: "search" }),
      dep({ id: "related", ago: 5, service: "checkout-worker" }),
      dep({ id: "exact-old", ago: 30 }),
      dep({ id: "exact-new", ago: 10 }),
    ]);
    assert.deepEqual(
      ranked.map((r) => r.deployment_id),
      ["exact-new", "exact-old", "related", "none"],
    );
  });

  test("window: deployments after the alert or older than the window are left out, unless still rolling", () => {
    const ranked = rankCandidates(alert, [
      dep({ id: "after", ago: -10 }),
      dep({ id: "skew", ago: -1 }),
      dep({ id: "old", ago: 200 }),
      dep({ id: "old-rolling", ago: 200, status: "rolling" }),
    ]);
    const ids = ranked.map((r) => r.deployment_id);
    assert.ok(!ids.includes("after"));
    assert.ok(!ids.includes("old"));
    assert.ok(ids.includes("skew"), "within the clock-skew allowance");
    assert.ok(ids.includes("old-rolling"));
    const skew = ranked.find((r) => r.deployment_id === "skew")!;
    assert.equal(skew.minutes_before, 0);
    assert.equal(rankCandidates(alert, [dep({ id: "old", ago: 200 })], { windowMinutes: 240 }).length, 1);
  });

  test("outcome state: rolling and just promoted rank above long-promoted; rolled back before the alert sinks", () => {
    const base = { ago: 30, risk_score: 40 };
    const rolling = scoreCandidate(alert, dep({ id: "r", ...base, status: "rolling" }))!;
    const justPromoted = scoreCandidate(alert, dep({ id: "j", ...base, status: "promoted", updated_at: minsBefore(3) }))!;
    const promotedEarlier = scoreCandidate(alert, dep({ id: "p", ...base, status: "promoted", updated_at: minsBefore(25) }))!;
    const rolledBack = scoreCandidate(alert, dep({ id: "b", ...base, status: "rolled_back", updated_at: minsBefore(20) }))!;
    assert.equal(rolling.score, justPromoted.score);
    assert.ok(justPromoted.score > promotedEarlier.score);
    assert.ok(promotedEarlier.score > rolledBack.score);
    assert.match(rolledBack.signals.find((s) => s.signal === "state")!.detail, /before the alert started/);
  });

  test("risk and failed verdicts raise the score", () => {
    const low = scoreCandidate(alert, dep({ id: "l", ago: 20, risk_score: 10 }))!;
    const high = scoreCandidate(alert, dep({ id: "h", ago: 20, risk_score: 90 }))!;
    assert.ok(high.score > low.score);
    const failed = scoreCandidate(alert, dep({ id: "f", ago: 20, verdicts: [{ metric: "error_rate", delta: 0.6, pass: false }] }))!;
    const moved = scoreCandidate(alert, dep({ id: "m", ago: 20, verdicts: [{ metric: "latency_p95", delta: 0.125, pass: true }] }))!;
    const flat = scoreCandidate(alert, dep({ id: "z", ago: 20, verdicts: [{ metric: "error_rate", delta: -0.1, pass: true }] }))!;
    const metric = (c: RankedCandidate) => c.signals.find((s) => s.signal === "metrics")!;
    assert.equal(metric(failed).points, 10);
    assert.match(metric(failed).detail, /failed on error_rate \(\+60%\)/);
    assert.equal(metric(moved).points, 3);
    assert.equal(metric(flat).points, 0);
    assert.equal(metric(low).detail, "No stored verdicts");
  });

  test("environment mismatch is penalised, unknown environments are not", () => {
    const same = scoreCandidate(alert, dep({ id: "s", ago: 20 }))!;
    const other = scoreCandidate(alert, dep({ id: "o", ago: 20, environment: "staging" }))!;
    const unknown = scoreCandidate({ ...alert, environment: "" }, dep({ id: "u", ago: 20 }))!;
    assert.equal(same.score - other.score, 25);
    assert.equal(unknown.score, same.score);
  });

  test("scores stay within 0 to 100", () => {
    const worst = scoreCandidate(alert, dep({ id: "w", ago: 119, service: "x", environment: "staging", status: "rolled_back", risk_score: 0 }))!;
    assert.equal(worst.score, 0);
    const best = scoreCandidate(alert, dep({ id: "b", ago: 0, status: "rolling", risk_score: 100, verdicts: [{ metric: "error_rate", delta: 2, pass: false }] }))!;
    assert.equal(best.score, 100);
  });
});

// ---------------------------------------------------------------------------
// Automatic rollback
// ---------------------------------------------------------------------------

describe("automatic rollback", () => {
  const on = { enabled: true, threshold: 80, max_age_minutes: 30 };
  const strong = () => rankCandidates(alert, [dep({ id: "top", ago: 8, status: "rolling", risk_score: 70 }), dep({ id: "other", ago: 60, service: "search" })]);

  test("rolls back when every rule passes", () => {
    const ranked = strong();
    assert.ok(ranked[0].score >= 80, `top scored ${ranked[0].score}`);
    const d = decideAutoRollback(on, ranked);
    assert.equal(d.rollback, true);
    assert.equal(d.deployment_id, "top");
    assert.ok(d.checks.every((c) => c.pass));
  });

  test("off by default and when disabled", () => {
    const d = decideAutoRollback({ ...on, enabled: false }, strong());
    assert.equal(d.rollback, false);
    assert.equal(d.deployment_id, null);
    assert.equal(d.checks.find((c) => c.rule === "enabled")!.pass, false);
  });

  test("each safety rule blocks on its own", () => {
    const fail = (ranked: RankedCandidate[], rule: string, settings = on, firing = true) => {
      const d = decideAutoRollback(settings, ranked, firing);
      assert.equal(d.rollback, false, rule);
      assert.equal(d.checks.find((c) => c.rule === rule)!.pass, false, rule);
    };
    fail(strong(), "confidence", { ...on, threshold: 99 });
    fail(rankCandidates(alert, [dep({ id: "slow", ago: 45, status: "rolling", risk_score: 100, verdicts: [{ metric: "error_rate", delta: 1, pass: false }] })]), "recency");
    fail(rankCandidates({ ...alert, service: "checkout-api" }, [dep({ id: "rel", ago: 5, service: "checkout", related_services: ["checkout-api"], status: "rolling", risk_score: 100, verdicts: [{ metric: "error_rate", delta: 1, pass: false }] })]), "service", { ...on, threshold: 60 });
    fail(rankCandidates(alert, [dep({ id: "a", ago: 5, status: "rolling", risk_score: 80 }), dep({ id: "b", ago: 6, status: "rolling", risk_score: 75 })]), "margin");
    fail(strong(), "firing", on, false);
    fail([], "candidate");
    const rolledBack = strong().map((c, i) => (i === 0 ? { ...c, status: "rolled_back" as const } : c));
    fail(rolledBack, "rollbackable");
  });
});

describe("slack message", () => {
  test("lists the top candidates with reasons and links to the incident", () => {
    const ranked = strong3();
    const m = slackIncidentMessage(
      { id: "i1", title: "Checkout <5xx>", service: "checkout", environment: "production", severity: "critical", source: "alertmanager" },
      ranked,
      { incident: "https://alror.example/app/incidents/i1", deployment: (id) => `https://alror.example/app/deployments/${id}` },
    );
    assert.match(m.text, /Top candidate: top/);
    const json = JSON.stringify(m.blocks);
    assert.match(json, /Checkout &lt;5xx&gt;/);
    assert.match(json, /https:\/\/alror.example\/app\/incidents\/i1/);
    assert.match(json, /Review and roll back/);
    assert.match(json, /same service as the alert/);
  });
});

function strong3() {
  return rankCandidates(alert, [dep({ id: "top", ago: 8, status: "rolling", risk_score: 70 }), dep({ id: "two", ago: 60 }), dep({ id: "three", ago: 90, service: "search" })]);
}
