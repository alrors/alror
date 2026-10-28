// Trust ramp: when a service in shadow mode has earned automatic rollback.
// Pure functions over stored releases, events and human feedback; no I/O, so they
// run on the server, in the browser and in unit tests alike.
//
// A shadow recommendation is a verdict event without a verdict: the engine logged
// "would roll back here" and kept going (internal/rollout/engine.go). Its outcome:
//   confirmed     a person marked it correct, or within the window the release was
//                 rolled back, or a later release replaced it after an alert/incident;
//   false_alarm   a person marked it a false alarm;
//   pending       the window is still open and nothing has happened yet;
//   unconfirmed   the window closed with the release still up and no human verdict.
// A service is eligible for automatic rollback after `required_confirmed` confirmed
// recommendations since its last false alarm (or demotion), with no false alarm in
// the last `false_alarm_days` days.

import type { DeployEvent, Deployment } from "./types";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export type RollbackMode = "auto" | "shadow";
export const ROLLBACK_MODES: readonly RollbackMode[] = ["auto", "shadow"];

export type ShadowFeedback = "correct" | "false_alarm";
export const SHADOW_FEEDBACK: readonly ShadowFeedback[] = ["correct", "false_alarm"];

export type TrustRampSettings = {
  /** false: propose graduation to a person (default); true: switch eligible services automatically. */
  auto_graduate: boolean;
  /** Confirmed recommendations needed since the last false alarm (N). */
  required_confirmed: number;
  /** No false alarm may fall in this many days before graduation (M). */
  false_alarm_days: number;
  /** How long after a recommendation a rollback or replacement still confirms it. */
  window_hours: number;
};

export const DEFAULT_TRUST_RAMP: TrustRampSettings = { auto_graduate: false, required_confirmed: 3, false_alarm_days: 30, window_hours: 24 };

export const RAMP_LIMITS = {
  required_confirmed: { min: 1, max: 50 },
  false_alarm_days: { min: 1, max: 365 },
  window_hours: { min: 1, max: 24 * 14 },
} as const;

/** Stored settings (possibly partial or null) with defaults applied and values clamped. */
export function rampSettings(stored: Partial<TrustRampSettings> | null | undefined): TrustRampSettings {
  const s = { ...DEFAULT_TRUST_RAMP, ...(stored ?? {}) };
  const int = (v: unknown, k: keyof typeof RAMP_LIMITS) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(Math.max(n, RAMP_LIMITS[k].min), RAMP_LIMITS[k].max) : DEFAULT_TRUST_RAMP[k];
  };
  return {
    auto_graduate: s.auto_graduate === true,
    required_confirmed: int(s.required_confirmed, "required_confirmed"),
    false_alarm_days: int(s.false_alarm_days, "false_alarm_days"),
    window_hours: int(s.window_hours, "window_hours"),
  };
}

/** Field errors for a settings form, keyed by field. Empty when valid. */
export function validateRampSettings(s: Partial<Record<keyof TrustRampSettings, unknown>>): Partial<Record<keyof TrustRampSettings, string>> {
  const errs: Partial<Record<keyof TrustRampSettings, string>> = {};
  for (const k of Object.keys(RAMP_LIMITS) as (keyof typeof RAMP_LIMITS)[]) {
    const v = Number(s[k]);
    const { min, max } = RAMP_LIMITS[k];
    if (!Number.isInteger(v) || v < min || v > max) errs[k] = `Use a whole number from ${min} to ${max}.`;
  }
  return errs;
}

/** The mode a service runs in: its own override, else the org's policy.auto_rollback. */
export function effectiveMode(override: RollbackMode | null | undefined, orgAutoRollback: boolean): RollbackMode {
  return override ?? (orgAutoRollback ? "auto" : "shadow");
}

/** Shadow-mode recommendations in a release's events (verdict events without a verdict). */
export const shadowRecommendations = (events: DeployEvent[]) => events.filter((e) => e.kind === "verdict" && !e.verdict);

/** A signal that something went wrong with a service: an incident opened from an alert. */
export type RampSignal = { service: string; environment?: string | null; at: string; label: string };

export type RecOutcome = "confirmed" | "false_alarm" | "pending" | "unconfirmed";

export type Recommendation = {
  id: string;
  service: string;
  environment: string;
  ref?: string;
  image: string;
  /** When shadow mode first said it would roll back. */
  at: string;
  /** End of the confirmation window. */
  window_ends_at: string;
  message: string;
  outcome: RecOutcome;
  /** What decided the outcome. */
  by: "feedback" | "rollback" | "replaced" | null;
  /** One line of evidence. */
  detail: string;
  feedback: ShadowFeedback | null;
};

