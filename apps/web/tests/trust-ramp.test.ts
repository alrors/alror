import assert from "node:assert/strict";
import { test } from "node:test";
import { rampInbox, releaseInbox } from "../src/lib/console/oversight";
import {
  classifyRecommendation,
  DAY_MS,
  DEFAULT_TRUST_RAMP,
  effectiveMode,
  evaluateRamp,
  HOUR_MS,
  rampEvidence,
  rampProgress,
  rampSettings,
  validateRampSettings,
  type Recommendation,
  type RecOutcome,
} from "../src/lib/console/trust-ramp";
import type { DeployEvent, Deployment, Status } from "../src/lib/console/types";

const T0 = Date.parse("2026-10-01T12:00:00Z");
const iso = (t: number) => new Date(t).toISOString();
const S = DEFAULT_TRUST_RAMP;

function dep(id: string, status: Status, createdAt: number, extra: Partial<Deployment> = {}): Deployment {
  return {
    id,
    service: "api",
    image: `api:${id}`,
    ref: `#${id}`,
    risk: { score: 20, level: "low", factors: [], services: [], ai_authored: false },
    plan: { strategy: "canary", steps: [{ weight: 5, bake: 1 }, { weight: 100, bake: 0 }] },
    status,
    step_index: 0,
    weight: 5,
    created_at: iso(createdAt),
    updated_at: iso(createdAt + HOUR_MS),
    environment: "production",
    ...extra,
  };
}
const shadowEvent = (t: number): DeployEvent => ({ at: iso(t), kind: "verdict", weight: 5, message: "Shadow mode: would roll back here; continuing because auto_rollback is off" });
const passEvent = (t: number): DeployEvent => ({ at: iso(t), kind: "verdict", weight: 5, message: "ok", verdict: { pass: true, summary: "", results: [] } });

function classify(d: Deployment, events: DeployEvent[], o: Partial<Parameters<typeof classifyRecommendation>[2]> = {}) {
  return classifyRecommendation(d, events, { later: [], signals: [], feedback: null, settings: S, now: T0 + 2 * DAY_MS, ...o });
}

function rec(id: string, t: number, outcome: RecOutcome, service = "api"): Recommendation {
  return { id, service, environment: "production", image: "x", at: iso(t), window_ends_at: iso(t + DAY_MS), message: "", outcome, by: null, detail: "", feedback: null };
}

/* ---------------------------------- settings ---------------------------------- */

test("settings: defaults are propose-only, 3 confirmed, 30 days, 24 h; stored values are clamped", () => {
  assert.deepEqual(rampSettings(null), { auto_graduate: false, required_confirmed: 3, false_alarm_days: 30, window_hours: 24 });
  assert.deepEqual(rampSettings({ required_confirmed: 0, false_alarm_days: 9999, auto_graduate: true }), { auto_graduate: true, required_confirmed: 1, false_alarm_days: 365, window_hours: 24 });
  assert.deepEqual(validateRampSettings({ required_confirmed: 3, false_alarm_days: 30, window_hours: 24 }), {});
  assert.deepEqual(Object.keys(validateRampSettings({ required_confirmed: 2.5, false_alarm_days: 0, window_hours: 24 })).sort(), ["false_alarm_days", "required_confirmed"]);
});

test("effective mode: a service override wins over the org policy", () => {
  assert.equal(effectiveMode(null, true), "auto");
  assert.equal(effectiveMode(null, false), "shadow");
  assert.equal(effectiveMode("shadow", true), "shadow");
  assert.equal(effectiveMode("auto", false), "auto");
});

/* ------------------------------- classification ------------------------------- */

test("no shadow event means no recommendation", () => {
  assert.equal(classify(dep("1", "promoted", T0), [passEvent(T0 + 60_000)]), null);
});

test("a manual rollback within the window confirms; after the window it does not", () => {
  const d = dep("1", "rolled_back", T0);
  const inWindow = classify(d, [shadowEvent(T0 + 60_000), { at: iso(T0 + 3 * HOUR_MS), kind: "rolled_back", message: "Manual rollback · bad" }]);
  assert.equal(inWindow?.outcome, "confirmed");
  assert.equal(inWindow?.by, "rollback");
  const late = classify(d, [shadowEvent(T0 + 60_000), { at: iso(T0 + 30 * HOUR_MS), kind: "rolled_back", message: "Manual rollback" }]);
  assert.equal(late?.outcome, "unconfirmed");
});

