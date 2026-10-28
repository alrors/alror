package driver

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/config"
)

const rolloutJSON = `{
  "apiVersion": "argoproj.io/v1alpha1",
  "kind": "Rollout",
  "metadata": {
    "name": "api", "namespace": "shop", "resourceVersion": "4711", "generation": 7,
    "annotations": {"alror.dev/controlled-by": "dep_1", "alror.dev/image": "reg/api:1"}
  },
  "spec": {
    "template": {
      "metadata": {"annotations": {"alror.dev/commit": "3f9c2ab"}, "labels": {"app": "api"}},
      "spec": {"containers": [{"name": "api", "image": "reg/api:2"}, {"name": "proxy", "image": "envoy:1"}]}
    }
  },
  "status": {"observedGeneration": "7", "currentPodHash": "abc", "stableRS": "def", "phase": "Paused"}
}`

func TestParseRollout(t *testing.T) {
	r, err := ParseRollout([]byte(rolloutJSON))
	if err != nil {
		t.Fatal(err)
	}
	if img, ok := r.Image("api"); !ok || img != "reg/api:2" {
		t.Fatalf("image = %q %v", img, ok)
	}
	if r.ResourceVersion != "4711" || r.Generation != 7 || !r.Reconciled() || r.CurrentPodHash == r.StableRS {
		t.Fatalf("rollout = %+v", r)
	}
	if r.Annotations[AnnotationControlledBy] != "dep_1" || r.TemplateAnnotations[AnnotationCommit] != "3f9c2ab" {
		t.Fatalf("annotations = %+v %+v", r.Annotations, r.TemplateAnnotations)
	}

	// observedGeneration as a number, behind the spec: not reconciled yet.
	behind := strings.Replace(rolloutJSON, `"observedGeneration": "7"`, `"observedGeneration": 6`, 1)
	if r, err = ParseRollout([]byte(behind)); err != nil || r.Reconciled() {
		t.Fatalf("generation 7 observed 6 must not count as reconciled: %+v %v", r, err)
	}
	if _, err := ParseRollout([]byte(`{"kind":"Deployment"}`)); err == nil {
		t.Fatal("a Deployment is not a Rollout")
	}
}

func TestKubeClusterCommands(t *testing.T) {
	var calls []string
	conflict := false
	c := &KubeCluster{Exec: func(_ context.Context, args ...string) ([]byte, error) {
		calls = append(calls, strings.Join(args, " "))
		if args[0] == "annotate" && conflict {
			return nil, errors.New("Operation cannot be fulfilled on rollouts.argoproj.io \"api\": the object has been modified")
		}
		return []byte(rolloutJSON), nil
	}}
	svc := config.Service{Name: "api", Cluster: "prod", Namespace: "shop"}
	ctx := context.Background()
	if _, err := c.Get(ctx, svc); err != nil {
		t.Fatal(err)
	}
	if err := c.Claim(ctx, svc, "4711", "dep_2", "reg/api:2"); err != nil {
		t.Fatal(err)
	}
	conflict = true
	if err := c.Claim(ctx, svc, "4711", "dep_2", "reg/api:2"); !errors.Is(err, ErrConflict) {
		t.Fatalf("a stale resourceVersion must be ErrConflict, got %v", err)
	}
	if err := c.Claim(ctx, svc, "", "dep_2", "reg/api:2"); err == nil {
		t.Fatal("a claim needs a resourceVersion")
	}
	want := []string{
		"get rollouts.argoproj.io api -o json --context prod -n shop",
		"annotate rollouts.argoproj.io api alror.dev/controlled-by=dep_2 alror.dev/image=reg/api:2 --overwrite --resource-version=4711 --context prod -n shop",
		"annotate rollouts.argoproj.io api alror.dev/controlled-by=dep_2 alror.dev/image=reg/api:2 --overwrite --resource-version=4711 --context prod -n shop",
	}
	if strings.Join(calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got:\n%s\nwant:\n%s", strings.Join(calls, "\n"), strings.Join(want, "\n"))
	}
}

func TestKubernetesMarksBeforeImage(t *testing.T) {
	var cmds []string
	k := &Kubernetes{Run: func(_ context.Context, args ...string) error {
		cmds = append(cmds, strings.Join(args, " "))
		return nil
	}}
	var _ Marker = k
	if err := k.Mark(context.Background(), config.Service{Name: "api", Namespace: "shop"}, "dep_9", "reg/api:3"); err != nil {
		t.Fatal(err)
	}
	if want := "annotate rollouts.argoproj.io api alror.dev/controlled-by=dep_9 alror.dev/image=reg/api:3 --overwrite -n shop"; cmds[0] != want {
		t.Fatalf("got %q, want %q", cmds[0], want)
	}
}
