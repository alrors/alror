// Alert normalisers: turn Alertmanager, Datadog, Sentry and generic JSON webhooks
// into one shape. Pure functions (no I/O), unit-tested in tests/incidents.test.ts.
// The mapping is documented in docs/platform-contract.md ("Alert intake").

import { createHash } from "node:crypto";

export const ALERT_SOURCES = ["alertmanager", "datadog", "sentry", "generic"] as const;
export type AlertSource = (typeof ALERT_SOURCES)[number];
export const isAlertSource = (s: string): s is AlertSource => (ALERT_SOURCES as readonly string[]).includes(s);

export const SEVERITIES = ["critical", "error", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type NormalizedAlert = {
  source: AlertSource;
  /** "resolved" closes the open incident with the same fingerprint. */
  status: "firing" | "resolved";
  title: string;
  /** Empty when the payload names no service. */
  service: string;
  /** Normalised (prod -> production, stg -> staging); empty when unknown. */
  environment: string;
  severity: Severity;
  started_at: Date;
  /** Stable per alert and source; incidents are deduplicated on it. */
  fingerprint: string;
  raw: unknown;
};

/** Thrown for payloads that cannot be read as the named source. */
export class AlertPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertPayloadError";
  }
}

/** At most this many alerts are taken from one request (Alertmanager batches). */
export const MAX_ALERTS_PER_REQUEST = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const first = (...vals: unknown[]): string => {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const ENV_ALIASES: Record<string, string> = {
  prod: "production",
  prd: "production",
  live: "production",
  stage: "staging",
  stg: "staging",
  dev: "development",
};

/** Lowercases and maps common short names (prod, stg, dev) to Alror's environment names. */
export function normalizeEnvironment(v: string): string {
  const s = v.trim().toLowerCase();
  return ENV_ALIASES[s] ?? s;
}

/** Maps provider severities and priorities onto critical | error | warning | info. */
export function normalizeSeverity(v: string): Severity {
  const s = v.trim().toLowerCase();
  if (["critical", "crit", "page", "fatal", "emergency", "p1", "sev1", "sev-1", "1"].includes(s)) return "critical";
  if (["error", "err", "high", "major", "p2", "sev2", "sev-2", "2"].includes(s)) return "error";
  if (["info", "informational", "low", "minor", "debug", "none", "p4", "p5", "4", "5", "success"].includes(s)) return "info";
  return "warning"; // warning, warn, medium, p3, and anything unknown
}

/** Parses an RFC 3339 string, epoch seconds or epoch milliseconds; falls back to `now`. */
export function parseTime(v: unknown, now: Date): Date {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v < 1e12 ? v * 1000 : v);
  const s = str(v);
  if (!s) return now;
  if (/^\d{9,13}$/.test(s)) return parseTime(Number(s), now);
  const t = new Date(s);
  // Alertmanager uses 0001-01-01 for "unset"; ignore anything before 2000 or far in the future.
  if (Number.isNaN(t.getTime()) || t.getUTCFullYear() < 2000 || t.getTime() > now.getTime() + 86_400_000) return now;
  return t;
}

