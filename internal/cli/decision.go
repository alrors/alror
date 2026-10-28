package cli

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/alrors/alror/internal/api"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/risk"
)

// riskSource says where a deploy's risk score and plan came from; it is part
// of `alror deploy --json` output as "risk_source".
type riskSource struct {
	// Source is "portal" (the decision the workspace stored for the commit),
	// "local" (scored here from the git diff), "override" (--risk) or
	// "assumed" (no diff available; medium risk).
	Source       string `json:"source"`
	Commit       string `json:"commit,omitempty"`
	Repository   string `json:"repository,omitempty"`
	PullNumber   int    `json:"pull_number,omitempty"`
	RulesVersion int    `json:"rules_version,omitempty"`
	Note         string `json:"note,omitempty"`
}

var commitSHA = regexp.MustCompile(`^[0-9a-fA-F]{7,40}$`)

// deployCommit is the commit being deployed: --ref when it is a SHA, else HEAD of the repository.
func deployCommit(ref, dir string) string {
	if commitSHA.MatchString(ref) {
		return strings.ToLower(ref)
	}
	if sha, err := risk.HeadCommit(dir); err == nil {
		return sha
	}
	return ""
}

// portalDecision returns the risk and plan the workspace stored for the
// commit (connected mode only). ok is false when there is none, or it cannot
// be read, so the caller falls back to scoring locally; note explains why.
func portalDecision(client *api.Client, commit string) (report domain.RiskReport, plan domain.Plan, src riskSource, ok bool) {
	src = riskSource{Source: "local", Commit: commit}
	if client == nil || commit == "" {
		src.Note = "no commit to look up"
		return report, plan, src, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	d, err := client.Decision(ctx, commit)
	switch {
	case errors.Is(err, api.ErrNotFound):
		src.Note = "no portal decision for this commit"
		return report, plan, src, false
	case err != nil:
		src.Note = "could not read the portal decision: " + err.Error()
		return report, plan, src, false
	case !validPlan(d.Plan):
		src.Note = "the portal decision has no usable rollout plan"
		return report, plan, src, false
	}
	report = d.Risk
	report.Score = max(0, min(report.Score, 100))
	if report.Level != domain.LevelLow && report.Level != domain.LevelMedium && report.Level != domain.LevelHigh {
		report.Level = risk.LevelFor(report.Score)
	}
	return report, d.Plan, riskSource{Source: "portal", Commit: d.SHA, Repository: d.Repository, PullNumber: d.PullNumber, RulesVersion: d.RulesVersion}, true
}

func validPlan(p domain.Plan) bool {
	if len(p.Steps) == 0 || p.Steps[len(p.Steps)-1].Weight != 100 {
		return false
	}
	for _, s := range p.Steps {
		if s.Weight < 1 || s.Weight > 100 || s.Bake < 0 {
			return false
		}
	}
	return true
}

// describe is the one-line explanation shown before the rollout.
func (s riskSource) describe() string {
	short := s.Commit
	if len(short) > 12 {
		short = short[:12]
	}
	switch s.Source {
	case "portal":
		return fmt.Sprintf("risk: portal decision for %s (%s#%d, shared rules v%d)", short, s.Repository, s.PullNumber, s.RulesVersion)
	case "override":
		return "risk: --risk override"
	case "assumed":
		return "risk: assumed medium (git diff unavailable)"
	}
	if s.Note != "" {
		return "risk: scored locally (" + s.Note + ")"
	}
	return "risk: scored locally"
}
