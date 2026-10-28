package capability

import (
	"errors"
	"os"
	"strings"
	"testing"
)

// The docs embed the matrix between markers; it must match the code exactly.
func TestDocsMatchMatrix(t *testing.T) {
	want := strings.TrimSpace(Markdown())
	for _, path := range []string{"../docsite/content/targets.md", "../../README.md"} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		doc := strings.ReplaceAll(string(raw), "\r\n", "\n")
		_, rest, ok := strings.Cut(doc, "<!-- capability-matrix:start -->")
		got, _, ok2 := strings.Cut(rest, "<!-- capability-matrix:end -->")
		if !ok || !ok2 {
			t.Fatalf("%s: capability-matrix markers missing", path)
		}
		if strings.TrimSpace(got) != want {
			t.Errorf("%s: capability matrix is out of date; replace it with:\n\n%s", path, want)
		}
	}
}

func TestMatrixIsHonest(t *testing.T) {
	for _, tgt := range Targets {
		for _, op := range Operations {
			if tgt.Maturity(op) == Verified {
				t.Errorf("%s %s is marked verified without end-to-end evidence", tgt.Name, op)
			}
		}
	}
	ecs, ok := TargetFor("ecs")
	if !ok || ecs.Overall() != Unsupported || !errors.Is(ecs.Check(OpShift), ErrUnsupported) {
		t.Fatalf("ecs must be unsupported: %+v", ecs)
	}
	k8s, _ := TargetFor("kubernetes")
	if k8s.Maturity(OpObserve) != Unsupported || k8s.Overall() != Experimental {
		t.Fatalf("kubernetes cannot observe traffic and is experimental: %+v", k8s)
	}
	if sim, _ := TargetFor(""); sim.Name != "simulated" || sim.Overall() != Simulated {
		t.Fatalf("empty target is simulated: %+v", sim)
	}
	if p, _ := ProviderFor(""); p.Name != "synthetic" || p.Maturity != Simulated {
		t.Fatalf("synthetic telemetry is simulated: %+v", p)
	}
	if _, ok := TargetFor("nomad"); ok {
		t.Fatal("unknown targets are not in the matrix")
	}
}
