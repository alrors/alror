package risk

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
)

// Shared fixtures: the same files run in apps/web/tests/decision.test.ts, so
// the Go scorer and the portal's TypeScript decision module cannot drift.
// Regenerate expectations after an intended rules change with
// ALROR_UPDATE_FIXTURES=1 go test ./internal/risk, then run
// node scripts/sync-rules.mjs to copy them to the portal.

const fixtureDir = "testdata/fixtures"

// webCopy is where the portal keeps its copies (Go embed cannot reach outside
// this package, and production portal builds only ship apps/web).
var webCopy = filepath.Join("..", "..", "apps", "web")

type fixture struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Services    []struct {
		Name     string   `json:"name"`
		Paths    []string `json:"paths"`
		Critical bool     `json:"critical"`
	} `json:"services"`
	Change struct {
		Files []struct {
			Path    string `json:"path"`
			Added   int    `json:"added"`
			Deleted int    `json:"deleted"`
		} `json:"files"`
		Authors         []string       `json:"authors"`
		Message         string         `json:"message"`
		RecentRollbacks map[string]int `json:"recent_rollbacks"`
	} `json:"change"`
	Expected *expectation `json:"expected"`
}

type expectation struct {
	Score      int             `json:"score"`
	Level      domain.Level    `json:"level"`
	Factors    []domain.Factor `json:"factors"`
	Services   []string        `json:"services"`
	AIAuthored bool            `json:"ai_authored"`
	Plan       fixturePlan     `json:"plan"`
}

type fixturePlan struct {
	Strategy string `json:"strategy"`
	Steps    []struct {
		Weight      int `json:"weight"`
		BakeSeconds int `json:"bake_seconds"`
	} `json:"steps"`
}

func fixtureFiles(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(fixtureDir, "*.json"))
	if err != nil || len(files) < 12 {
		t.Fatalf("want at least 12 shared fixtures in %s, got %d (%v)", fixtureDir, len(files), err)
	}
	sort.Strings(files)
	return files
}

func (fx *fixture) evaluate() expectation {
	cfg := config.Default("fixtures")
	cfg.Services = nil // only the fixture's services
	for _, s := range fx.Services {
		cfg.Services = append(cfg.Services, config.Service{Name: s.Name, Paths: s.Paths, Critical: s.Critical})
	}
	c := Change{Authors: fx.Change.Authors, Message: fx.Change.Message, RecentRollbacks: fx.Change.RecentRollbacks}
	for _, f := range fx.Change.Files {
		c.Files = append(c.Files, FileChange{Path: f.Path, Added: f.Added, Deleted: f.Deleted})
	}
	r := Score(cfg, c)
	plan := PlanFor(r)
	got := expectation{Score: r.Score, Level: r.Level, Factors: r.Factors, Services: r.Services, AIAuthored: r.AI, Plan: fixturePlan{Strategy: plan.Strategy}}
	if got.Factors == nil {
		got.Factors = []domain.Factor{}
	}
	if got.Services == nil {
		got.Services = []string{}
	}
	for _, s := range plan.Steps {
		got.Plan.Steps = append(got.Plan.Steps, struct {
			Weight      int `json:"weight"`
			BakeSeconds int `json:"bake_seconds"`
		}{s.Weight, int(s.Bake / time.Second)})
	}
	return got
}

func TestSharedFixtures(t *testing.T) {
	update := os.Getenv("ALROR_UPDATE_FIXTURES") == "1"
	for _, path := range fixtureFiles(t) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var fx fixture
		if err := json.Unmarshal(raw, &fx); err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		got := fx.evaluate()
		if update {
			fx.Expected = &got
			var out bytes.Buffer
			enc := json.NewEncoder(&out)
			enc.SetEscapeHTML(false)
			enc.SetIndent("", "  ")
			if err := enc.Encode(fx); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
				t.Fatal(err)
			}
			continue
		}
		t.Run(fx.Name, func(t *testing.T) {
			if fx.Expected == nil {
				t.Fatal("fixture has no expected result")
			}
			if !reflect.DeepEqual(got, *fx.Expected) {
				g, _ := json.MarshalIndent(got, "", "  ")
				w, _ := json.MarshalIndent(fx.Expected, "", "  ")
				t.Fatalf("%s\ngot:  %s\nwant: %s", fx.Description, g, w)
			}
		})
	}
}

// TestRulesCopiesInSync fails when the portal's copies of the rules or the
// fixtures differ from the canonical ones here (fix: node scripts/sync-rules.mjs).
func TestRulesCopiesInSync(t *testing.T) {
	if _, err := os.Stat(webCopy); err != nil {
		t.Skip("apps/web is not part of this checkout")
	}
	pairs := map[string]string{"rules.json": filepath.Join(webCopy, "src", "lib", "server", "decision", "rules.json")}
	for _, f := range fixtureFiles(t) {
		pairs[f] = filepath.Join(webCopy, "tests", "fixtures", "risk", filepath.Base(f))
	}
	copies, _ := filepath.Glob(filepath.Join(webCopy, "tests", "fixtures", "risk", "*.json"))
	if len(copies) != len(pairs)-1 {
		t.Errorf("apps/web has %d risk fixtures, want %d: run node scripts/sync-rules.mjs", len(copies), len(pairs)-1)
	}
	normalize := func(b []byte) []byte { return bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n")) }
	for src, dst := range pairs {
		a, err := os.ReadFile(src)
		if err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(dst)
		if err != nil || !bytes.Equal(normalize(a), normalize(b)) {
			t.Errorf("%s is out of sync with internal/risk/%s: run node scripts/sync-rules.mjs", dst, src)
		}
	}
}

func TestRulesValidation(t *testing.T) {
	if _, err := ParseRules([]byte(`{"version":1}`)); err == nil {
		t.Fatal("rules without patterns, thresholds or plans must be rejected")
	}
	r := DefaultRules()
	if r.SensitiveArea("db/migrations/0042_add_ledger.sql") != "migration" {
		t.Fatal("the leftmost sensitive match decides the area")
	}
	if r.SensitiveArea("web/app.tsx") != "" {
		t.Fatal("ordinary paths are not sensitive")
	}
}