const fmtHours = (ms: number) => (ms < HOUR_MS ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 2 * DAY_MS ? `${Math.round(ms / HOUR_MS)} h` : `${Math.round(ms / DAY_MS)} d`);

/**
 * Classifies one release's shadow recommendation. `later` are releases of the same
 * service and environment (any order; only those created after this one count),
 * `signals` alerts or incidents for the service. Returns null when the release has
 * no shadow recommendation.
 */
export function classifyRecommendation(
  d: Deployment,
  events: DeployEvent[],
  ctx: { later: Deployment[]; signals: RampSignal[]; feedback: ShadowFeedback | null; settings: TrustRampSettings; now: number },
): Recommendation | null {
  const recs = shadowRecommendations(events);
  if (!recs.length) return null;
  const at = Date.parse(recs[0].at);
  const windowMs = ctx.settings.window_hours * HOUR_MS;
  const end = at + windowMs;
  const env = d.environment ?? "production";
  const base = {
    id: d.id,
    service: d.service,
    environment: env,
    ...(d.ref ? { ref: d.ref } : {}),
    image: d.image,
    at: recs[0].at,
    window_ends_at: new Date(end).toISOString(),
    message: recs[recs.length - 1].message,
    feedback: ctx.feedback,
  };

  if (ctx.feedback === "correct") return { ...base, outcome: "confirmed", by: "feedback", detail: "A person marked the recommendation correct." };
  if (ctx.feedback === "false_alarm") return { ...base, outcome: "false_alarm", by: "feedback", detail: "A person marked the recommendation a false alarm." };

  if (d.status === "rolled_back") {
    const rb = events.find((e) => e.kind === "rolled_back");
    const rbAt = Date.parse(rb?.at ?? d.updated_at);
    if (rbAt >= at && rbAt <= end) return { ...base, outcome: "confirmed", by: "rollback", detail: `Rolled back ${fmtHours(rbAt - at)} after the recommendation.` };
  }

  const created = Date.parse(d.created_at);
  const replacement = ctx.later
    .filter((x) => x.id !== d.id && x.service === d.service && (x.environment ?? "production") === env)
    .map((x) => ({ x, t: Date.parse(x.created_at) }))
    .filter(({ t }) => t > created && t >= at && t <= end)
    .sort((a, b) => a.t - b.t)[0];
  if (replacement) {
    const alert = ctx.signals
      .filter((s) => s.service === d.service && (!s.environment || s.environment === env))
      .map((s) => ({ s, t: Date.parse(s.at) }))
      .filter(({ t }) => t >= at && t <= replacement.t)
      .sort((a, b) => a.t - b.t)[0];
    if (alert) {
      const name = replacement.x.ref || replacement.x.image;
      return { ...base, outcome: "confirmed", by: "replaced", detail: `Replaced by ${name} ${fmtHours(replacement.t - at)} later, after ${alert.s.label}.` };
    }
  }

  if (ctx.now < end) return { ...base, outcome: "pending", by: null, detail: `Watching until the ${ctx.settings.window_hours} h window closes.` };
  return { ...base, outcome: "unconfirmed", by: null, detail: `Stayed up through the ${ctx.settings.window_hours} h window. Mark it correct or a false alarm.` };
}

export type RampStatus = "automatic" | "eligible" | "building" | "reset";

