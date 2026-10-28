package risk

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/alrors/alror/internal/domain"
)

// rulesJSON is the canonical shared rules file. The portal keeps a byte-for-byte
// copy at apps/web/src/lib/server/decision/rules.json (scripts/sync-rules.mjs);
// TestRulesCopiesInSync and CI fail when the two drift.
//
//go:embed rules.json
var rulesJSON []byte

// Rules is the parsed shared risk rules file: factor points, thresholds,
// path patterns, level thresholds and rollout plans.
type Rules struct {
	Version  int `json:"version"`
	MaxScore int `json:"max_score"`
	Levels   struct {
		Medium int `json:"medium"`
		High   int `json:"high"`
	} `json:"levels"`
	Patterns struct {
		TestFile  string `json:"test_file"`
		DocFile   string `json:"doc_file"`
		AIAuthor  string `json:"ai_author"`
		AITrailer string `json:"ai_trailer"`
	} `json:"patterns"`
	SensitivePaths []SensitivePath `json:"sensitive_paths"`
	Factors        struct {
		DocsOnly fixedFactor `json:"docs_only"`
		DiffSize struct {
			Detail string `json:"detail"`
			Tiers  []struct {
				MinLines int    `json:"min_lines"`
				Name     string `json:"name"`
				Points   int    `json:"points"`
			} `json:"tiers"`
		} `json:"diff_size"`
		ManyFiles struct {
			Name   string `json:"name"`
			Detail string `json:"detail"`
			Tiers  []struct {
				MinFiles int `json:"min_files"`
				Points   int `json:"points"`
			} `json:"tiers"`
		} `json:"many_files"`
		BlastRadius struct {
			Name                  string `json:"name"`
			Detail                string `json:"detail"`
			PointsPerExtraService int    `json:"points_per_extra_service"`
			MaxPoints             int    `json:"max_points"`
		} `json:"blast_radius"`
		CriticalService fixedFactor `json:"critical_service"`
		SensitivePaths  struct {
			Name          string `json:"name"`
			Detail        string `json:"detail"`
			PointsPerArea int    `json:"points_per_area"`
			MaxPoints     int    `json:"max_points"`
		} `json:"sensitive_paths"`
		NoTests    fixedFactor `json:"no_tests"`
		WellTested struct {
			fixedFactor
			MinTestsPerCodeFile float64 `json:"min_tests_per_code_file"`
		} `json:"well_tested"`
		AIAuthored      fixedFactor `json:"ai_authored"`
		RecentRollbacks struct {
			Name              string `json:"name"`
			Detail            string `json:"detail"`
			PointsPerRollback int    `json:"points_per_rollback"`
			MaxPoints         int    `json:"max_points"`
			WindowDays        int    `json:"window_days"`
		} `json:"recent_rollbacks"`
	} `json:"factors"`
	Plans map[domain.Level]PlanRule `json:"plans"`

	testFile, docFile, aiAuthor, aiTrailer *regexp.Regexp
	sensitive                              []*regexp.Regexp
}

// SensitivePath is one named sensitive area of a codebase.
type SensitivePath struct {
	Name    string `json:"name"`
	Pattern string `json:"pattern"`
}

// PlanRule is the rollout plan for one risk level.
type PlanRule struct {
	Strategy string `json:"strategy"`
	Steps    []struct {
		Weight      int `json:"weight"`
		BakeSeconds int `json:"bake_seconds"`
	} `json:"steps"`
}

type fixedFactor struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	Points int    `json:"points"`
}

var defaultRules = mustParseRules(rulesJSON)

// DefaultRules returns the embedded shared rules.
func DefaultRules() *Rules { return defaultRules }

func mustParseRules(b []byte) *Rules {
	r, err := ParseRules(b)
	if err != nil {
		panic("risk: invalid embedded rules.json: " + err.Error())
	}
	return r
}

