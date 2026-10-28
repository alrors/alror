//go:build integration

// End-to-end release detection against a real cluster (for example kind)
// with Argo Rollouts and the `kubectl argo rollouts` plugin installed:
//
//	kind create cluster --name alror
//	kubectl create namespace argo-rollouts
//	kubectl apply -n argo-rollouts -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
//	ALROR_IT_CONTEXT=kind-alror go test -tags integration -run Integration ./internal/runner
//
// It creates a Rollout named alror-it in ALROR_IT_NAMESPACE (default
// "default"), changes its image with kubectl outside Alror, and checks that
// the watcher starts exactly one release that the engine drives to promoted.

package runner

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/driver"
	"github.com/alrors/alror/internal/store"
)

const itRollout = `apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: alror-it
spec:
  replicas: 2
  selector:
    matchLabels: {app: alror-it}
  template:
    metadata:
      labels: {app: alror-it}
    spec:
      containers:
        - name: alror-it
          image: nginx:1.25-alpine
  strategy:
    canary:
      # Matches the medium-risk plan (5 → 25 → 50 → 100): Alror promotes
      # each paused step, then promotes fully.
      steps:
        - setWeight: 5
        - pause: {}
        - setWeight: 25
        - pause: {}
        - setWeight: 50
        - pause: {}
`

func TestIntegrationDetectsAnImageChangeOnce(t *testing.T) {
	kctx := os.Getenv("ALROR_IT_CONTEXT")
	if kctx == "" {
		t.Skip("set ALROR_IT_CONTEXT to a kube context with Argo Rollouts installed")
	}
	ns := os.Getenv("ALROR_IT_NAMESPACE")
	if ns == "" {
		ns = "default"
	}
	kubectl := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("kubectl", append(args, "--context", kctx, "-n", ns)...).CombinedOutput()
		if err != nil {
			t.Fatalf("kubectl %s: %v\n%s", strings.Join(args, " "), err, out)
		}
		return string(out)
	}
	manifest := filepath.Join(t.TempDir(), "rollout.yaml")
	if err := os.WriteFile(manifest, []byte(itRollout), 0o644); err != nil {
		t.Fatal(err)
	}
	kubectl("apply", "-f", manifest)
	t.Cleanup(func() {
		_ = exec.Command("kubectl", "delete", "rollout", "alror-it", "--context", kctx, "-n", ns).Run()
	})
	kubectl("argo", "rollouts", "status", "alror-it", "--timeout", "180s")

	cfg := config.Default("it")
	cfg.Dir = t.TempDir()
	cfg.Services = []config.Service{{Name: "alror-it", Target: "kubernetes", Cluster: kctx, Namespace: ns, Detect: true}}
	cfg.Policy.AllowSyntheticTelemetry = true // no metrics stack in kind; verdicts are labelled synthetic
	cfg.Policy.BakeScale = 0.001
	cfg.ApplyDefaults()
	st, err := store.Open(cfg.StateDir())
	if err != nil {
		t.Fatal(err)
	}
	state, err := OpenWatchState(filepath.Join(cfg.StateDir(), "watch.json"))
	if err != nil {
		t.Fatal(err)
	}
	lb := &logbook{}
	w := &Watcher{Cfg: cfg, Store: st, State: state, Log: lb.log, Interval: 2 * time.Second}

	ctx := context.Background()
	if err := w.Run(ctx, true); err != nil { // baseline
		t.Fatal(err)
	}
	kubectl("argo", "rollouts", "set", "image", "alror-it", "alror-it=nginx:1.27-alpine") // outside Alror

	deadline := time.Now().Add(3 * time.Minute)
	for time.Now().Before(deadline) {
		if err := w.Run(ctx, true); err != nil {
			t.Fatal(err)
		}
		if all, _ := st.List(); len(all) > 0 {
			break
		}
		time.Sleep(2 * time.Second)
	}
	for i := 0; i < 3; i++ { // later polls must not start another release
		if err := w.Run(ctx, true); err != nil {
			t.Fatal(err)
		}
	}
	all, err := st.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 {
		t.Fatalf("want exactly one deployment, got %d\n%s", len(all), lb)
	}
	if d := all[0]; d.Status != domain.StatusPromoted || d.Image != "nginx:1.27-alpine" {
		t.Fatalf("deployment = %+v\n%s", d, lb)
	}
	ro, err := (&driver.KubeCluster{}).Get(ctx, cfg.Services[0])
	if err != nil {
		t.Fatal(err)
	}
	if ro.Annotations[driver.AnnotationControlledBy] != all[0].ID {
		t.Fatalf("the Rollout must be marked as controlled by %s: %+v", all[0].ID, ro.Annotations)
	}
}
