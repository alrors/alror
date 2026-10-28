package cli

import (
	"os"
	"path/filepath"
	"strings"
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

// fakeKubectl puts a kubectl on PATH that accepts `annotate` (the engine's
// control mark) and fails everything else.
func fakeKubectl(t *testing.T) {
	t.Helper()
	bin := t.TempDir()
	sh := "#!/bin/sh\n[ \"$1\" = annotate ] && exit 0\necho 'rollouts plugin missing' >&2\nexit 1\n"
	bat := "@if \"%1\"==\"annotate\" exit /b 0\r\n@echo rollouts plugin missing 1>&2\r\n@exit /b 1\r\n"
	if err := os.WriteFile(filepath.Join(bin, "kubectl"), []byte(sh), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "kubectl.bat"), []byte(bat), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
}

func TestFailedRollbackExitsFour(t *testing.T) {
	isolate(t)
	fakeKubectl(t) // the mark succeeds, prepare fails, and so does the rollback
	repo := t.TempDir()
	writeConfig(t, repo, "kubernetes", "  allow_synthetic_telemetry: true\n")
	mustRun(t, 4, "-C", repo, "--json", "deploy", "-s", "api", "-i", "app:2", "--risk", "10", "--fast")
	d := deployments(t, repo)
	if len(d) != 1 || d[0].Status != domain.StatusFailed || d[0].Recovery != domain.RecoveryFailed {
		t.Fatalf("deployments = %+v", d)
	}
}

func TestFailedMarkChangesNothing(t *testing.T) {
	isolate(t)
	t.Setenv("PATH", t.TempDir()) // no kubectl: the control mark fails before any traffic moves
	repo := t.TempDir()
	writeConfig(t, repo, "kubernetes", "  allow_synthetic_telemetry: true\n")
	mustRun(t, 1, "-C", repo, "--json", "deploy", "-s", "api", "-i", "app:2", "--risk", "10", "--fast")
	d := deployments(t, repo)
	if len(d) != 1 || d[0].Status != domain.StatusFailed || d[0].Recovery != "" || !strings.Contains(d[0].Reason, "no traffic was changed") {
		t.Fatalf("deployments = %+v", d)
	}
}

func TestRunnerWatchReportsUnsupportedTargets(t *testing.T) {
	isolate(t)
	repo := t.TempDir()
	yaml := "project: t\nservices:\n  - name: billing\n    target: ecs\n    detect: true\n" +
		"  - name: web\n    target: simulated\n    detect: true\npolicy:\n  auto_rollback: true\n"
	if err := os.WriteFile(filepath.Join(repo, "alror.yaml"), []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	// Nothing can be watched: reported and refused, never simulated.
	mustRun(t, 1, "-C", repo, "--local", "--json", "runner", "--watch", "--once")
	mustRun(t, 1, "-C", repo, "--local", "doctor")
	if d := deployments(t, repo); len(d) != 0 {
		t.Fatalf("nothing may be released: %+v", d)
	}
	// Without --watch, a local runner still needs a workspace.
	mustRun(t, 1, "-C", repo, "--local", "runner", "--once")
}
