package verify

import (
	"encoding/json"
	"math"
	"math/rand"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/domain"
)

func noisy(rng *rand.Rand, n int, mean, jitter float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = mean + rng.NormFloat64()*jitter
	}
	return out
}

func TestMannWhitneyDetectsShift(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	worse := noisy(rng, 30, 0.40, 0.03)
	base := noisy(rng, 30, 0.22, 0.03)
	if p := MannWhitneyGreater(worse, base); p > 0.001 {
		t.Fatalf("clear regression should be significant, p=%f", p)
	}
	if p := MannWhitneyGreater(base, worse); p < 0.99 {
		t.Fatalf("improvement must not look like a regression, p=%f", p)
	}
}

func TestMannWhitneyIdenticalIsInconclusive(t *testing.T) {
	same := []float64{1, 1, 1, 1, 1, 1, 1, 1}
	if p := MannWhitneyGreater(same, same); p != 1 {
		t.Fatalf("identical samples should give p=1, got %f", p)
	}
}

func TestJudgeNeedsBothEffectAndSignificance(t *testing.T) {
	rng := rand.New(rand.NewSource(2))
	v := Verifier{MaxRegression: map[string]float64{"error_rate": 0.25}, Alpha: 0.05}

	// Significant but tiny drift (+5%): passes.
	tiny := v.Judge(map[string]Samples{"error_rate": {Canary: noisy(rng, 200, 0.231, 0.005), Baseline: noisy(rng, 200, 0.22, 0.005)}})
	if !tiny.Pass {
		t.Fatalf("a small significant drift should pass: %s", tiny.Summary)
	}

	// Large and significant (+70%): fails.
	big := v.Judge(map[string]Samples{"error_rate": {Canary: noisy(rng, 30, 0.37, 0.03), Baseline: noisy(rng, 30, 0.22, 0.03)}})
	if big.Pass {
		t.Fatal("a large significant regression must fail")
	}
}

func TestJudgeFailsSafeOnTooLittleData(t *testing.T) {
	v := Verifier{Alpha: 0.05}
	r := v.Judge(map[string]Samples{"latency_p95": {Canary: []float64{1, 2}, Baseline: []float64{1, 2}}})
	if r.Pass {
		t.Fatal("too little data must never pass a step")
	}
}

