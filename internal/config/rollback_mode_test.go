package config

import (
	"encoding/json"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestAutoRollbackForServiceOverride(t *testing.T) {
	for _, tc := range []struct {
		policy bool
		mode   string
		want   bool
	}{
		{true, "", true},
		{false, "", false},
		{true, RollbackShadow, false},
		{false, RollbackAuto, true},
		{true, RollbackAuto, true},
		{false, RollbackShadow, false},
	} {
		c := &Config{Policy: Policy{AutoRollback: tc.policy}}
		if got := c.AutoRollbackFor(Service{Name: "api", RollbackMode: tc.mode}); got != tc.want {
			t.Errorf("policy=%t mode=%q: got %t, want %t", tc.policy, tc.mode, got, tc.want)
		}
	}
}

func TestRollbackModeValidation(t *testing.T) {
	c := &Config{Services: []Service{{Name: "api", RollbackMode: "sometimes"}}}
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "rollback_mode") {
		t.Fatalf("want rollback_mode error, got %v", err)
	}
	c.Services[0].RollbackMode = RollbackShadow
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
}

// GET /api/v1/config carries the per-service override as services[].rollback_mode
// and omits it when the service follows policy.auto_rollback.
func TestRollbackModeFromServerJSON(t *testing.T) {
	raw := `{"project":"acme","services":[{"name":"api","paths":[],"target":"simulated","cluster":"","namespace":"","critical":false,"rollback_mode":"auto"},
	{"name":"web","paths":[],"target":"simulated","cluster":"","namespace":"","critical":false}],
	"metrics":{"provider":"synthetic"},"policy":{"max_regression":{},"alpha":0.05,"auto_rollback":false},"notify":{}}`
	var c Config
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		t.Fatal(err)
	}
	api, _ := c.Service("api")
	web, _ := c.Service("web")
	if !c.AutoRollbackFor(api) || c.AutoRollbackFor(web) {
		t.Fatalf("api should be auto (override), web shadow (policy): %+v", c.Services)
	}
	out, _ := yaml.Marshal(web)
	if strings.Contains(string(out), "rollback_mode") {
		t.Fatalf("empty rollback_mode should be omitted from alror.yaml:\n%s", out)
	}
}
