// Package rollout turns a risk report into a plan and executes it.
package rollout

import (
	"time"

	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/risk"
)

// PlanFor returns the rollout plan for a risk report, from the shared rules
// file (internal/risk/rules.json). Riskier changes get smaller first steps,
// more steps and longer bakes. The final step is always 100%, which means "promote".
func PlanFor(r domain.RiskReport) domain.Plan { return risk.PlanFor(r) }

// TotalBake is the sum of all bake periods in a plan.
func TotalBake(p domain.Plan) time.Duration {
	var t time.Duration
	for _, s := range p.Steps {
		t += s.Bake
	}
	return t
}