// ParseRules parses and validates a rules file.
func ParseRules(b []byte) (*Rules, error) {
	var r Rules
	if err := json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	compile := func(name, p string) (*regexp.Regexp, error) {
		if p == "" {
			return nil, fmt.Errorf("pattern %s is empty", name)
		}
		re, err := regexp.Compile("(?i)" + p)
		if err != nil {
			return nil, fmt.Errorf("pattern %s: %w", name, err)
		}
		return re, nil
	}
	var err error
	if r.testFile, err = compile("test_file", r.Patterns.TestFile); err != nil {
		return nil, err
	}
	if r.docFile, err = compile("doc_file", r.Patterns.DocFile); err != nil {
		return nil, err
	}
	if r.aiAuthor, err = compile("ai_author", r.Patterns.AIAuthor); err != nil {
		return nil, err
	}
	if r.aiTrailer, err = compile("ai_trailer", r.Patterns.AITrailer); err != nil {
		return nil, err
	}
	for _, s := range r.SensitivePaths {
		re, err := compile("sensitive_paths."+s.Name, s.Pattern)
		if err != nil {
			return nil, err
		}
		r.sensitive = append(r.sensitive, re)
	}
	if r.MaxScore <= 0 || r.Levels.Medium <= 0 || r.Levels.High <= r.Levels.Medium {
		return nil, fmt.Errorf("invalid score limits or level thresholds")
	}
	for _, l := range []domain.Level{domain.LevelLow, domain.LevelMedium, domain.LevelHigh} {
		p, ok := r.Plans[l]
		if !ok || len(p.Steps) == 0 || p.Steps[len(p.Steps)-1].Weight != 100 {
			return nil, fmt.Errorf("plan %q must exist and end at 100%%", l)
		}
	}
	return &r, nil
}

// LevelFor maps a score to a level.
func (r *Rules) LevelFor(score int) domain.Level {
	switch {
	case score >= r.Levels.High:
		return domain.LevelHigh
	case score >= r.Levels.Medium:
		return domain.LevelMedium
	default:
		return domain.LevelLow
	}
}

// PlanFor returns the rollout plan for a risk level. Riskier changes get
// smaller first steps, more steps and longer bakes; the final step is always
// 100%, which means "promote". Unknown levels get the medium plan.
func (r *Rules) PlanFor(level domain.Level) domain.Plan {
	p, ok := r.Plans[level]
	if !ok {
		p = r.Plans[domain.LevelMedium]
	}
	out := domain.Plan{Strategy: p.Strategy, Steps: make([]domain.Step, len(p.Steps))}
	for i, s := range p.Steps {
		out.Steps[i] = domain.Step{Weight: s.Weight, Bake: time.Duration(s.BakeSeconds) * time.Second}
	}
	return out
}

// RollbackWindow is how far back recent rollbacks count.
func (r *Rules) RollbackWindow() time.Duration {
	return time.Duration(r.Factors.RecentRollbacks.WindowDays) * 24 * time.Hour
}

// IsTestFile reports whether a path is a test file under the shared rules.
func (r *Rules) IsTestFile(p string) bool { return r.testFile.MatchString(p) }

// IsDocFile reports whether a path is documentation under the shared rules.
func (r *Rules) IsDocFile(p string) bool { return r.docFile.MatchString(p) }

// SensitiveArea returns the name of the sensitive area a path falls in, or "".
// Like a single alternation, the leftmost match wins and ties go to the
// earlier rule, so a path counts toward exactly one area.
func (r *Rules) SensitiveArea(p string) string {
	best, at := "", -1
	for i, re := range r.sensitive {
		if loc := re.FindStringIndex(p); loc != nil && (at < 0 || loc[0] < at) {
			best, at = r.SensitivePaths[i].Name, loc[0]
		}
	}
	return best
}

// fill replaces {name} placeholders in a detail template.
func fill(tmpl string, vars map[string]any) string {
	pairs := make([]string, 0, 2*len(vars))
	for k, v := range vars {
		pairs = append(pairs, "{"+k+"}", fmt.Sprint(v))
	}
	return strings.NewReplacer(pairs...).Replace(tmpl)
}
