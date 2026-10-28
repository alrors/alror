// "What changed?": ranks an org's recent deployments as likely causes of an alert,
// and decides whether an automatic rollback is allowed. Pure functions (no I/O),
// unit-tested in tests/incidents.test.ts. Weights are documented in
// docs/platform-contract.md ("What changed? ranking").

export type CandidateStatus = "pending" | "rolling" | "promoted" | "rolled_back" | "failed";

/** One stored canary verdict metric (delta is relative: 0.3 = 30% worse than the baseline). */
export type MetricMovement = { metric: string; delta: number; pass: boolean };

export type CandidateInput = {
  id: string;
  service: string;
  image: string;
  environment: string;
  status: CandidateStatus;
  created_at: string;
  updated_at: string;
  risk_score: number;
  risk_level: string;
  /** Services the change touched (risk.services), for "related" matches. */
  related_services: string[];
  /** Metric results from the deployment's stored verdict events; empty when it has none. */
  verdicts: MetricMovement[];
};

export type AlertForRanking = { service: string; environment: string; started_at: Date };

export type SignalName = "service" | "recency" | "risk" | "state" | "metrics" | "environment";

export type Signal = { signal: SignalName; points: number; max: number; detail: string };

export type ServiceMatch = "exact" | "related" | "none" | "unknown";

export type RankedCandidate = {
  deployment_id: string;
  service: string;
  image: string;
  environment: string;
  status: CandidateStatus;
  created_at: string;
  /** Minutes between the deployment and the alert's start (0 when within the clock-skew allowance). */
  minutes_before: number;
  service_match: ServiceMatch;
  /** 0 to 100. */
  score: number;
  signals: Signal[];
};

/** Maximum points per signal; they add up to 100. Environment can only subtract. */
export const WEIGHTS = { service: 40, recency: 25, risk: 15, state: 10, metrics: 10 } as const;
export const ENV_MISMATCH_PENALTY = 25;
/** A deployment that finished rolling back before the alert started cannot be live. */
export const ROLLED_BACK_PENALTY = 30;
export const DEFAULT_WINDOW_MINUTES = 120;
/** Deployments up to this long after the alert's start still count (clock skew between systems). */
export const SKEW_MINUTES = 2;
/** "Just promoted": promoted this many minutes or less before the alert. */
export const JUST_PROMOTED_MINUTES = 15;
/** A relative metric regression at or above this scores the full metric points. */
export const FULL_REGRESSION = 0.25;
export const MAX_CANDIDATES = 10;

const MIN = 60_000;
const norm = (s: string) => s.trim().toLowerCase();

