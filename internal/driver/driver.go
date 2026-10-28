// Package driver shifts traffic on a deployment target.
//
// A driver is the only component that touches the customer's infrastructure.
// Drivers are deliberately small: prepare the new image once, request a
// canary weight per step, promote, roll back. What each target really does
// (and how far it can be trusted) is declared in internal/capability.
package driver

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"

	"github.com/alrors/alror/internal/capability"
	"github.com/alrors/alror/internal/config"
)

// Driver moves traffic between the stable version and the canary.
//
// The engine calls Prepare exactly once, before the first step, and never
// again: image preparation is independent of step weights, so a plan that
// starts at 25% still applies the new image, and later low-weight steps do
// not re-apply it. SetWeight receives the zero-based step index and the
// requested weight; it must not change the image.
type Driver interface {
	Name() string
	Prepare(ctx context.Context, svc config.Service, image string) error
	SetWeight(ctx context.Context, svc config.Service, step, weight int) error
	Promote(ctx context.Context, svc config.Service) error
	Rollback(ctx context.Context, svc config.Service) error
}

// For returns the driver for a service's target. Targets whose operations
// are unsupported in the capability matrix (ecs) are refused here, before a
// deployment is recorded or any traffic moves.
func For(svc config.Service) (Driver, error) {
	capEntry, known := capability.TargetFor(svc.Target)
	if !known {
		return nil, fmt.Errorf("unknown target %q for %s (simulated | kubernetes; ecs is unsupported)", svc.Target, svc.Name)
	}
	if err := capEntry.Check(capability.OpPrepare); err != nil {
		return nil, fmt.Errorf("%s: %w", svc.Name, err)
	}
	switch capEntry.Name {
	case "simulated":
		return &Simulated{}, nil
	case "kubernetes":
		return &Kubernetes{}, nil
	default:
		return nil, fmt.Errorf("%s: target %s has no driver: %w", svc.Name, capEntry.Name, capability.ErrUnsupported)
	}
}

// Simulated records traffic changes in memory. It is the default target, so
// the whole release loop can be exercised without any infrastructure.
type Simulated struct {
	mu       sync.Mutex
	Prepared []string // images passed to Prepare
	Weights  []int
}

func (s *Simulated) Name() string { return "simulated" }

func (s *Simulated) Prepare(_ context.Context, _ config.Service, image string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Prepared = append(s.Prepared, image)
	return nil
}

func (s *Simulated) SetWeight(_ context.Context, _ config.Service, _ int, weight int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Weights = append(s.Weights, weight)
	return nil
}

func (s *Simulated) Promote(ctx context.Context, svc config.Service) error {
	return s.SetWeight(ctx, svc, -1, 100)
}

func (s *Simulated) Rollback(ctx context.Context, svc config.Service) error {
	return s.SetWeight(ctx, svc, -1, 0)
}

// Kubernetes drives an Argo Rollouts resource named after the service, using
// the kubectl argo rollouts plugin. Prepare sets the image, which starts the
// Rollout at its first canary step; each later SetWeight advances one paused
// step. The weights Argo applies come from the Rollout spec, not from Alror's
// plan, and are not read back: they are requests, not observations.
type Kubernetes struct {
	// Run executes kubectl; nil uses the real binary. Tests replace it.
	Run func(ctx context.Context, args ...string) error
}

func (k *Kubernetes) Name() string { return "kubernetes" }

func (k *Kubernetes) Prepare(ctx context.Context, svc config.Service, image string) error {
	if image == "" {
		return fmt.Errorf("kubernetes: an image is required")
	}
	return k.kubectl(ctx, svc, "argo", "rollouts", "set", "image", svc.Name, svc.Name+"="+image)
}

func (k *Kubernetes) SetWeight(ctx context.Context, svc config.Service, step, _ int) error {
	if step == 0 {
		// Setting the image already started the canary at the Rollout's first step.
		return nil
	}
	return k.kubectl(ctx, svc, "argo", "rollouts", "promote", svc.Name)
}

func (k *Kubernetes) Promote(ctx context.Context, svc config.Service) error {
	return k.kubectl(ctx, svc, "argo", "rollouts", "promote", svc.Name, "--full")
}

func (k *Kubernetes) Rollback(ctx context.Context, svc config.Service) error {
	return k.kubectl(ctx, svc, "argo", "rollouts", "abort", svc.Name)
}

func (k *Kubernetes) kubectl(ctx context.Context, svc config.Service, args ...string) error {
	if svc.Cluster != "" {
		args = append(args, "--context", svc.Cluster)
	}
	if svc.Namespace != "" {
		args = append(args, "-n", svc.Namespace)
	}
	if k.Run != nil {
		return k.Run(ctx, args...)
	}
	cmd := exec.CommandContext(ctx, "kubectl", args...)
	var errb bytes.Buffer
	cmd.Stderr = &errb
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(errb.String()); msg != "" {
			return fmt.Errorf("kubectl %s: %v: %s", strings.Join(args, " "), err, msg)
		}
		return fmt.Errorf("kubectl %s: %v", strings.Join(args, " "), err)
	}
	return nil
}
