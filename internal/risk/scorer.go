// Package risk scores a code change from 0 to 100 and explains why.
//
// Scoring is deliberately rule-based: every point comes from a named factor,
// so a reviewer can always see (and argue with) the reasons. Language models
// never decide the score; they may only summarise it.
//
// Every rule (points, thresholds, path patterns, level thresholds and rollout
// plans) lives in rules.json, which is embedded here and shared byte for byte
// with the portal's TypeScript decision module.
package risk

import (
	"path"
	"sort"
	"strings"

	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
)

// FileChange is one file in a diff.
type FileChange struct {
	Path    string
	Added   int
	Deleted int
}

// Change is everything the scorer needs to know about a proposed release.
type Change struct {
	Files   []FileChange
	Authors []string // "name <email>"
	Message string   // concatenated commit messages, including trailers
	// RecentRollbacks counts rollbacks per service in the last 30 days.
	RecentRollbacks map[string]int
}

// Score computes the risk report for a change with the shared rules.
func Score(cfg *config.Config, c Change) domain.RiskReport { return defaultRules.Score(cfg, c) }

// LevelFor maps a score to a level with the shared rules.
func LevelFor(score int) domain.Level { return defaultRules.LevelFor(score) }

// PlanFor returns the shared rollout plan for a risk report.
func PlanFor(r domain.RiskReport) domain.Plan { return defaultRules.PlanFor(r.Level) }

// Score computes the risk report for a change against a configuration.
// Every rule (points, thresholds, patterns) comes from the rules file.
func (r *Rules) Score(cfg *config.Config, c Change) domain.RiskReport {
	f := r.Factors
	var factors []domain.Factor
	add := func(name, detail string, pts int) {
		if pts != 0 {
			factors = append(factors, domain.Factor{Name: name, Detail: detail, Points: pts})
		}
	}

	lines, code, tests, docs := 0, 0, 0, 0
	sensitiveHits := map[string]bool{}
	services := map[string]config.Service{}
	for _, fc := range c.Files {
		lines += fc.Added + fc.Deleted
		switch {
		case r.IsTestFile(fc.Path):
			tests++
		case r.IsDocFile(fc.Path):
			docs++
		default:
			code++
		}
		if area := r.SensitiveArea(fc.Path); area != "" {
			sensitiveHits[area] = true
		}
		for _, s := range cfg.ServicesForPath(fc.Path) {
			services[s.Name] = s
		}
	}

	// Docs-only changes are near-free.
	if len(c.Files) > 0 && docs == len(c.Files) {
		d := f.DocsOnly
		return r.finish([]domain.Factor{{Name: d.Name, Detail: fill(d.Detail, map[string]any{"docs": docs}), Points: d.Points}}, services, false)
	}

	// 1. Size of the change.
	for _, t := range f.DiffSize.Tiers {
		if lines >= t.MinLines {
			add(t.Name, fill(f.DiffSize.Detail, map[string]any{"lines": lines}), t.Points)
			break
		}
	}
	for _, t := range f.ManyFiles.Tiers {
		if n := len(c.Files); n >= t.MinFiles {
			add(f.ManyFiles.Name, fill(f.ManyFiles.Detail, map[string]any{"files": n}), t.Points)
			break
		}
	}

	// 2. Blast radius across services.
	if n := len(services); n > 1 {
		b := f.BlastRadius
		add(b.Name, fill(b.Detail, map[string]any{"count": n, "services": strings.Join(names(services), ", ")}), min(b.PointsPerExtraService*(n-1), b.MaxPoints))
	}
	for _, name := range names(services) {
		if services[name].Critical {
			cs := f.CriticalService
			add(cs.Name, fill(cs.Detail, map[string]any{"service": name}), cs.Points)
			break
		}
	}

	// 3. Sensitive areas of the codebase.
	if n := len(sensitiveHits); n > 0 {
		s := f.SensitivePaths
		add(s.Name, fill(s.Detail, map[string]any{"areas": strings.Join(keys(sensitiveHits), ", ")}), min(s.PointsPerArea*n, s.MaxPoints))
	}

	// 4. Test coverage of the change.
	vars := map[string]any{"code": code, "tests": tests}
	if code > 0 && tests == 0 {
		add(f.NoTests.Name, fill(f.NoTests.Detail, vars), f.NoTests.Points)
	} else if code > 0 && float64(tests) >= f.WellTested.MinTestsPerCodeFile*float64(code) {
		add(f.WellTested.Name, fill(f.WellTested.Detail, vars), f.WellTested.Points)
	}

	// 5. Who (or what) wrote it. One input, never a block on its own.
	ai := r.IsAIAuthored(c.Authors, c.Message)
	if ai {
		add(f.AIAuthored.Name, f.AIAuthored.Detail, f.AIAuthored.Points)
	}

	// 6. Recent history of the services involved.
	rollbacks := 0
	for name := range services {
		rollbacks += c.RecentRollbacks[name]
	}
	if rollbacks > 0 {
		rb := f.RecentRollbacks
		add(rb.Name, fill(rb.Detail, map[string]any{"rollbacks": rollbacks, "days": rb.WindowDays}), min(rb.PointsPerRollback*rollbacks, rb.MaxPoints))
	}

	return r.finish(factors, services, ai)
}

// IsAIAuthored reports whether commit authors or message trailers indicate a coding agent.
func (r *Rules) IsAIAuthored(authors []string, message string) bool {
	if r.aiTrailer.MatchString(message) {
		return true
	}
	for _, a := range authors {
		if r.aiAuthor.MatchString(a) {
			return true
		}
	}
	return false
}

func (r *Rules) finish(factors []domain.Factor, services map[string]config.Service, ai bool) domain.RiskReport {
	score := 0
	for _, f := range factors {
		score += f.Points
	}
	score = max(0, min(score, r.MaxScore))
	sort.SliceStable(factors, func(i, j int) bool { return factors[i].Points > factors[j].Points })
	return domain.RiskReport{Score: score, Level: r.LevelFor(score), Factors: factors, Services: names(services), AI: ai}
}

func names(m map[string]config.Service) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// Ext returns a file's extension without the dot (used by callers for display).
func Ext(p string) string { return strings.TrimPrefix(path.Ext(p), ".") }
