package github

import (
	"strings"
	"testing"
	"time"

	"github.com/alrors/alror/internal/domain"
)

func TestRiskReportExplainsGateAndStageTimes(t *testing.T) {
	plan := domain.Plan{Strategy: "canary", Steps: []domain.Step{{Weight: 5, Bake: time.Minute}, {Weight: 50, Bake: 3 * time.Minute}, {Weight: 100}}}
	for _, tc := range []struct {
		limit int
		want  string
	}{{0, "Advisory report"}, {62, "Within the risk limit"}, {61, "Risk gate failed"}} {
		md := RiskMarkdown(report(), plan, 9, "https://github.test/acme/shop/actions/runs/42", RiskOptions{SHA: "abc123", BaseRef: "origin/main", FailAbove: tc.limit})
		for _, want := range []string{tc.want, "abc123", "origin/main", "| Files changed | 9 |", "| 1 | 5% | 1m0s |", "| 2 | 50% | 3m0s |", "Promote to all traffic", "View workflow run and logs", "### Next step"} {
			if !strings.Contains(md, want) {
				t.Errorf("limit %d: missing %q", tc.limit, want)
			}
		}
	}
}

func TestReceiptPreservesEarlierFailedShadowVerdict(t *testing.T) {
	fail := &domain.Verdict{Pass: false, Summary: "Regression", Results: []domain.MetricResult{{Metric: "latency", Canary: 150, Baseline: 100, Delta: .5, PValue: .000012, Reason: "over threshold"}}}
	pass := &domain.Verdict{Pass: true, Summary: "Recovered"}
	d := &domain.Deployment{Service: "checkout", Status: domain.StatusPromoted, Weight: 100, Plan: domain.Plan{Steps: []domain.Step{{Weight: 5, Bake: time.Minute}, {Weight: 50, Bake: 3 * time.Minute}, {Weight: 100}}}}
	md := ReceiptMarkdown(d, pass, 5*time.Second, ReceiptOptions{Shadow: true, BakeScale: .01, Events: []domain.Event{{Weight: 5, Verdict: fail}, {Weight: 50, Verdict: pass}}})
	for _, want := range []string{"Promoted with failed verification", "Shadow mode", "1 stage verdicts passed · 1 failed", "Stage at 5%", "Stage at 50%", "+50.0%", "1.2e-05", "over threshold", "600ms", "1.8s", "</details>"} {
		if !strings.Contains(md, want) {
			t.Errorf("missing %q in receipt:\n%s", want, md)
		}
	}
	if strings.Contains(md, "Verified") {
		t.Fatal("shadow failures must not be described as verified")
	}
}

func TestReceiptOutcomeAndMissingEvidence(t *testing.T) {
	for _, tc := range []struct {
		status domain.Status
		want   string
	}{
		{domain.StatusPromoted, "No metric verdict was recorded"},
		{domain.StatusRolledBack, "rollback operation completed"},
		{domain.StatusFailed, "confirm the current traffic state"},
	} {
		md := ReceiptMarkdown(&domain.Deployment{Service: "api", Status: tc.status, Weight: 25, Reason: "driver timeout"}, nil, time.Second)
		if !strings.Contains(md, tc.want) || !strings.Contains(md, "driver timeout") {
			t.Fatalf("incorrect %s report: %s", tc.status, md)
		}
		if tc.status == domain.StatusFailed && strings.Contains(md, "rollback operation completed") {
			t.Fatal("failed rollback must not claim success")
		}
	}
}

func TestReportEscapesUntrustedFields(t *testing.T) {
	bad := "<details>\n@team | `image` [link](javascript:alert)"
	d := &domain.Deployment{Service: bad, Image: bad, Ref: bad, Reason: bad, Status: domain.StatusFailed}
	md := ReceiptMarkdown(d, nil, 0, ReceiptOptions{RunURL: "javascript:alert(1)"})
	for _, forbidden := range []string{"<details>", "@team", "[link](", "[View workflow"} {
		if strings.Contains(md, forbidden) {
			t.Errorf("unescaped %q", forbidden)
		}
	}
	if !strings.Contains(md, `\|`) || !strings.Contains(md, "&lt;details&gt;") {
		t.Fatal("expected escaped table content")
	}
}

func TestDeploymentCommentsHaveSeparateIdentity(t *testing.T) {
	a := DeploymentMarker("api", "staging")
	if a == CommentMarker || a == DeploymentMarker("api", "production") || a == DeploymentMarker("web", "staging") || a != DeploymentMarker("api", "staging") {
		t.Fatal("deployment comments must be stable and scoped to service/environment")
	}
}

func TestLargeReportsRemainWithinGitHubSummaryLimit(t *testing.T) {
	text := strings.Repeat("@", 300)
	r := report()
	for i := 0; i < 100; i++ {
		r.Factors = append(r.Factors, domain.Factor{Name: text, Detail: text})
	}
	md := RiskMarkdown(r, domain.Plan{}, 100, "")
	if len(md) > 65535 || !strings.Contains(md, "Additional factors") {
		t.Fatalf("risk report size: %d", len(md))
	}
	v := &domain.Verdict{Summary: text}
	for i := 0; i < 100; i++ {
		v.Results = append(v.Results, domain.MetricResult{Metric: text, Reason: text})
	}
	events := make([]domain.Event, 100)
	for i := range events {
		events[i].Verdict = v
	}
	md = ReceiptMarkdown(&domain.Deployment{Status: domain.StatusFailed}, v, 0, ReceiptOptions{Events: events})
	if len(md) > 65535 || !strings.Contains(md, "Additional stage results") {
		t.Fatalf("receipt size: %d", len(md))
	}
}
