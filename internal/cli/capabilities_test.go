package cli

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/store"
)

func writeConfig(t *testing.T, repo, target, extraPolicy string) {
	t.Helper()
	yaml := "project: t\nservices:\n  - name: api\n    paths: [api/]\n    target: " + target + "\n" +
		"metrics:\n  provider: synthetic\npolicy:\n  auto_rollback: true\n" + extraPolicy
	if err := os.WriteFile(filepath.Join(repo, "alror.yaml"), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
}

func deployments(t *testing.T, repo string) []*domain.Deployment {
	t.Helper()
	st, err := store.Open(filepath.Join(repo, ".alror"))
	if err != nil {
		t.Fatal(err)
	}
	all, err := st.List()
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func TestDeployRecordsEvidenceSources(t *testing.T) {
	isolate(t)
	repo := t.TempDir()
	writeConfig(t, repo, "simulated", "")
	mustRun(t, 0, "-C", repo, "--json", "deploy", "-s", "api", "-i", "app:2", "--risk", "10", "--fast")
	d := deployments(t, repo)
	if len(d) != 1 || d[0].Status != domain.StatusPromoted || d[0].Target != "simulated" || d[0].Telemetry != "synthetic" {
		t.Fatalf("deployments = %+v", d)
	}
	mustRun(t, 0, "--json", "capabilities")
}

func TestDeployRefusesUnsupportedTargetsAndSyntheticTelemetry(t *testing.T) {
	isolate(t)
	for _, target := range []string{"ecs", "kubernetes"} {
		repo := t.TempDir()
		writeConfig(t, repo, target, "")
		mustRun(t, 1, "-C", repo, "--json", "deploy", "-s", "api", "-i", "app:2", "--risk", "10", "--fast")
		if d := deployments(t, repo); len(d) != 0 {
			t.Fatalf("%s: a refused deploy must not be recorded: %+v", target, d)
		}
		mustRun(t, 1, "-C", repo, "doctor")
	}
}

func TestFailedRollbackExitsFour(t *testing.T) {
	isolate(t)
	t.Setenv("PATH", t.TempDir()) // no kubectl: prepare fails, and so does the rollback
	repo := t.TempDir()
	writeConfig(t, repo, "kubernetes", "  allow_synthetic_telemetry: true\n")
	mustRun(t, 4, "-C", repo, "--json", "deploy", "-s", "api", "-i", "app:2", "--risk", "10", "--fast")
	d := deployments(t, repo)
	if len(d) != 1 || d[0].Status != domain.StatusFailed || d[0].Recovery != domain.RecoveryFailed {
		t.Fatalf("deployments = %+v", d)
	}
}