func repeat(v float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

func TestZeroBaselineWithPositiveErrorsIsARegression(t *testing.T) {
	rng := rand.New(rand.NewSource(3))
	v := Verifier{MaxRegression: map[string]float64{"error_rate": 0.25}, Alpha: 0.05}
	r := v.Judge(map[string]Samples{"error_rate": {Canary: noisy(rng, 20, 2.0, 0.1), Baseline: repeat(0, 20)}})
	if r.Pass || r.Outcome != domain.OutcomeRegression {
		t.Fatalf("errors over a zero baseline must fail as a regression: %+v", r)
	}
	m := r.Results[0]
	if m.Status != domain.OutcomeRegression || m.AbsDelta < 1.5 || m.Delta != 0 {
		t.Fatalf("zero-baseline result = %+v", m)
	}
	if !strings.HasPrefix(r.Summary, "Regression: ") {
		t.Fatalf("summary = %q", r.Summary)
	}
}

func TestZeroBaselineBelowAbsoluteThresholdPasses(t *testing.T) {
	v := Verifier{MaxIncrease: map[string]float64{"error_rate": 0.5}, Alpha: 0.05}
	r := v.Judge(map[string]Samples{"error_rate": {Canary: repeat(0.2, 20), Baseline: repeat(0, 20)}})
	if !r.Pass {
		t.Fatalf("an increase below the absolute limit should pass: %s", r.Summary)
	}
	// The default error_rate limit is small: the same data fails without configuration.
	if d := (Verifier{Alpha: 0.05}).Judge(map[string]Samples{"error_rate": {Canary: repeat(0.2, 20), Baseline: repeat(0, 20)}}); d.Pass {
		t.Fatal("0.2 over a zero baseline must exceed the default error_rate limit")
	}
}

func TestBothZeroIsHealthy(t *testing.T) {
	v := Verifier{Alpha: 0.05}
	r := v.Judge(map[string]Samples{"error_rate": {Canary: repeat(0, 12), Baseline: repeat(0, 12)}})
	if !r.Pass || r.Outcome != domain.OutcomePass || r.Results[0].Status != domain.OutcomePass {
		t.Fatalf("zero errors on both sides is healthy: %+v", r)
	}
}

func TestPositiveBaselineBehaviourIsUnchanged(t *testing.T) {
	rng := rand.New(rand.NewSource(4))
	v := Verifier{MaxRegression: map[string]float64{"latency_p95": 0.15}, Alpha: 0.05}
	healthy := v.Judge(map[string]Samples{"latency_p95": {Canary: noisy(rng, 30, 182, 9), Baseline: noisy(rng, 30, 186, 9)}})
	if !healthy.Pass || healthy.Outcome != domain.OutcomePass {
		t.Fatalf("healthy canary should pass: %s", healthy.Summary)
	}
	bad := v.Judge(map[string]Samples{"latency_p95": {Canary: noisy(rng, 30, 260, 9), Baseline: noisy(rng, 30, 186, 9)}})
	m := bad.Results[0]
	if bad.Pass || bad.Outcome != domain.OutcomeRegression || m.Delta < 0.3 || m.AbsDelta < 50 {
		t.Fatalf("40%% slower canary must fail with a relative delta: %+v", bad)
	}
}

func TestEmptyDataNeverPasses(t *testing.T) {
	for name, data := range map[string]map[string]Samples{"nil": nil, "empty": {}} {
		r := Verifier{}.Judge(data)
		if r.Pass || r.Outcome != domain.OutcomeInsufficientData {
			t.Fatalf("%s telemetry must not pass: %+v", name, r)
		}
	}
	r := Verifier{}.Judge(map[string]Samples{"error_rate": {}})
	if r.Pass || r.Results[0].Status != domain.OutcomeInsufficientData {
		t.Fatalf("a metric with no samples must not pass: %+v", r)
	}
}

func TestMissingRequiredMetricFails(t *testing.T) {
	v := Verifier{Alpha: 0.05, Required: []string{"error_rate", "latency_p95"}}
	r := v.Judge(map[string]Samples{"error_rate": {Canary: repeat(0, 12), Baseline: repeat(0, 12)}})
	if r.Pass || r.Outcome != domain.OutcomeInsufficientData || len(r.Results) != 2 {
		t.Fatalf("missing latency_p95 must block the step: %+v", r)
	}
	if r.Results[1].Metric != "latency_p95" || r.Results[1].Status != domain.OutcomeInsufficientData {
		t.Fatalf("missing metric result = %+v", r.Results[1])
	}
	if !strings.HasPrefix(r.Summary, "Insufficient data: ") {
		t.Fatalf("summary should not look like a regression: %q", r.Summary)
	}
}

func TestInsufficientSamplesIsNotARegression(t *testing.T) {
	r := Verifier{}.Judge(map[string]Samples{"error_rate": {Canary: repeat(5, 3), Baseline: repeat(0, 30)}})
	if r.Pass || r.Outcome != domain.OutcomeInsufficientData || r.Results[0].Status != domain.OutcomeInsufficientData {
		t.Fatalf("3 samples must be insufficient, not a measured regression: %+v", r)
	}
}

func TestRegressionOutranksMissingData(t *testing.T) {
	v := Verifier{Alpha: 0.05, Required: []string{"latency_p95"}}
	r := v.Judge(map[string]Samples{"error_rate": {Canary: repeat(3, 12), Baseline: repeat(0, 12)}})
	if r.Outcome != domain.OutcomeRegression || r.Pass {
		t.Fatalf("a measured regression must be reported as such: %+v", r)
	}
}

func TestNonFiniteObservationsAreInvalid(t *testing.T) {
	for name, bad := range map[string]float64{"NaN": math.NaN(), "+Inf": math.Inf(1), "-Inf": math.Inf(-1)} {
		canary := append(repeat(0.2, 11), bad)
		r := Verifier{}.Judge(map[string]Samples{"error_rate": {Canary: canary, Baseline: repeat(0.2, 12)}})
		if r.Pass || r.Outcome != domain.OutcomeInvalidData || r.Results[0].Status != domain.OutcomeInvalidData {
			t.Fatalf("%s: non-finite data must be invalid: %+v", name, r)
		}
		if _, err := json.Marshal(r); err != nil {
			t.Fatalf("%s: verdict must serialise: %v", name, err)
		}
	}
}

func TestMedian(t *testing.T) {
	if m := Median([]float64{3, 1, 2}); m != 2 {
		t.Fatalf("odd median = %f", m)
	}
	if m := Median([]float64{4, 1, 2, 3}); m != 2.5 {
		t.Fatalf("even median = %f", m)
	}
}
