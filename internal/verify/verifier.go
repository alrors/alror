package verify

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/alrors/alror/internal/domain"
)

// MinSamples is the fewest observations per track the verifier will judge.
// With less data it refuses to pass the step (fail-safe).
const MinSamples = 8

// DefaultMaxRegression is the relative limit for a metric with no entry in
// Verifier.MaxRegression.
const DefaultMaxRegression = 0.20

// DefaultMaxIncrease holds the absolute limits used when a metric's baseline
// median is zero (or negative), where a relative change is undefined. Values
// are in the metric's own units: the documented error_rate query reports a
// percentage, so 0.01 means 0.01 percentage points. Metrics not listed here
// (and not configured) use 0: any significant increase over a zero baseline
// is a regression.
var DefaultMaxIncrease = map[string]float64{"error_rate": 0.01}

// Verifier compares canary and baseline samples for each metric.
// A metric fails only when the canary is both meaningfully worse and
// statistically worse (p-value below alpha). "Meaningfully worse" is a
// relative increase above MaxRegression when the baseline median is
// positive, and an absolute increase above MaxIncrease when it is not.
// Requiring both effect size and significance keeps false rollbacks rare.
//
// A step passes only when every metric was measured with enough finite
// samples and none regressed. Empty telemetry, a missing required metric,
// too few samples or non-finite observations never pass.
type Verifier struct {
	MaxRegression map[string]float64 // relative, e.g. {"error_rate": 0.25}
	MaxIncrease   map[string]float64 // absolute, for zero baselines, e.g. {"error_rate": 0.01}
	Alpha         float64
	// Required lists metrics that must be present in every judgement.
	Required []string
}

// Samples holds observations for one metric.
type Samples struct {
	Canary   []float64
	Baseline []float64
}

// Judge returns the verdict for one bake period.
func (v Verifier) Judge(data map[string]Samples) domain.Verdict {
	seen := map[string]bool{}
	metrics := make([]string, 0, len(data)+len(v.Required))
	for m := range data {
		seen[m] = true
		metrics = append(metrics, m)
	}
	for _, m := range v.Required {
		if !seen[m] {
			seen[m] = true
			metrics = append(metrics, m)
		}
	}
	sort.Strings(metrics)

	verdict := domain.Verdict{}
	if len(metrics) == 0 {
		verdict.Outcome = domain.OutcomeInsufficientData
		verdict.Summary = "Insufficient data: no metrics were returned, so the step cannot pass"
		return verdict
	}

	byOutcome := map[domain.Outcome][]string{}
	for _, m := range metrics {
		var r domain.MetricResult
		if s, ok := data[m]; ok {
			r = v.judgeMetric(m, s)
		} else {
			r = domain.MetricResult{Metric: m, PValue: 1, Status: domain.OutcomeInsufficientData,
				Reason: "required metric missing (no data returned)"}
		}
		verdict.Results = append(verdict.Results, r)
		byOutcome[r.Status] = append(byOutcome[r.Status], fmt.Sprintf("%s %s", m, r.Reason))
	}

	// A measured regression outranks bad data; bad data outranks missing data.
	switch {
	case len(byOutcome[domain.OutcomeRegression]) > 0:
		verdict.Outcome = domain.OutcomeRegression
		verdict.Summary = "Regression: " + strings.Join(byOutcome[domain.OutcomeRegression], "; ")
	case len(byOutcome[domain.OutcomeInvalidData]) > 0:
		verdict.Outcome = domain.OutcomeInvalidData
		verdict.Summary = "Invalid data: " + strings.Join(byOutcome[domain.OutcomeInvalidData], "; ")
	case len(byOutcome[domain.OutcomeInsufficientData]) > 0:
		verdict.Outcome = domain.OutcomeInsufficientData
		verdict.Summary = "Insufficient data: " + strings.Join(byOutcome[domain.OutcomeInsufficientData], "; ")
	default:
		verdict.Outcome, verdict.Pass = domain.OutcomePass, true
		verdict.Summary = fmt.Sprintf("No regression across %d metrics", len(metrics))
	}
	return verdict
}

func (v Verifier) judgeMetric(name string, s Samples) domain.MetricResult {
	r := domain.MetricResult{Metric: name, PValue: 1, CanarySamples: len(s.Canary), BaselineSamples: len(s.Baseline)}

	// Non-finite values would make medians and the test meaningless, and
	// encoding/json cannot serialise them. Report them and never pass.
	badC, badB := countNonFinite(s.Canary), countNonFinite(s.Baseline)
	r.Canary, r.Baseline = Median(finite(s.Canary)), Median(finite(s.Baseline))
	if badC+badB > 0 {
		r.Status = domain.OutcomeInvalidData
		r.Reason = fmt.Sprintf("non-finite observations (%d canary, %d baseline)", badC, badB)
		return r
	}
	if len(s.Canary) < MinSamples || len(s.Baseline) < MinSamples {
		r.Status = domain.OutcomeInsufficientData
		r.Reason = fmt.Sprintf("insufficient data (%d/%d samples, need %d)", len(s.Canary), len(s.Baseline), MinSamples)
		return r
	}

	r.AbsDelta = r.Canary - r.Baseline
	r.PValue = MannWhitneyGreater(s.Canary, s.Baseline)
	alpha := v.Alpha
	if alpha == 0 {
		alpha = 0.05
	}

	if r.Baseline > 0 {
		r.Delta = r.AbsDelta / r.Baseline
		limit, ok := v.MaxRegression[name]
		if !ok {
			limit = DefaultMaxRegression
		}
		if r.Delta > limit && r.PValue < alpha {
			r.Status = domain.OutcomeRegression
			r.Reason = fmt.Sprintf("up %.0f%% vs baseline (limit %.0f%%, p=%.3f)", r.Delta*100, limit*100, r.PValue)
			return r
		}
	} else {
		// Zero (or negative) baseline: a relative change is undefined, so
		// judge the absolute increase. Both zero gives AbsDelta 0: healthy.
		limit, ok := v.MaxIncrease[name]
		if !ok {
			limit = DefaultMaxIncrease[name]
		}
		if r.AbsDelta > limit && r.PValue < alpha {
			r.Status = domain.OutcomeRegression
			r.Reason = fmt.Sprintf("up %.4g vs a baseline of %.4g (absolute limit %.4g, p=%.3f)", r.AbsDelta, r.Baseline, limit, r.PValue)
			return r
		}
	}
	r.Status, r.Pass = domain.OutcomePass, true
	return r
}

func countNonFinite(xs []float64) int {
	n := 0
	for _, x := range xs {
		if math.IsNaN(x) || math.IsInf(x, 0) {
			n++
		}
	}
	return n
}

func finite(xs []float64) []float64 {
	out := make([]float64, 0, len(xs))
	for _, x := range xs {
		if !math.IsNaN(x) && !math.IsInf(x, 0) {
			out = append(out, x)
		}
	}
	return out
}
