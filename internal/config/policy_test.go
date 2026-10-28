package config

import (
	"encoding/json"
	"math"
	"reflect"
	"testing"
)

func TestPolicyForWithoutOverrideIsTheOrgPolicy(t *testing.T) {
	c := Default("p")
	c.Policy.BakeScale = 1
	for _, s := range []string{"checkout-api", "web-frontend", "unknown"} {
		if got := c.PolicyFor(s); !reflect.DeepEqual(got, c.Policy) {
			t.Fatalf("%s: got %+v, want the org policy %+v", s, got, c.Policy)
		}
	}
}

func TestPolicyForMergesTheServiceOverride(t *testing.T) {
	c := Default("p")
	c.Policy.BakeScale = 0.5
	c.Policy.MaxIncrease = map[string]float64{"error_rate": 0.01}
	c.Services[0].Policy = &ServicePolicy{
		MaxRegression: map[string]float64{"latency_p95": 0.08, "bad": math.NaN()},
		MaxIncrease:   map[string]float64{"error_rate": 0.004},
		BakeScale:     0.75,
	}
	got := c.PolicyFor("checkout-api")
	if want := map[string]float64{"error_rate": 0.25, "latency_p95": 0.08}; !reflect.DeepEqual(got.MaxRegression, want) {
		t.Fatalf("max_regression = %v, want %v (only listed metrics change; NaN is ignored)", got.MaxRegression, want)
	}
	if got.MaxIncrease["error_rate"] != 0.004 {
		t.Fatalf("max_increase = %v", got.MaxIncrease)
	}
	if got.BakeScale != 0.375 {
		t.Fatalf("bake scale = %v, want org 0.5 x service 0.75", got.BakeScale)
	}
	// The org policy itself is not modified.
	if c.Policy.MaxRegression["latency_p95"] != 0.15 || c.Policy.MaxIncrease["error_rate"] != 0.01 {
		t.Fatalf("org policy changed: %+v", c.Policy)
	}
	other := c.PolicyFor("web-frontend")
	if !reflect.DeepEqual(other, c.Policy) {
		t.Fatalf("a service without an override must get the org policy")
	}
	c.UseServicePolicy("checkout-api")
	if c.Policy.MaxRegression["latency_p95"] != 0.08 || c.Bake(1000) != 375 {
		t.Fatalf("UseServicePolicy did not apply: %+v", c.Policy)
	}
}

func TestRiskWeight(t *testing.T) {
	var none *Risk
	if none.Weight("no_tests") != 1 {
		t.Fatal("nil risk must weigh 1")
	}
	r := &Risk{Weights: map[string]float64{"no_tests": 1.5, "huge": 99, "neg": -1, "nan": math.NaN()}}
	for key, want := range map[string]float64{"no_tests": 1.5, "huge": MaxRiskWeight, "neg": 0, "nan": 1, "missing": 1} {
		if got := r.Weight(key); got != want {
			t.Errorf("Weight(%q) = %v, want %v", key, got, want)
		}
	}
}

func TestPortalConfigJSONWithOverrides(t *testing.T) {
	raw := `{"project":"acme","services":[{"name":"api","paths":["api/"],"target":"simulated","cluster":"","namespace":"","critical":false,
		"policy":{"max_regression":{"error_rate":0.18},"bake_scale":0.5}}],
		"metrics":{"provider":"synthetic"},"policy":{"max_regression":{"error_rate":0.25},"alpha":0.05,"auto_rollback":true},
		"risk":{"weights":{"ai_authored":0.5}},"notify":{}}`
	var c Config
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatal(err)
	}
	c.ApplyDefaults()
	if p := c.PolicyFor("api"); p.MaxRegression["error_rate"] != 0.18 || p.BakeScale != 0.5 {
		t.Fatalf("service override not honoured: %+v", p)
	}
	if c.Risk.Weight("ai_authored") != 0.5 {
		t.Fatalf("risk weights not decoded: %+v", c.Risk)
	}
	// Without overrides the JSON has neither field, exactly as before.
	out, _ := json.Marshal(Default("p"))
	var m map[string]any
	_ = json.Unmarshal(out, &m)
	if _, ok := m["risk"]; ok {
		t.Fatalf("risk must be omitted when unset: %s", out)
	}
	if _, ok := m["services"].([]any)[0].(map[string]any)["policy"]; ok {
		t.Fatalf("service policy must be omitted when unset: %s", out)
	}
}

func TestValidateRejectsBadServicePolicy(t *testing.T) {
	c := Default("p")
	c.Services[0].Policy = &ServicePolicy{MaxRegression: map[string]float64{"error_rate": -0.1}}
	if err := c.Validate(); err == nil {
		t.Fatal("a negative per-service threshold must be rejected")
	}
	c.Services[0].Policy = &ServicePolicy{MaxRegression: map[string]float64{"error_rate": 0.1}, BakeScale: 0.5}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}
