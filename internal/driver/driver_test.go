package driver

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/capability"
	"github.com/alrors/alror/internal/config"
)

func TestForRejectsUnsupportedAndUnknownTargets(t *testing.T) {
	if _, err := For(config.Service{Name: "billing", Target: "ecs"}); !errors.Is(err, capability.ErrUnsupported) {
		t.Fatalf("ecs: want ErrUnsupported, got %v", err)
	}
	if _, err := For(config.Service{Name: "x", Target: "nomad"}); err == nil {
		t.Fatal("unknown target must be rejected")
	}
	for target, want := range map[string]string{"": "simulated", "simulated": "simulated", "kubernetes": "kubernetes"} {
		d, err := For(config.Service{Name: "x", Target: target})
		if err != nil || d.Name() != want {
			t.Fatalf("%q: %v %v", target, d, err)
		}
	}
}

func TestKubernetesSeparatesImageFromWeights(t *testing.T) {
	var cmds []string
	k := &Kubernetes{Run: func(_ context.Context, args ...string) error {
		cmds = append(cmds, strings.Join(args, " "))
		return nil
	}}
	svc := config.Service{Name: "api", Cluster: "prod", Namespace: "shop"}
	ctx := context.Background()
	if err := k.Prepare(ctx, svc, "reg/api:2"); err != nil {
		t.Fatal(err)
	}
	for step, w := range []int{25, 50} {
		if err := k.SetWeight(ctx, svc, step, w); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{
		"argo rollouts set image api api=reg/api:2 --context prod -n shop",
		"argo rollouts promote api --context prod -n shop",
	}
	if strings.Join(cmds, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got:\n%s\nwant:\n%s", strings.Join(cmds, "\n"), strings.Join(want, "\n"))
	}
	if err := k.Prepare(ctx, svc, ""); err == nil {
		t.Fatal("an empty image must not be applied")
	}
}
