// Package domain holds the types shared by every Alror component:
// the CLI, the Alror workspace (web platform), the runner and the docs.
package domain

import "time"

// Status is the lifecycle state of a deployment.
type Status string

const (
	StatusPending    Status = "pending"
	StatusRolling    Status = "rolling"
	StatusPromoted   Status = "promoted"
	StatusRolledBack Status = "rolled_back"
	StatusFailed     Status = "failed"
)

// Terminal reports whether no further transitions are possible.
func (s Status) Terminal() bool {
	return s == StatusPromoted || s == StatusRolledBack || s == StatusFailed
}

// Level buckets a risk score.
type Level string

const (
	LevelLow    Level = "low"
	LevelMedium Level = "medium"
	LevelHigh   Level = "high"
)

// Factor is one signal that contributed to a risk score.
type Factor struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	Points int    `json:"points"`
}

// RiskReport is the output of the risk scorer for one change.
type RiskReport struct {
	Score    int      `json:"score"` // 0..100
	Level    Level    `json:"level"`
	Factors  []Factor `json:"factors"`
	Services []string `json:"services"`
	AI       bool     `json:"ai_authored"`
}

// Step is one stage of a progressive rollout.
type Step struct {
	Weight int           `json:"weight"` // percent of traffic on the canary
	Bake   time.Duration `json:"bake"`   // how long to observe before deciding
}

// Plan is the rollout plan derived from a risk report.
type Plan struct {
	Strategy string `json:"strategy"` // canary | blue-green
	Steps    []Step `json:"steps"`
}

// Outcome classifies a verdict or one metric's result. Only OutcomePass lets
// a step pass. The other three stay distinct so a report never confuses
// "a regression was measured" with "nothing usable was measured".
type Outcome string

const (
	// OutcomePass means the data was sufficient and showed no regression.
	OutcomePass Outcome = "pass"
	// OutcomeRegression means the canary was measured to be worse.
	OutcomeRegression Outcome = "regression"
	// OutcomeInsufficientData means a metric was missing or had too few samples.
	OutcomeInsufficientData Outcome = "insufficient_data"
	// OutcomeInvalidData means observations were unusable (NaN or ±Inf).
	OutcomeInvalidData Outcome = "invalid_data"
)

// Evidence sources for a verdict.
const (
	// EvidenceSynthetic marks a verdict computed from generated samples.
	// It is never production verification.
	EvidenceSynthetic = "synthetic"
	// EvidenceMeasured marks a verdict computed from a real metrics provider.
	EvidenceMeasured = "measured"
)

// MetricResult is the verdict for one metric at one step.
type MetricResult struct {
	Metric   string  `json:"metric"`
	Canary   float64 `json:"canary"`
	Baseline float64 `json:"baseline"`
	Delta    float64 `json:"delta"` // relative change, canary vs baseline (0 when the baseline is not positive)
	PValue   float64 `json:"p_value"`
	Pass     bool    `json:"pass"`
	Reason   string  `json:"reason,omitempty"`
	// Status is the detailed outcome; Pass is true only for OutcomePass.
	Status Outcome `json:"status,omitempty"`
	// AbsDelta is canary median minus baseline median in the metric's own
	// units. A zero baseline is judged on it instead of Delta.
	AbsDelta        float64 `json:"abs_delta"`
	CanarySamples   int     `json:"canary_samples"`
	BaselineSamples int     `json:"baseline_samples"`
}

// Verdict is the decision taken after a bake period.
type Verdict struct {
	Pass    bool           `json:"pass"`
	Results []MetricResult `json:"results"`
	Summary string         `json:"summary"`
	// Outcome is pass, regression, insufficient_data or invalid_data.
	Outcome Outcome `json:"outcome,omitempty"`
	// Evidence is "synthetic" or "measured"; empty in older records.
	Evidence string `json:"evidence,omitempty"`
}

// Deployment is the persisted record of one release.
type Deployment struct {
	ID        string     `json:"id"`
	Service   string     `json:"service"`
	Image     string     `json:"image"`
	Ref       string     `json:"ref,omitempty"` // PR number or commit
	Risk      RiskReport `json:"risk"`
	Plan      Plan       `json:"plan"`
	Status    Status     `json:"status"`
	StepIndex int        `json:"step_index"`
	Weight    int        `json:"weight"`
	Reason    string     `json:"reason,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	// Environment is the target environment (e.g. production). Set in
	// connected mode; empty in local mode.
	Environment string `json:"environment,omitempty"`
	// Source records where the deployment started: cli, ci, console or
	// runner. Set in connected mode; empty in local mode.
	Source string `json:"source,omitempty"`
	// Target is the deployment target (simulated, kubernetes) and Telemetry
	// the metrics provider (synthetic, prometheus, datadog) the engine used.
	// Together they say how much the outcome proves; see `alror capabilities`.
	Target    string `json:"target,omitempty"`
	Telemetry string `json:"telemetry,omitempty"`
	// Recovery records the result of the last rollback attempt: one of the
	// Recovery* constants, or empty when no rollback was attempted.
	Recovery string `json:"recovery,omitempty"`
}

// Recovery states. Only a simulated target can say traffic is back on
// stable; a real driver can only say its rollback command succeeded.
const (
	// RecoverySimulated: the simulated target recorded traffic back on stable.
	RecoverySimulated = "rollback_simulated"
	// RecoveryRequested: the driver accepted the rollback command. The
	// resulting traffic split was not observed.
	RecoveryRequested = "rollback_requested"
	// RecoveryFailed: the rollback command returned an error. Traffic may
	// still be on the canary; the state is unknown and needs an operator.
	RecoveryFailed = "rollback_failed"
)

// EventKind classifies a deployment event.
type EventKind string

const (
	EventCreated    EventKind = "created"
	EventStep       EventKind = "step"
	EventVerdict    EventKind = "verdict"
	EventPromoted   EventKind = "promoted"
	EventRolledBack EventKind = "rolled_back"
	EventError      EventKind = "error"
)

// Event is one append-only entry in a deployment's history.
type Event struct {
	At      time.Time `json:"at"`
	Kind    EventKind `json:"kind"`
	Message string    `json:"message"`
	Weight  int       `json:"weight,omitempty"` // requested canary weight
	Verdict *Verdict  `json:"verdict,omitempty"`
	// Routing says what Weight means: "simulated" (in-memory only),
	// "requested" (the driver accepted the command; the applied split was
	// not observed) or "observed" (read back from the target). Empty on
	// events that do not change traffic.
	Routing string `json:"routing,omitempty"`
}

// Routing evidence levels for Event.Routing.
const (
	RoutingSimulated = "simulated"
	RoutingRequested = "requested"
	RoutingObserved  = "observed"
)