/** exact: same name; related: the change touched the service, or one name extends the other (checkout / checkout-worker). */
export function serviceMatch(alertService: string, dep: Pick<CandidateInput, "service" | "related_services">): ServiceMatch {
  const a = norm(alertService);
  if (!a) return "unknown";
  const d = norm(dep.service);
  if (a === d) return "exact";
  if (dep.related_services.some((s) => norm(s) === a)) return "related";
  const extends_ = (x: string, y: string) => x.length >= 3 && y.startsWith(x) && /[-_.]/.test(y.charAt(x.length));
  if (extends_(a, d) || extends_(d, a)) return "related";
  return "none";
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function fmtMinutes(m: number): string {
  if (m < 1) return "less than a minute";
  if (m < 90) return plural(Math.round(m), "minute");
  return `${round1(m / 60)} hours`;
}

/** Scores one deployment. Returns null when it falls outside the window (or started after the alert). */
export function scoreCandidate(alert: AlertForRanking, dep: CandidateInput, windowMinutes = DEFAULT_WINDOW_MINUTES): RankedCandidate | null {
  const start = alert.started_at.getTime();
  const created = Date.parse(dep.created_at);
  const updated = Date.parse(dep.updated_at);
  if (!Number.isFinite(created)) return null;
  const rawBefore = (start - created) / MIN;
  if (rawBefore < -SKEW_MINUTES) return null; // deployed after the alert started
  const stillRolling = dep.status === "rolling" || dep.status === "pending";
  if (rawBefore > windowMinutes && !stillRolling) return null;
  const before = Math.max(0, rawBefore);

  const signals: Signal[] = [];

  // Service match
  const match = serviceMatch(alert.service, dep);
  const svcPts = match === "exact" ? WEIGHTS.service : match === "related" ? WEIGHTS.service / 2 : 0;
  signals.push({
    signal: "service",
    points: svcPts,
    max: WEIGHTS.service,
    detail:
      match === "exact"
        ? `Same service as the alert (${dep.service})`
        : match === "related"
          ? `Related to ${alert.service}: ${dep.related_services.some((s) => norm(s) === norm(alert.service)) ? "the change touched it" : "similar service name"}`
          : match === "unknown"
            ? "The alert names no service"
            : `Different service (alert: ${alert.service})`,
  });

  // Recency: linear from full points at the alert's start to zero at the edge of the window.
  const recency = before > windowMinutes ? 0 : WEIGHTS.recency * (1 - before / windowMinutes);
  signals.push({
    signal: "recency",
    points: round1(recency),
    max: WEIGHTS.recency,
    detail:
      rawBefore < 0
        ? "Deployed at the same time as the alert started"
        : before > windowMinutes
          ? `Deployed ${fmtMinutes(before)} before the alert, but still rolling`
          : `Deployed ${fmtMinutes(before)} before the alert`,
  });

  // Risk score
  const risk = Math.max(0, Math.min(100, Number(dep.risk_score) || 0));
  signals.push({ signal: "risk", points: round1((WEIGHTS.risk * risk) / 100), max: WEIGHTS.risk, detail: `Risk ${risk}/100${dep.risk_level ? ` (${dep.risk_level})` : ""}` });

  // Outcome state
  let statePts = 0;
  let stateDetail: string;
  const sinceUpdate = (start - updated) / MIN;
  switch (dep.status) {
    case "rolling":
      statePts = WEIGHTS.state;
      stateDetail = "Still rolling out: traffic is shifting to it";
      break;
    case "pending":
      statePts = 3;
      stateDetail = "Pending: not serving much traffic yet";
      break;
    case "promoted":
      if (Number.isFinite(updated) && sinceUpdate >= -SKEW_MINUTES && sinceUpdate <= JUST_PROMOTED_MINUTES) {
        statePts = WEIGHTS.state;
        stateDetail = `Promoted to 100% ${fmtMinutes(Math.max(0, sinceUpdate))} before the alert`;
      } else {
        statePts = WEIGHTS.state / 2;
        stateDetail = "Promoted and serving all traffic";
      }
      break;
    case "rolled_back":
    case "failed":
      if (Number.isFinite(updated) && updated < start - SKEW_MINUTES * MIN) {
        statePts = -ROLLED_BACK_PENALTY;
        stateDetail = `Already ${dep.status === "failed" ? "failed" : "rolled back"} before the alert started`;
      } else {
        stateDetail = `Already ${dep.status === "failed" ? "failed" : "rolled back"}`;
      }
      break;
  }
  signals.push({ signal: "state", points: statePts, max: WEIGHTS.state, detail: stateDetail });

  // Observed metric movement from stored verdicts
  let metricPts = 0;
  let metricDetail = "No stored verdicts";
  if (dep.verdicts.length) {
    const failed = dep.verdicts.filter((v) => !v.pass);
    const worst = dep.verdicts.reduce((w, v) => (v.delta > w.delta ? v : w), dep.verdicts[0]);
    if (failed.length) {
      const f = failed.reduce((w, v) => (v.delta > w.delta ? v : w), failed[0]);
      metricPts = WEIGHTS.metrics;
      metricDetail = `Canary verdict failed on ${f.metric}${f.delta > 0 ? ` (+${Math.round(f.delta * 100)}%)` : ""}`;
    } else if (worst.delta > 0) {
      metricPts = round1(WEIGHTS.metrics * 0.6 * Math.min(1, worst.delta / FULL_REGRESSION));
      metricDetail = `Verdicts passed; ${worst.metric} moved +${Math.round(worst.delta * 100)}%`;
    } else {
      metricDetail = "Verdicts passed with no regression";
    }
  }
  signals.push({ signal: "metrics", points: metricPts, max: WEIGHTS.metrics, detail: metricDetail });

  // Environment
  const ae = norm(alert.environment);
  const de = norm(dep.environment);
  if (ae && de && ae !== de) {
    signals.push({ signal: "environment", points: -ENV_MISMATCH_PENALTY, max: 0, detail: `Deployed to ${dep.environment}, the alert is in ${alert.environment}` });
  } else {
    signals.push({ signal: "environment", points: 0, max: 0, detail: ae && de ? `Same environment (${dep.environment})` : "Environment not compared" });
  }

  const total = signals.reduce((s, x) => s + x.points, 0);
  return {
    deployment_id: dep.id,
    service: dep.service,
    image: dep.image,
    environment: dep.environment,
    status: dep.status,
    created_at: dep.created_at,
    minutes_before: round1(before),
    service_match: match,
    score: Math.max(0, Math.min(100, Math.round(total))),
    signals,
  };
}

/** Scores every deployment in the window and returns the best `limit`, highest score first (ties: most recent first). */
export function rankCandidates(
  alert: AlertForRanking,
  deployments: CandidateInput[],
  opts: { windowMinutes?: number; limit?: number } = {},
): RankedCandidate[] {
  const window = opts.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  return deployments
    .map((d) => scoreCandidate(alert, d, window))
    .filter((c): c is RankedCandidate => c !== null)
    .sort((a, b) => b.score - a.score || a.minutes_before - b.minutes_before || a.deployment_id.localeCompare(b.deployment_id))
    .slice(0, opts.limit ?? MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Automatic rollback
// ---------------------------------------------------------------------------

export type AutoRollbackSettings = {
  enabled: boolean;
  /** Minimum top-candidate score (default 80). */
  threshold: number;
  /** The top candidate must have been deployed at most this many minutes before the alert (default 30). */
  max_age_minutes: number;
};

/** The runner-up must score at least this many points less than the top candidate. */
export const AUTO_MARGIN = 15;

export type AutoCheck = { rule: string; pass: boolean; detail: string };
export type AutoDecision = { rollback: boolean; deployment_id: string | null; checks: AutoCheck[] };

/**
 * Whether to roll back the top candidate automatically. Every rule must pass:
 * the org enabled it, the alert is firing, the top score reaches the threshold,
 * it was deployed within max_age_minutes, its service matches exactly, it can
 * still be rolled back, and no other candidate is within AUTO_MARGIN points.
 */
export function decideAutoRollback(settings: AutoRollbackSettings, ranked: RankedCandidate[], firing = true): AutoDecision {
  const top = ranked[0];
  const second = ranked[1];
  const checks: AutoCheck[] = [
    { rule: "enabled", pass: settings.enabled, detail: settings.enabled ? "Automatic rollback is on for this org" : "Automatic rollback is off for this org" },
    { rule: "firing", pass: firing, detail: firing ? "The alert is firing" : "The alert is resolved" },
  ];
  if (!top) {
    checks.push({ rule: "candidate", pass: false, detail: "No deployment in the window" });
    return { rollback: false, deployment_id: null, checks };
  }
  checks.push(
    { rule: "confidence", pass: top.score >= settings.threshold, detail: `Top candidate scored ${top.score}; the threshold is ${settings.threshold}` },
    {
      rule: "recency",
      pass: top.minutes_before <= settings.max_age_minutes,
      detail: `Deployed ${fmtMinutes(top.minutes_before)} before the alert; the limit is ${plural(settings.max_age_minutes, "minute")}`,
    },
    { rule: "service", pass: top.service_match === "exact", detail: top.service_match === "exact" ? "Service matches exactly" : `Service match is ${top.service_match}, not exact` },
    {
      rule: "rollbackable",
      pass: top.status !== "rolled_back" && top.status !== "failed",
      detail: top.status === "rolled_back" || top.status === "failed" ? `Deployment is already ${top.status.replace("_", " ")}` : `Deployment is ${top.status}`,
    },
    {
      rule: "margin",
      pass: !second || top.score - second.score >= AUTO_MARGIN,
      detail: second ? `Runner-up scored ${second.score} (${top.score - second.score} points behind; ${AUTO_MARGIN} needed)` : "No other candidate",
    },
  );
  const rollback = checks.every((c) => c.pass);
  return { rollback, deployment_id: rollback ? top.deployment_id : null, checks };
}
