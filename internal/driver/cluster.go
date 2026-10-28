package driver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/alrors/alror/internal/config"
)

// Annotations Alror reads and writes on an Argo Rollout.
const (
	// AnnotationControlledBy is the id of the Alror deployment that controls
	// the Rollout's current image. The engine writes it (with
	// AnnotationImage) before it sets the image, so a release detector never
	// mistakes an Alror release for an external change.
	AnnotationControlledBy = "alror.dev/controlled-by"
	// AnnotationImage is the image the controlling deployment set.
	AnnotationImage = "alror.dev/image"
	// AnnotationCommit is the commit SHA a pod template was built from. Alror
	// only reads it (as a pod template annotation or label); your CI or
	// GitOps tooling sets it.
	AnnotationCommit = "alror.dev/commit"
)

// rolloutResource is the fully qualified kind, so a cluster that has
// another "rollout" resource still resolves Argo's.
const rolloutResource = "rollouts.argoproj.io"

// Marker is implemented by drivers that can record on the target which
// deployment controls it. The engine calls Mark once, before Prepare.
type Marker interface {
	Mark(ctx context.Context, svc config.Service, deploymentID, image string) error
}

// Mark annotates the Rollout with the controlling deployment and its image.
func (k *Kubernetes) Mark(ctx context.Context, svc config.Service, deploymentID, image string) error {
	return k.kubectl(ctx, svc, "annotate", rolloutResource, svc.Name,
		AnnotationControlledBy+"="+deploymentID, AnnotationImage+"="+image, "--overwrite")
}

// Rollout is what release detection reads from an Argo Rollout.
type Rollout struct {
	Name, Namespace string
	ResourceVersion string
	Generation      int64
	// ObservedGeneration is the generation the Argo controller last
	// reconciled; -1 when the status does not say.
	ObservedGeneration int64
	// Containers maps container name to image in the pod template.
	Containers map[string]string
	// Annotations are the Rollout's own annotations (where Alror marks control).
	Annotations map[string]string
	// TemplateAnnotations and TemplateLabels come from the pod template,
	// which changes together with the image.
	TemplateAnnotations map[string]string
	TemplateLabels      map[string]string
	// WorkloadRef is set when the Rollout references a Deployment instead
	// of holding its own pod template.
	WorkloadRef string
	// CurrentPodHash and StableRS are the pod template hashes of the desired
	// and the stable ReplicaSet; equal when no canary is in progress.
	CurrentPodHash, StableRS string
	Phase                    string
}

// Image returns the image of the container named after the service, which
// is the container the kubernetes driver sets.
func (r *Rollout) Image(container string) (string, bool) {
	img, ok := r.Containers[container]
	return img, ok
}

// Reconciled reports whether the controller has observed the latest spec,
// so its status (CurrentPodHash, StableRS) describes the current image.
func (r *Rollout) Reconciled() bool {
	return r.ObservedGeneration < 0 || r.ObservedGeneration >= r.Generation
}

// ErrConflict means the Rollout changed since it was read; read it again.
var ErrConflict = errors.New("rollout changed since it was read")

// Cluster reads Argo Rollouts and claims them for a deployment. Release
// detection depends on this interface so tests never shell out.
type Cluster interface {
	Get(ctx context.Context, svc config.Service) (*Rollout, error)
	// Claim writes the control annotations only if the Rollout is still at
	// resourceVersion (compare-and-swap); otherwise it returns ErrConflict.
	// Two runners that see the same change cannot both claim it.
	Claim(ctx context.Context, svc config.Service, resourceVersion, deploymentID, image string) error
}

// KubeCluster implements Cluster with kubectl (no client libraries).
type KubeCluster struct {
	// Exec runs kubectl and returns stdout; nil uses the real binary.
	Exec func(ctx context.Context, args ...string) ([]byte, error)
}

