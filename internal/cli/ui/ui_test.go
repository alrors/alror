package ui

import (
	"testing"

	"github.com/alrors/alror/internal/domain"
)

func TestReceiptHeadline(t *testing.T) {
	sim := func(d domain.Deployment) *domain.Deployment {
		d.Target, d.Telemetry = "simulated", "synthetic"
		return &d
	}
	prod := func(d domain.Deployment) *domain.Deployment {
		d.Target, d.Telemetry = "kubernetes", "prometheus"
		return &d
	}
	cases := []struct {
		d    *domain.Deployment
		want string
	}{
		{sim(domain.Deployment{Status: domain.StatusPromoted}), "PROMOTED · SIMULATED"},
		{sim(domain.Deployment{Status: domain.StatusRolledBack}), "ROLLED BACK · SIMULATED"},
		{sim(domain.Deployment{Status: domain.StatusFailed}), "FAILED · SIMULATED"},
		{sim(domain.Deployment{Status: domain.StatusFailed, Recovery: domain.RecoveryFailed}), "ROLLBACK FAILED · STATE UNKNOWN · SIMULATED"},
		{prod(domain.Deployment{Status: domain.StatusPromoted}), "PROMOTED"},
		{prod(domain.Deployment{Status: domain.StatusRolledBack}), "ROLLED BACK"},
		{prod(domain.Deployment{Status: domain.StatusFailed}), "FAILED"},
		{prod(domain.Deployment{Status: domain.StatusFailed, Recovery: domain.RecoveryFailed}), "ROLLBACK FAILED · STATE UNKNOWN"},
		{&domain.Deployment{Status: domain.StatusRolledBack, Target: "kubernetes", Telemetry: "synthetic"}, "ROLLED BACK · SIMULATED"},
	}
	for _, c := range cases {
		if got := ReceiptHeadline(c.d); got != c.want {
			t.Errorf("%s on %s/%s: %q, want %q", c.d.Status, c.d.Target, c.d.Telemetry, got, c.want)
		}
	}
}
