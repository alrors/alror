package cli

import (
	"strings"
	"testing"
	"time"

	"github.com/alrors/alror/internal/api"
	"github.com/alrors/alror/internal/api/apitest"
	"github.com/alrors/alror/internal/domain"
)

func lastDeployment(f *apitest.Fake) *domain.Deployment {
	reqs := f.Requests()
	for i := len(reqs) - 1; i >= 0; i-- {
		if r := reqs[i]; r.Method == "PUT" && strings.HasPrefix(r.Path, "/api/v1/deployments/") {
			return f.Deployment(strings.TrimPrefix(r.Path, "/api/v1/deployments/"))
		}
	}
	return nil
}

func TestDeployPrefersStoredDecision(t *testing.T) {
	isolate(t)
	f, srv := apitest.Start()
	defer srv.Close()
	t.Setenv("ALROR_SERVER", srv.URL)
	t.Setenv("ALROR_API_KEY", apitest.DefaultKey)
	repo := t.TempDir()

	merge := strings.Repeat("cd", 20)
	plan := domain.Plan{Strategy: "canary", Steps: []domain.Step{{Weight: 10, Bake: 10 * time.Second}, {Weight: 40, Bake: 10 * time.Second}, {Weight: 100}}}
	f.PutDecision(api.Decision{HeadSHA: strings.Repeat("ab", 20), MergeSHA: merge, Repository: "acme/shop", PullNumber: 42, RulesVersion: 1, Outcome: "merged",
		Risk: domain.RiskReport{Score: 77, Level: domain.LevelHigh, Factors: []domain.Factor{{Name: "Sensitive paths", Detail: "changes in payment", Points: 10}}}, Plan: plan})

	// The merge commit finds the PR's decision; its score and plan drive the rollout.
	mustRun(t, 0, "-C", repo, "--no-anim", "deploy", "-s", "checkout-api", "-i", "app:2", "--ref", merge, "--fast")
	d := lastDeployment(f)
	if d == nil || d.Risk.Score != 77 || d.Risk.Level != domain.LevelHigh || len(d.Plan.Steps) != 3 || d.Plan.Steps[0].Weight != 10 {
		t.Fatalf("deployment did not use the stored decision: %+v", d)
	}

	// No stored decision (and no git repository here): falls back to its own score.
	mustRun(t, 0, "-C", repo, "--no-anim", "deploy", "-s", "checkout-api", "-i", "app:3", "--ref", "0123456789abcdef", "--fast")
	d = lastDeployment(f)
	if d == nil || d.Risk.Score != 50 || d.Risk.Level != domain.LevelMedium || d.Plan.Steps[0].Weight != 5 {
		t.Fatalf("fallback deployment = %+v", d)
	}
	looked := 0
	for _, r := range f.Requests() {
		if strings.HasPrefix(r.Path, "/api/v1/decisions/") {
			looked++
		}
	}
	if looked != 2 {
		t.Fatalf("decision lookups = %d, want 2", looked)
	}

	// --risk skips the lookup entirely.
	mustRun(t, 0, "-C", repo, "--no-anim", "deploy", "-s", "checkout-api", "-i", "app:4", "--ref", merge, "--risk", "5", "--fast")
	if d = lastDeployment(f); d == nil || d.Risk.Score != 5 {
		t.Fatalf("override deployment = %+v", d)
	}
}

func TestPortalDecisionSource(t *testing.T) {
	_, _, src, ok := portalDecision(nil, "")
	if ok || src.Source != "local" || !strings.Contains(src.describe(), "scored locally") {
		t.Fatalf("no client: %+v", src)
	}
	if validPlan(domain.Plan{Steps: []domain.Step{{Weight: 50}}}) {
		t.Fatal("a plan must end at 100%")
	}
	s := riskSource{Source: "portal", Commit: strings.Repeat("a", 40), Repository: "acme/shop", PullNumber: 7, RulesVersion: 1}
	if got := s.describe(); got != "risk: portal decision for aaaaaaaaaaaa (acme/shop#7, shared rules v1)" {
		t.Fatalf("describe = %q", got)
	}
	if deployCommit("ABCDEF1", t.TempDir()) != "abcdef1" {
		t.Fatal("a SHA --ref is the commit to look up")
	}
}