// Get reads the Rollout named after the service.
func (c *KubeCluster) Get(ctx context.Context, svc config.Service) (*Rollout, error) {
	out, err := c.exec(ctx, svc, "get", rolloutResource, svc.Name, "-o", "json")
	if err != nil {
		return nil, err
	}
	return ParseRollout(out)
}

// Claim annotates the Rollout with --resource-version, so the write fails
// when anything (another runner, a CI deploy, a sync) changed it meanwhile.
func (c *KubeCluster) Claim(ctx context.Context, svc config.Service, resourceVersion, deploymentID, image string) error {
	if resourceVersion == "" {
		return fmt.Errorf("claim %s: no resourceVersion to compare against", svc.Name)
	}
	_, err := c.exec(ctx, svc, "annotate", rolloutResource, svc.Name,
		AnnotationControlledBy+"="+deploymentID, AnnotationImage+"="+image,
		"--overwrite", "--resource-version="+resourceVersion)
	if err != nil && isConflict(err) {
		return fmt.Errorf("%w: %v", ErrConflict, err)
	}
	return err
}

func isConflict(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "the object has been modified") || strings.Contains(msg, "conflict")
}

func (c *KubeCluster) exec(ctx context.Context, svc config.Service, args ...string) ([]byte, error) {
	args = scope(svc, args)
	if c.Exec != nil {
		return c.Exec(ctx, args...)
	}
	return runKubectl(ctx, args, true)
}

// ParseRollout decodes `kubectl get rollout -o json`.
func ParseRollout(raw []byte) (*Rollout, error) {
	var doc struct {
		Kind     string `json:"kind"`
		Metadata struct {
			Name            string            `json:"name"`
			Namespace       string            `json:"namespace"`
			ResourceVersion string            `json:"resourceVersion"`
			Generation      int64             `json:"generation"`
			Annotations     map[string]string `json:"annotations"`
		} `json:"metadata"`
		Spec struct {
			WorkloadRef *struct {
				Kind string `json:"kind"`
				Name string `json:"name"`
			} `json:"workloadRef"`
			Template struct {
				Metadata struct {
					Annotations map[string]string `json:"annotations"`
					Labels      map[string]string `json:"labels"`
				} `json:"metadata"`
				Spec struct {
					Containers []struct {
						Name  string `json:"name"`
						Image string `json:"image"`
					} `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
		Status struct {
			// A string in Argo Rollouts' API, a number in some versions.
			ObservedGeneration json.RawMessage `json:"observedGeneration"`
			CurrentPodHash     string          `json:"currentPodHash"`
			StableRS           string          `json:"stableRS"`
			Phase              string          `json:"phase"`
		} `json:"status"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode rollout: %w", err)
	}
	if doc.Kind != "" && doc.Kind != "Rollout" {
		return nil, fmt.Errorf("expected a Rollout, got %s", doc.Kind)
	}
	r := &Rollout{
		Name: doc.Metadata.Name, Namespace: doc.Metadata.Namespace,
		ResourceVersion: doc.Metadata.ResourceVersion, Generation: doc.Metadata.Generation,
		ObservedGeneration:  parseGeneration(doc.Status.ObservedGeneration),
		Containers:          map[string]string{},
		Annotations:         orEmpty(doc.Metadata.Annotations),
		TemplateAnnotations: orEmpty(doc.Spec.Template.Metadata.Annotations),
		TemplateLabels:      orEmpty(doc.Spec.Template.Metadata.Labels),
		CurrentPodHash:      doc.Status.CurrentPodHash, StableRS: doc.Status.StableRS, Phase: doc.Status.Phase,
	}
	if w := doc.Spec.WorkloadRef; w != nil {
		r.WorkloadRef = w.Kind + "/" + w.Name
	}
	for _, c := range doc.Spec.Template.Spec.Containers {
		r.Containers[c.Name] = c.Image
	}
	return r, nil
}

func parseGeneration(raw json.RawMessage) int64 {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if s == "" || s == "null" {
		return -1
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return -1 // very old controllers stored a hash here
	}
	return n
}

func orEmpty(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}