export type RampEvaluation = {
  service: string;
  mode: RollbackMode;
  /** True when the service has its own override; false when it follows the org default. */
  explicit: boolean;
  status: RampStatus;
  eligible: boolean;
  required: number;
  /** Confirmed recommendations that count toward graduation. */
  confirmed: number;
  /** False alarms in the last `false_alarm_days`. */
  false_alarms: number;
  pending: number;
  unconfirmed: number;
  /** The most recent false alarm, any age. */
  last_false_alarm: string | null;
  /** Why the service is or isn't eligible, one or two sentences. */
  why: string;
  /** Release ids of the confirmed recommendations that count. */
  evidence: string[];
  /** When the service became eligible (null unless eligible). */
  eligible_since: string | null;
  /** Shadow recommendations on record for the service, any outcome. */
  recommendations: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dateOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The graduation rule for one service. `resetAt` is when the ramp last restarted
 * (a demotion back to shadow); recommendations before it do not count.
 */
export function evaluateRamp(
  svc: { name: string; override: RollbackMode | null; resetAt?: string | null },
  recs: Recommendation[],
  orgAutoRollback: boolean,
  settings: TrustRampSettings,
  now: number,
): RampEvaluation {
  const mode = effectiveMode(svc.override, orgAutoRollback);
  const mine = recs.filter((r) => r.service === svc.name).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const alarms = mine.filter((r) => r.outcome === "false_alarm");
  const lastAlarm = alarms.length ? Date.parse(alarms[alarms.length - 1].at) : null;
  const reset = svc.resetAt ? Date.parse(svc.resetAt) : null;
  const since = Math.max(lastAlarm ?? -Infinity, reset ?? -Infinity);
  const counted = mine.filter((r) => Date.parse(r.at) > since);
  const confirmed = counted.filter((r) => r.outcome === "confirmed");
  const pending = counted.filter((r) => r.outcome === "pending").length;
  const unconfirmed = counted.filter((r) => r.outcome === "unconfirmed").length;
  const windowStart = now - settings.false_alarm_days * DAY_MS;
  const recentAlarms = alarms.filter((r) => Date.parse(r.at) >= windowStart);
  const N = settings.required_confirmed;
  const enough = confirmed.length >= N;
  const clean = recentAlarms.length === 0;
  const eligible = mode === "shadow" && enough && clean;
  const lastAlarmClears = lastAlarm != null ? lastAlarm + settings.false_alarm_days * DAY_MS : -Infinity;
  const eligibleSince = eligible ? new Date(Math.max(Date.parse(confirmed[N - 1].at), lastAlarmClears)).toISOString() : null;

  const base = {
    service: svc.name,
    mode,
    explicit: svc.override != null,
    eligible,
    required: N,
    confirmed: confirmed.length,
    false_alarms: recentAlarms.length,
    pending,
    unconfirmed,
    last_false_alarm: lastAlarm != null ? new Date(lastAlarm).toISOString() : null,
    evidence: confirmed.map((r) => r.id),
    eligible_since: eligibleSince,
    recommendations: mine.length,
  };

  if (mode === "auto") {
    return {
      ...base,
      status: "automatic",
      why: svc.override === "auto" ? "Rolls back automatically: graduated or switched on for this service." : "Rolls back automatically: follows the organization's rollback policy.",
    };
  }

  const tail = [pending ? `${pending} still in the window` : "", unconfirmed ? `${plural(unconfirmed, "recommendation")} waiting for a human verdict` : ""].filter(Boolean).join(", ");
  const tailText = tail ? ` (${tail})` : "";
  if (eligible) {
    return { ...base, status: "eligible", why: `${plural(confirmed.length, "confirmed recommendation")} and no false alarms in the last ${settings.false_alarm_days} days: ready for automatic rollback.` };
  }
  if (!clean) {
    const clears = Date.parse(recentAlarms[recentAlarms.length - 1].at) + settings.false_alarm_days * DAY_MS;
    return {
      ...base,
      status: "reset",
      why: `A false alarm on ${dateOf(Date.parse(recentAlarms[recentAlarms.length - 1].at))} reset the ramp: ${confirmed.length} of ${N} confirmed since${tailText}. Not eligible before ${dateOf(clears)}.`,
    };
  }
  const restarted = reset != null && reset >= (lastAlarm ?? -Infinity) ? ` since it went back to shadow on ${dateOf(reset)}` : lastAlarm != null ? " since the last false alarm" : "";
  if (mine.length === 0 || (counted.length === 0 && !restarted)) {
    return { ...base, status: "building", why: `No shadow recommendations yet. Needs ${plural(N, "confirmed recommendation")} with no false alarms in ${settings.false_alarm_days} days.` };
  }
  return { ...base, status: "building", why: `${confirmed.length} of ${N} confirmed${restarted}${tailText}. Needs ${plural(N - confirmed.length, "more confirmed recommendation")}.` };
}

/** "2/3 confirmed · 0 false alarms" */
export const rampProgress = (e: Pick<RampEvaluation, "confirmed" | "required" | "false_alarms">) =>
  `${Math.min(e.confirmed, e.required)}/${e.required} confirmed · ${plural(e.false_alarms, "false alarm")}`;

/** Audit evidence for a graduation or demotion: the rule, the thresholds and the counted releases. */
export function rampEvidence(e: RampEvaluation, settings: TrustRampSettings): Record<string, unknown> {
  return {
    rule: `${settings.required_confirmed} confirmed shadow recommendations and no false alarms in ${settings.false_alarm_days} days`,
    settings,
    confirmed: e.confirmed,
    false_alarms: e.false_alarms,
    last_false_alarm: e.last_false_alarm,
    evidence: e.evidence,
    why: e.why,
  };
}
