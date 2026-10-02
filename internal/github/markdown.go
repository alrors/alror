package github

import (
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/alrors/alror/internal/domain"
)

const CommentMarker = "<!-- alror:change-risk -->"
const CheckName = "Alror / change-risk"

type RiskOptions struct {
	SHA, BaseRef string
	FailAbove    int
}

// ReceiptOptions supplies the evidence collected during a rollout.
type ReceiptOptions struct {
	RunURL, Driver, Metrics string
	Events                  []domain.Event
	Shadow                  bool
	BakeScale               float64
}

// DeploymentMarker separates service/environment receipts from risk comments.
func DeploymentMarker(service, environment string) string {
	key := sha256.Sum256([]byte(service + "\x00" + environment))
	return fmt.Sprintf("<!-- alror:deployment:%x -->", key[:12])
}

func Conclusion(r domain.RiskReport, failAbove int) string {
	switch {
	case failAbove > 0 && r.Score > failAbove:
		return "failure"
	case r.Level == domain.LevelLow:
		return "success"
	default:
		return "neutral"
	}
}

func CheckTitle(r domain.RiskReport) string {
	return fmt.Sprintf("%s risk (%d/100)", capitalize(string(r.Level)), r.Score)
}

// RiskMarkdown renders the same report for checks, comments and job summaries.
func RiskMarkdown(r domain.RiskReport, p domain.Plan, files int, runURL string, options ...RiskOptions) string {
	o := RiskOptions{}
	if len(options) > 0 {
		o = options[0]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "## Alror · Change risk\n\n**%s · %d/100**\n\n", capitalize(string(r.Level)), r.Score)
	switch {
	case Conclusion(r, o.FailAbove) == "failure":
		fmt.Fprintf(&b, "> ❌ **Risk gate failed.** Score %d exceeds the configured limit of %d.\n\n", r.Score, o.FailAbove)
	case o.FailAbove > 0:
		fmt.Fprintf(&b, "> ✅ **Within the risk limit.** Score %d is at or below %d.\n\n", r.Score, o.FailAbove)
	default:
		b.WriteString("> ℹ️ **Advisory report.** This score does not block the pull request.\n\n")
	}
	b.WriteString("| Change scope | Details |\n| --- | --- |\n")
	fmt.Fprintf(&b, "| Files changed | %d |\n| Affected services | %s |\n", files, orDash(strings.Join(r.Services, ", ")))
	if o.SHA != "" {
		fmt.Fprintf(&b, "| Commit | %s |\n", escape(o.SHA))
	}
	if o.BaseRef != "" {
		fmt.Fprintf(&b, "| Compared against | %s |\n", escape(o.BaseRef))
	}
	if r.AI {
		b.WriteString("| Authorship signal | AI-authored |\n")
	}
	b.WriteString("\n### Why this score\n\n")
	if len(r.Factors) == 0 {
		b.WriteString("No risk factors found.\n\n")
	} else {
		b.WriteString("| Points | Factor | Detail |\n| ---: | --- | --- |\n")
		for i, f := range r.Factors {
			if i == 30 || b.Len() > 45000 {
				b.WriteString("\nAdditional factors are available in the workflow logs.\n")
				break
			}
			fmt.Fprintf(&b, "| %+d | %s | %s |\n", f.Points, escape(f.Name), escape(f.Detail))
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "### Recommended rollout\n\n**%s**\n\n", planLine(p))
	writePlan(&b, p, 1)
	b.WriteString("### Next step\n\n")
	if Conclusion(r, o.FailAbove) == "failure" {
		b.WriteString("Review the contributing factors, reduce the change scope where possible, and rerun the check.\n\n")
	} else {
		b.WriteString("Review the factors above, then use the recommended rollout to verify the release against its baseline. This check scores the change; it does not deploy or verify runtime health.\n\n")
	}
	b.WriteString("<sub>Scores are rule-based. AI authorship is one signal, not a standalone gate.</sub>\n")
	writeRunLink(&b, runURL)
	return b.String()
}

// ReceiptMarkdown reports the actual outcome, including failed shadow verdicts.
func ReceiptMarkdown(d *domain.Deployment, v *domain.Verdict, elapsed time.Duration, options ...ReceiptOptions) string {
	o := ReceiptOptions{BakeScale: 1}
	if len(options) > 0 {
		o = options[0]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "## Alror · Deployment result\n\n**%s**\n\n", escape(d.Service))
	failed := v != nil && !v.Pass
	for _, e := range o.Events {
		failed = failed || (e.Verdict != nil && !e.Verdict.Pass)
	}
	switch d.Status {
	case domain.StatusPromoted:
		if failed {
			b.WriteString("> ⚠️ **Promoted with failed verification.** The release reached 100% traffic despite a failed metric verdict.\n\n")
		} else {
			b.WriteString("> ✅ **Promoted.** The release reached 100% traffic.\n\n")
		}
	case domain.StatusRolledBack:
		fmt.Fprintf(&b, "> ↩️ **Rolled back.** The rollout stopped at %d%%; the rollback operation completed.\n\n", d.Weight)
	case domain.StatusFailed:
		b.WriteString("> ❌ **Deployment failed.** Check the workflow logs and confirm the current traffic state before retrying.\n\n")
	default:
		fmt.Fprintf(&b, "> ℹ️ **%s.** No terminal deployment outcome was recorded.\n\n", escape(string(d.Status)))
	}
	if o.Shadow {
		b.WriteString("> **Shadow mode:** metric failures do not trigger automatic rollback.\n\n")
	}
	b.WriteString("| Release | Details |\n| --- | --- |\n")
	fmt.Fprintf(&b, "| Status | %s |\n| Environment | %s |\n| Image / artifact | %s |\n| Ref | %s |\n| Risk | %d/100 · %s |\n| Deployment ID | %s |\n| Duration | %s |\n| Last rollout stage | %d%% |\n",
		escape(string(d.Status)), orDash(d.Environment), escape(d.Image), orDash(d.Ref), d.Risk.Score, escape(string(d.Risk.Level)), escape(d.ID), elapsed.Round(time.Millisecond), d.Weight)
	if o.Driver != "" {
		fmt.Fprintf(&b, "| Deployment driver | %s |\n", escape(o.Driver))
	}
	if o.Metrics != "" {
		fmt.Fprintf(&b, "| Metrics provider | %s |\n", escape(o.Metrics))
	}
	if !d.CreatedAt.IsZero() {
		fmt.Fprintf(&b, "| Started (UTC) | %s |\n", d.CreatedAt.UTC().Format(time.RFC3339))
	}
	if !d.UpdatedAt.IsZero() {
		fmt.Fprintf(&b, "| Last updated (UTC) | %s |\n", d.UpdatedAt.UTC().Format(time.RFC3339))
	}
	if d.Reason != "" {
		fmt.Fprintf(&b, "\n**Reason:** %s\n", escape(d.Reason))
	}
	fmt.Fprintf(&b, "\n### Rollout plan\n\n**%s**\n\n", planLine(d.Plan))
	writePlan(&b, d.Plan, o.BakeScale)
	b.WriteString("### Verification results\n\n")
	passedStages, failedStages := 0, 0
	for _, e := range o.Events {
		if e.Verdict != nil {
			if e.Verdict.Pass {
				passedStages++
			} else {
				failedStages++
			}
		}
	}
	if passedStages+failedStages > 0 {
		fmt.Fprintf(&b, "**%d stage verdicts passed · %d failed**\n\n<details>\n<summary>View per-stage measurements</summary>\n\n", passedStages, failedStages)
	}
	count := 0
	for _, e := range o.Events {
		if e.Verdict == nil {
			continue
		}
		if count == 10 || b.Len() > 45000 {
			b.WriteString("Additional stage results are available in the workflow logs.\n\n")
			break
		}
		count++
		fmt.Fprintf(&b, "#### Stage at %d%% traffic\n\n", e.Weight)
		writeVerdict(&b, e.Verdict)
	}
	if count == 0 {
		if v != nil {
			b.WriteString("#### Latest recorded verdict\n\n")
			writeVerdict(&b, v)
		} else {
			b.WriteString("No metric verdict was recorded. Promotion alone does not establish runtime health.\n\n")
		}
	}
	if passedStages+failedStages > 0 {
		b.WriteString("</details>\n\n")
	}
	b.WriteString("### Next step\n\n")
	switch {
	case d.Status == domain.StatusFailed:
		b.WriteString("Inspect the failure in the workflow logs, confirm traffic is in the intended state, and fix the cause before retrying.\n")
	case d.Status == domain.StatusRolledBack || failed:
		b.WriteString("Investigate the failed metrics and compare the release with its baseline before attempting another rollout.\n")
	case d.Status == domain.StatusPromoted:
		b.WriteString("Continue monitoring service health and retain this receipt with the release.\n")
	default:
		b.WriteString("Inspect the workflow logs for the latest deployment state.\n")
	}
	writeRunLink(&b, o.RunURL)
	return b.String()
}

func writeVerdict(b *strings.Builder, v *domain.Verdict) {
	result := "✅ Passed"
	if !v.Pass {
		result = "❌ Failed"
	}
	fmt.Fprintf(b, "**%s** — %s\n\n", result, escape(v.Summary))
	if len(v.Results) == 0 {
		b.WriteString("No per-metric measurements were recorded for this verdict.\n\n")
		return
	}
	b.WriteString("| Metric | Canary | Baseline | Relative change | p-value | Result | Detail |\n| --- | ---: | ---: | ---: | ---: | --- | --- |\n")
	for i, r := range v.Results {
		if i == 10 || b.Len() > 45000 {
			b.WriteString("\nAdditional metrics are available in the workflow logs.\n")
			break
		}
		result := "Passed"
		if !r.Pass {
			result = "Failed"
		}
		fmt.Fprintf(b, "| %s | %.4g | %.4g | %+.1f%% | %.3g | %s | %s |\n", escape(r.Metric), r.Canary, r.Baseline, r.Delta*100, r.PValue, result, orDash(r.Reason))
	}
	b.WriteString("\nValues use the metrics provider's units. Relative change compares canary with baseline.\n\n")
}

func writePlan(b *strings.Builder, p domain.Plan, scale float64) {
	if scale <= 0 {
		scale = 1
	}
	b.WriteString("| Stage | Canary traffic | Planned observation |\n| ---: | ---: | --- |\n")
	for i, step := range p.Steps {
		if i == 20 {
			break
		}
		bake := (time.Duration(float64(step.Bake) * scale)).String()
		if step.Weight >= 100 {
			bake = "Promote to all traffic"
		}
		fmt.Fprintf(b, "| %d | %d%% | %s |\n", i+1, step.Weight, bake)
	}
	b.WriteString("\n")
}

func planLine(p domain.Plan) string {
	parts := make([]string, 0, min(len(p.Steps), 20))
	for i, s := range p.Steps {
		if i == 20 {
			break
		}
		parts = append(parts, fmt.Sprintf("%d%%", s.Weight))
	}
	return escape(p.Strategy) + " " + strings.Join(parts, " → ")
}

func writeRunLink(b *strings.Builder, raw string) {
	u, err := url.Parse(raw)
	if err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" {
		link := strings.NewReplacer("(", "%28", ")", "%29", "<", "%3C", ">", "%3E").Replace(u.String())
		fmt.Fprintf(b, "\n[View workflow run and logs](%s)\n", link)
	}
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// Escape untrusted git/config text before placing it in Markdown tables.
func escape(s string) string {
	runes := []rune(s)
	if len(runes) > 200 {
		s = string(runes[:200]) + "…"
	}
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\\", "\\\\", "|", "\\|", "`", "\\`", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]", "\r", " ", "\n", " ", "@", "&#64;").Replace(s)
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return escape(s)
}