test("a replacement confirms only after an alert or incident for the service", () => {
  const d = dep("1", "promoted", T0);
  const next = dep("2", "promoted", T0 + 5 * HOUR_MS);
  const events = [shadowEvent(T0 + 60_000)];
  assert.equal(classify(d, events, { later: [next] })?.outcome, "unconfirmed", "a plain later release is not evidence");
  const alert = { service: "api", environment: "production", at: iso(T0 + 2 * HOUR_MS), label: "an alert" };
  const r = classify(d, events, { later: [next], signals: [alert] });
  assert.equal(r?.outcome, "confirmed");
  assert.equal(r?.by, "replaced");
  assert.match(r!.detail, /Replaced by #2 5 h later, after an alert/);
  assert.equal(classify(d, events, { later: [next], signals: [{ ...alert, service: "web" }] })?.outcome, "unconfirmed", "another service's alert");
  assert.equal(classify(d, events, { later: [{ ...next, environment: "staging" }], signals: [alert] })?.outcome, "unconfirmed", "another environment");
  assert.equal(classify(d, events, { later: [dep("3", "promoted", T0 + 30 * HOUR_MS)], signals: [alert] })?.outcome, "unconfirmed", "replaced after the window");
});

test("human feedback decides; with no evidence the window is pending, then unconfirmed", () => {
  const d = dep("1", "promoted", T0);
  const events = [shadowEvent(T0 + 60_000)];
  assert.equal(classify(d, events, { feedback: "correct" })?.outcome, "confirmed");
  assert.equal(classify(d, events, { feedback: "false_alarm" })?.outcome, "false_alarm");
  assert.equal(classify(d, events, { now: T0 + 2 * HOUR_MS })?.outcome, "pending");
  assert.equal(classify(d, events, { now: T0 + 2 * DAY_MS })?.outcome, "unconfirmed");
  const custom = classify(d, events, { now: T0 + 2 * DAY_MS, settings: { ...S, window_hours: 72 } });
  assert.equal(custom?.outcome, "pending", "the window is configurable");
  // A person's answer overrides a rollback.
  const rolled = dep("1", "rolled_back", T0);
  assert.equal(classify(rolled, [...events, { at: iso(T0 + HOUR_MS), kind: "rolled_back", message: "Manual rollback" }], { feedback: "false_alarm" })?.outcome, "false_alarm");
});

/* ---------------------------------- the rule ---------------------------------- */

const now = T0 + 40 * DAY_MS;
const svc = { name: "api", override: null };

test("eligible after N confirmed and no false alarm in M days", () => {
  const recs = [rec("a", now - 20 * DAY_MS, "confirmed"), rec("b", now - 10 * DAY_MS, "confirmed"), rec("c", now - 2 * DAY_MS, "confirmed")];
  const e = evaluateRamp(svc, recs, false, S, now);
  assert.equal(e.mode, "shadow");
  assert.equal(e.eligible, true);
  assert.equal(e.status, "eligible");
  assert.deepEqual(e.evidence, ["a", "b", "c"]);
  assert.equal(rampProgress(e), "3/3 confirmed · 0 false alarms");
  assert.equal(e.eligible_since, recs[2].at);
  assert.match(e.why, /3 confirmed recommendations and no false alarms in the last 30 days/);
  const ev = rampEvidence(e, S);
  assert.deepEqual(ev.evidence, ["a", "b", "c"]);
  assert.equal(ev.rule, "3 confirmed shadow recommendations and no false alarms in 30 days");
});

test("not eligible with fewer than N; pending and unconfirmed ones do not count", () => {
  const e = evaluateRamp(svc, [rec("a", now - 5 * DAY_MS, "confirmed"), rec("b", now - 3 * DAY_MS, "confirmed"), rec("c", now - 2 * DAY_MS, "unconfirmed"), rec("d", now - HOUR_MS, "pending")], false, S, now);
  assert.equal(e.eligible, false);
  assert.equal(e.status, "building");
  assert.equal(rampProgress(e), "2/3 confirmed · 0 false alarms");
  assert.match(e.why, /2 of 3 confirmed \(1 still in the window, 1 recommendation waiting for a human verdict\)\. Needs 1 more confirmed recommendation\./);
});

test("a false alarm resets the ramp and blocks graduation for M days", () => {
  const recs = [
    rec("a", now - 25 * DAY_MS, "confirmed"),
    rec("b", now - 24 * DAY_MS, "confirmed"),
    rec("c", now - 23 * DAY_MS, "confirmed"),
    rec("x", now - 20 * DAY_MS, "false_alarm"),
    rec("d", now - 10 * DAY_MS, "confirmed"),
  ];
  const e = evaluateRamp(svc, recs, false, S, now);
  assert.equal(e.eligible, false);
  assert.equal(e.status, "reset");
  assert.equal(e.confirmed, 1, "only confirmations after the false alarm count");
  assert.equal(e.false_alarms, 1);
  assert.match(e.why, /A false alarm on \d{4}-\d{2}-\d{2} reset the ramp: 1 of 3 confirmed since\. Not eligible before/);

  // Three more confirmations after the false alarm are still blocked inside the M-day window...
  const more = [...recs, rec("e", now - 8 * DAY_MS, "confirmed"), rec("f", now - 6 * DAY_MS, "confirmed")];
  assert.equal(evaluateRamp(svc, more, false, S, now).eligible, false);
  // ...and eligible once the false alarm is older than M days.
  const later = now + 11 * DAY_MS;
  const ok = evaluateRamp(svc, more, false, S, later);
  assert.equal(ok.eligible, true);
  assert.deepEqual(ok.evidence, ["d", "e", "f"]);
  assert.equal(ok.eligible_since, iso(Date.parse(recs[3].at) + 30 * DAY_MS));
  // A shorter M makes it eligible sooner.
  assert.equal(evaluateRamp(svc, more, false, { ...S, false_alarm_days: 7 }, now).eligible, true);
});

test("thresholds are configurable", () => {
  const recs = [rec("a", now - 3 * DAY_MS, "confirmed")];
  assert.equal(evaluateRamp(svc, recs, false, { ...S, required_confirmed: 1 }, now).eligible, true);
  assert.equal(evaluateRamp(svc, recs, false, S, now).eligible, false);
});

test("a demotion back to shadow restarts the ramp", () => {
  const recs = [rec("a", now - 9 * DAY_MS, "confirmed"), rec("b", now - 8 * DAY_MS, "confirmed"), rec("c", now - 7 * DAY_MS, "confirmed"), rec("d", now - DAY_MS, "confirmed")];
  const e = evaluateRamp({ name: "api", override: "shadow", resetAt: iso(now - 5 * DAY_MS) }, recs, true, S, now);
  assert.equal(e.mode, "shadow");
  assert.equal(e.confirmed, 1);
  assert.equal(e.eligible, false);
  assert.match(e.why, /since it went back to shadow on/);
});

test("services already rolling back automatically are never eligible", () => {
  const recs = [rec("a", now - 3 * DAY_MS, "confirmed"), rec("b", now - 2 * DAY_MS, "confirmed"), rec("c", now - DAY_MS, "confirmed")];
  const viaOrg = evaluateRamp(svc, recs, true, S, now);
  assert.equal(viaOrg.status, "automatic");
  assert.equal(viaOrg.eligible, false);
  assert.equal(viaOrg.explicit, false);
  const viaOverride = evaluateRamp({ name: "api", override: "auto" }, recs, false, S, now);
  assert.equal(viaOverride.status, "automatic");
  assert.equal(viaOverride.explicit, true);
});

test("other services' recommendations do not count; no recommendations explains the rule", () => {
  const e = evaluateRamp(svc, [rec("a", now - DAY_MS, "confirmed", "web")], false, S, now);
  assert.equal(e.confirmed, 0);
  assert.match(e.why, /No shadow recommendations yet\. Needs 3 confirmed recommendations with no false alarms in 30 days\./);
});

/* ------------------------------------ inbox ----------------------------------- */

test("eligible services appear in Needs you as ready for automatic rollback", () => {
  const recs = [rec("a", now - 3 * DAY_MS, "confirmed"), rec("b", now - 2 * DAY_MS, "confirmed"), rec("c", now - DAY_MS, "confirmed")];
  const items = rampInbox([evaluateRamp(svc, recs, false, S, now), evaluateRamp({ name: "web", override: null }, [], false, S, now)]);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "ready_for_auto");
  assert.equal(items[0].subject, "api");
  assert.equal(items[0].primary.href, "/app/policies#trust-ramp");
  assert.match(items[0].reason, /^Ready for automatic rollback: 3\/3 confirmed · 0 false alarms\./);
  assert.equal(items[0].key, "ramp-api-a.b.c");
});

test("recommendation inbox items offer feedback and drop once a person judged them", () => {
  const d = dep("1", "promoted", T0);
  const events = new Map([[d.id, [shadowEvent(T0 + 60_000)]]]);
  const items = releaseInbox([d], events, {}, T0 + HOUR_MS);
  assert.equal(items[0]?.kind, "recommendation");
  assert.deepEqual(items[0]?.feedback, { id: "1", current: null });
  assert.equal(releaseInbox([d], events, {}, T0 + HOUR_MS, new Map([["1", "correct"]])).length, 0);
});