/** A provider fingerprint, or a stable hash of the parts when the provider sends none. */
function fingerprintOf(given: string, parts: unknown): string {
  if (given && given.length <= 200) return given;
  const basis = given || JSON.stringify(parts);
  return "h" + createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

const sortedLabels = (labels: Obj) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${str(labels[k])}`)
    .join(",");

/** `service:checkout,env:prod` or ["service:checkout", "env:prod"] -> { service: "checkout", env: "prod" }. */
export function parseTags(v: unknown): Record<string, string> {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const out: Record<string, string> = {};
  for (const item of list) {
    if (Array.isArray(item) && item.length === 2) {
      // Sentry: [["environment", "production"], ["service", "api"]]
      const k = str(item[0]).toLowerCase();
      if (k && !(k in out)) out[k] = str(item[1]);
      continue;
    }
    if (isObj(item) && "key" in item) {
      const k = str(item.key).toLowerCase();
      if (k && !(k in out)) out[k] = str(item.value);
      continue;
    }
    const s = str(item);
    const i = s.indexOf(":");
    if (i <= 0) continue;
    const k = s.slice(0, i).trim().toLowerCase();
    if (!(k in out)) out[k] = s.slice(i + 1).trim();
  }
  return out;
}

const SERVICE_KEYS = ["service", "service_name", "app", "application", "app_kubernetes_io_name", "app.kubernetes.io/name", "job", "deployment", "container"];
const ENV_KEYS = ["env", "environment", "stage", "deployment_environment", "deployment.environment"];

const pick = (bag: Record<string, unknown>, keys: string[]) => first(...keys.map((k) => bag[k]));

// ---------------------------------------------------------------------------
// Alertmanager (webhook_config, version 4)
// ---------------------------------------------------------------------------

function alertmanager(body: Obj, now: Date): NormalizedAlert[] {
  if (!Array.isArray(body.alerts)) throw new AlertPayloadError("Alertmanager payload needs an alerts array.");
  const common = isObj(body.commonLabels) ? body.commonLabels : {};
  const commonAnn = isObj(body.commonAnnotations) ? body.commonAnnotations : {};
  return body.alerts.filter(isObj).map((a) => {
    const labels: Obj = { ...common, ...(isObj(a.labels) ? a.labels : {}) };
    const ann: Obj = { ...commonAnn, ...(isObj(a.annotations) ? a.annotations : {}) };
    const status = first(a.status, body.status).toLowerCase() === "resolved" ? "resolved" : "firing";
    return {
      source: "alertmanager" as const,
      status,
      title: clip(first(ann.summary, ann.title, labels.alertname, ann.description) || "Alertmanager alert", 300),
      service: pick(labels, SERVICE_KEYS),
      environment: normalizeEnvironment(pick(labels, [...ENV_KEYS, "namespace"])),
      severity: normalizeSeverity(first(labels.severity, labels.priority)),
      started_at: parseTime(a.startsAt, now),
      fingerprint: fingerprintOf(str(a.fingerprint), sortedLabels(labels)),
      raw: a,
    };
  });
}

// ---------------------------------------------------------------------------
// Datadog (Webhooks integration; see the recommended payload in the docs)
// ---------------------------------------------------------------------------

function datadog(body: Obj, now: Date): NormalizedAlert[] {
  const tags = parseTags(body.tags);
  const transition = first(body.alert_transition, body.transition).toLowerCase();
  const alertType = first(body.alert_type).toLowerCase();
  const status = transition === "recovered" || transition === "resolved" || alertType === "success" ? "resolved" : "firing";
  const title = first(body.title, body.event_title, body.alert_title, body.event_msg) || "Datadog alert";
  if (!first(body.title, body.event_title, body.alert_title, body.id, body.alert_id, body.aggregate)) {
    throw new AlertPayloadError("Datadog payload needs at least a title, id, alert_id or aggregate.");
  }
  // Monitor id + scope identifies one alerting group; the aggregate key does too.
  const given = first(body.aggregate, body.aggreg_key, body.alert_id && `${str(body.alert_id)}:${first(body.alert_scope, body.scope)}`);
  const priority = first(body.priority, body.alert_priority);
  return [
    {
      source: "datadog",
      status,
      title: clip(title.replace(/^\[(Triggered|Recovered|Warn|Re-Triggered|No Data)[^\]]*\]\s*/i, ""), 300),
      service: first(body.service, tags.service, tags.app),
      environment: normalizeEnvironment(first(body.env, body.environment, tags.env, tags.environment)),
      severity: normalizeSeverity(alertType === "error" ? "critical" : alertType && alertType !== "success" ? alertType : priority || "warning"),
      started_at: parseTime(first(body.date, body.last_updated, body.timestamp) || body.date, now),
      fingerprint: fingerprintOf(given, [title, tags.service, tags.env]),
      raw: body,
    },
  ];
}

// ---------------------------------------------------------------------------
// Sentry (internal integration issue/event_alert webhooks, and the legacy webhook plugin)
// ---------------------------------------------------------------------------

function sentry(body: Obj, now: Date): NormalizedAlert[] {
  const data = isObj(body.data) ? body.data : {};
  const issue = isObj(data.issue) ? data.issue : isObj(data.group) ? data.group : {};
  const event = isObj(data.event) ? data.event : isObj(body.event) ? body.event : {};
  const project = isObj(issue.project) ? issue.project : isObj(event.project) ? event.project : {};
  const tags = parseTags(event.tags);
  const action = first(body.action).toLowerCase();

  const title = first(issue.title, event.title, body.message, body.culprit, event.message);
  const groupId = first(issue.id, event.issue_id, event.group_id, body.id);
  if (!title && !groupId) throw new AlertPayloadError("Sentry payload needs an issue or an event.");

  const status = action === "resolved" || first(issue.status).toLowerCase() === "resolved" ? "resolved" : "firing";
  return [
    {
      source: "sentry",
      status,
      title: clip(title || "Sentry issue", 300),
      service: first(tags.service, tags["service.name"], project.slug, body.project_slug, body.project),
      environment: normalizeEnvironment(first(event.environment, tags.environment, tags.env)),
      severity: normalizeSeverity(first(event.level, issue.level, body.level) || "error"),
      started_at: parseTime(first(event.datetime, event.timestamp, issue.lastSeen, issue.firstSeen) || event.timestamp, now),
      fingerprint: fingerprintOf(groupId, [title, project.slug]),
      raw: body,
    },
  ];
}

// ---------------------------------------------------------------------------
// Generic JSON: {title, service?, environment?, severity?, status?, started_at?, fingerprint?, labels?}
// One object or {alerts: [...]}.
// ---------------------------------------------------------------------------

function genericOne(a: Obj, now: Date): NormalizedAlert {
  const labels = isObj(a.labels) ? a.labels : isObj(a.tags) ? a.tags : {};
  const title = first(a.title, a.summary, a.name, a.message);
  if (!title) throw new AlertPayloadError("Generic alerts need a title.");
  const service = first(a.service, pick(labels, SERVICE_KEYS));
  const environment = normalizeEnvironment(first(a.environment, a.env, pick(labels, ENV_KEYS)));
  const status = ["resolved", "ok", "recovered", "closed"].includes(first(a.status, a.state).toLowerCase()) ? "resolved" : "firing";
  return {
    source: "generic",
    status,
    title: clip(title, 300),
    service,
    environment,
    severity: normalizeSeverity(first(a.severity, a.priority, a.level)),
    started_at: parseTime(first(a.started_at, a.startsAt, a.timestamp) || a.started_at, now),
    fingerprint: fingerprintOf(first(a.fingerprint, a.id, a.dedup_key), [title, service, environment]),
    raw: a,
  };
}

function generic(body: Obj, now: Date): NormalizedAlert[] {
  if (Array.isArray(body.alerts)) return body.alerts.filter(isObj).map((a) => genericOne(a, now));
  return [genericOne(body, now)];
}

/** Normalises one webhook body. Throws AlertPayloadError when the body does not fit the source. */
export function normalizeAlerts(source: AlertSource, body: unknown, now: Date = new Date()): NormalizedAlert[] {
  if (!isObj(body)) throw new AlertPayloadError("Alert payload must be a JSON object.");
  const out =
    source === "alertmanager" ? alertmanager(body, now) : source === "datadog" ? datadog(body, now) : source === "sentry" ? sentry(body, now) : generic(body, now);
  if (out.length === 0) throw new AlertPayloadError("The payload contains no alerts.");
  return out.slice(0, MAX_ALERTS_PER_REQUEST).map((a) => ({ ...a, service: clip(a.service, 120), environment: clip(a.environment, 64) }));
}
