// Package config loads alror.yaml, the per-repository configuration file.
package config

import (
	"errors"
	"fmt"
	"maps"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// FileName is the configuration file Alror looks for, walking up from the working directory.
const FileName = "alror.yaml"

// Config is the root of alror.yaml.
type Config struct {
	Project  string    `yaml:"project" json:"project"`
	Server   string    `yaml:"server,omitempty" json:"-"` // Alror workspace URL; empty = local mode
	Services []Service `yaml:"services" json:"services"`
	Metrics  Metrics   `yaml:"metrics" json:"metrics"`
	Policy   Policy    `yaml:"policy" json:"policy"`
	Notify   Notify    `yaml:"notify" json:"notify"`
	Watch    Watch     `yaml:"watch,omitempty" json:"-"`
	// Risk holds optional per-organisation adjustments to the shared risk
	// rules. The portal serves learned weights here once an admin accepts a
	// tuning proposal; nil (the default) scores with the shared rules as is.
	Risk *Risk `yaml:"risk,omitempty" json:"risk,omitempty"`

	// Dir is the directory that holds alror.yaml (not serialised).
	Dir string `yaml:"-" json:"-"`
}

// Service maps source paths to a deployable unit and its target.
type Service struct {
	Name      string   `yaml:"name" json:"name"`
	Paths     []string `yaml:"paths" json:"paths"`                   // glob-ish prefixes, e.g. services/checkout/
	Target    string   `yaml:"target" json:"target"`                 // simulated | kubernetes | ecs
	Cluster   string   `yaml:"cluster,omitempty" json:"cluster"`     // kube context or ECS cluster
	Namespace string   `yaml:"namespace,omitempty" json:"namespace"` // kube namespace
	Critical  bool     `yaml:"critical,omitempty" json:"critical"`   // raises risk when touched
	// Detect enrols the service in release detection: `alror runner --watch`
	// starts a release when its Rollout's image changes outside Alror.
	Detect bool `yaml:"detect,omitempty" json:"detect,omitempty"`
	// RollbackMode overrides policy.auto_rollback for this service: "auto"
	// rolls back without a human, "shadow" only recommends. Empty follows the
	// policy. The portal's trust ramp sets it per service.
	RollbackMode string `yaml:"rollback_mode,omitempty" json:"rollback_mode,omitempty"`
	// Policy overrides the organisation policy for this service only (set by
	// accepted tuning proposals in the portal). Nil means the org policy.
	Policy *ServicePolicy `yaml:"policy,omitempty" json:"policy,omitempty"`
}

// ServicePolicy is a per-service override of Policy. Metrics listed in
// MaxRegression or MaxIncrease replace the org value for that metric only;
// a positive BakeScale multiplies the org bake scale.
type ServicePolicy struct {
	MaxRegression map[string]float64 `yaml:"max_regression,omitempty" json:"max_regression,omitempty"`
	MaxIncrease   map[string]float64 `yaml:"max_increase,omitempty" json:"max_increase,omitempty"`
	BakeScale     float64            `yaml:"bake_scale,omitempty" json:"bake_scale,omitempty"`
}

// Risk adjusts the shared risk rules for one organisation.
type Risk struct {
	// Weights multiplies the points of a shared-rules factor, keyed by the
	// factor's key in rules.json (no_tests, ai_authored, ...). Missing keys
	// keep the rule's points; values are clamped to [0, MaxRiskWeight].
	Weights map[string]float64 `yaml:"weights,omitempty" json:"weights,omitempty"`
}

// MaxRiskWeight caps a factor weight, whatever the source says.
const MaxRiskWeight = 4.0

// Weight returns the multiplier for a factor key: 1 when unset or invalid.
func (r *Risk) Weight(key string) float64 {
	if r == nil {
		return 1
	}
	w, ok := r.Weights[key]
	if !ok || math.IsNaN(w) || math.IsInf(w, 0) {
		return 1
	}
	return max(0, min(w, MaxRiskWeight))
}

// Watch configures release detection in `alror runner` (experimental). It
// is runner-side configuration: read from the local alror.yaml, never sent
// to the workspace.
type Watch struct {
	// Enabled turns the watcher on, like `alror runner --watch`.
	Enabled bool `yaml:"enabled,omitempty"`
	// Interval between polls of each Rollout (default 15s).
	Interval time.Duration `yaml:"interval,omitempty"`
	// Environment recorded on detected releases in connected mode (default production).
	Environment string `yaml:"environment,omitempty"`
	// State is the file that remembers handled image changes across
	// restarts (default .alror/watch.json next to alror.yaml).
	State string `yaml:"state,omitempty"`
}

// Rollback modes for Service.RollbackMode.
const (
	RollbackAuto   = "auto"
	RollbackShadow = "shadow"
)

// Metrics selects and configures the metrics provider used for verification.
type Metrics struct {
	Provider string `yaml:"provider" json:"provider"` // synthetic | prometheus | datadog
	URL      string `yaml:"url,omitempty" json:"url,omitempty"`
	// Queries per metric name. {{service}} and {{track}} (canary|baseline) are substituted.
	Queries map[string]string `yaml:"queries,omitempty" json:"queries,omitempty"`
}

// Policy holds thresholds for verification and auto-rollback.
type Policy struct {
	// MaxRegression is the relative increase (0.25 = +25%) tolerated per metric.
	MaxRegression map[string]float64 `yaml:"max_regression" json:"max_regression"`
	// MaxIncrease is the absolute increase, in the metric's own units,
	// tolerated when the baseline median is zero and a relative change is
	// undefined. Unset metrics use the verifier's defaults (error_rate 0.01,
	// otherwise 0: any significant increase over a zero baseline fails).
	MaxIncrease map[string]float64 `yaml:"max_increase,omitempty" json:"max_increase,omitempty"`
	// AllowSyntheticTelemetry lets a non-simulated target run with the
	// synthetic metrics provider. Off by default: generated samples are not
	// production verification, so such a deploy is refused before traffic
	// moves. When on, every verdict is still labelled synthetic.
	AllowSyntheticTelemetry bool `yaml:"allow_synthetic_telemetry,omitempty" json:"allow_synthetic_telemetry,omitempty"`
	// Alpha is the significance level for the statistical test.
	Alpha float64 `yaml:"alpha" json:"alpha"`
	// AutoRollback enables rollback without a human. False = shadow mode (recommend only).
	AutoRollback bool `yaml:"auto_rollback" json:"auto_rollback"`
	// BakeScale multiplies every bake time; useful to speed up demos (e.g. 0.01).
	BakeScale float64 `yaml:"bake_scale,omitempty" json:"bake_scale,omitempty"`
}

// Notify configures outbound notifications.
type Notify struct {
	SlackWebhook string `yaml:"slack_webhook,omitempty" json:"slack_webhook,omitempty"`
}

// Default returns a configuration suitable for `alror init`.
func Default(project string) *Config {
	return &Config{
		Project: project,
		Services: []Service{
			{Name: "checkout-api", Paths: []string{"services/checkout/"}, Target: "simulated", Critical: true},
			{Name: "web-frontend", Paths: []string{"web/"}, Target: "simulated"},
		},
		Metrics: Metrics{Provider: "synthetic"},
		Policy: Policy{
			MaxRegression: map[string]float64{"error_rate": 0.25, "latency_p95": 0.15},
			Alpha:         0.05,
			AutoRollback:  true,
		},
	}
}

// Load finds alror.yaml from dir upwards, parses and validates it.
func Load(dir string) (*Config, error) {
	c, err := Read(dir)
	if err != nil {
		return nil, err
	}
	return c, c.Validate()
}

// Read finds alror.yaml from dir upwards and parses it with defaults applied,
// but does not validate it. In connected mode alror.yaml may hold only
// `server:` (and optionally service paths), so it is not required to be complete.
func Read(dir string) (*Config, error) {
	path, err := Find(dir)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var c Config
	if err := yaml.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	c.Dir = filepath.Dir(path)
	c.ApplyDefaults()
	return &c, nil
}

// Path returns the location of alror.yaml for this configuration.
func (c *Config) Path() string { return filepath.Join(c.Dir, FileName) }

// Find walks up from dir until it finds alror.yaml.
func Find(dir string) (string, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	for {
		p := filepath.Join(dir, FileName)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", ErrNotFound
		}
		dir = parent
	}
}

// ErrNotFound means no alror.yaml exists in this directory or any parent.
var ErrNotFound = errors.New("no alror.yaml found (run `alror init`)")

// Save writes the config as YAML to path.
func (c *Config) Save(path string) error {
	raw, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	header := "# Alror configuration. Docs: run `alror docs`.\n"
	return os.WriteFile(path, append([]byte(header), raw...), 0o644)
}

// ApplyDefaults fills in the documented defaults for unset fields.
func (c *Config) ApplyDefaults() {
	if c.Metrics.Provider == "" {
		c.Metrics.Provider = "synthetic"
	}
	if c.Policy.Alpha == 0 {
		c.Policy.Alpha = 0.05
	}
	if c.Policy.MaxRegression == nil {
		c.Policy.MaxRegression = map[string]float64{"error_rate": 0.25, "latency_p95": 0.15}
	}
	if c.Policy.BakeScale == 0 {
		c.Policy.BakeScale = 1
	}
	for i := range c.Services {
		if c.Services[i].Target == "" {
			c.Services[i].Target = "simulated"
		}
	}
}

// Validate checks the configuration for obvious mistakes.
func (c *Config) Validate() error {
	if len(c.Services) == 0 {
		return errors.New("alror.yaml: at least one service is required")
	}
	seen := map[string]bool{}
	for _, s := range c.Services {
		if s.Name == "" {
			return errors.New("alror.yaml: every service needs a name")
		}
		if seen[s.Name] {
			return fmt.Errorf("alror.yaml: duplicate service %q", s.Name)
		}
		seen[s.Name] = true
		switch s.RollbackMode {
		case "", RollbackAuto, RollbackShadow:
		default:
			return fmt.Errorf("alror.yaml: service %q: rollback_mode must be auto or shadow, got %q", s.Name, s.RollbackMode)
		}
		if err := s.Policy.validate(); err != nil {
			return fmt.Errorf("alror.yaml: service %q: policy.%w", s.Name, err)
		}
	}
	return nil
}

func (p *ServicePolicy) validate() error {
	if p == nil {
		return nil
	}
	bad := func(v float64) bool { return v < 0 || math.IsNaN(v) || math.IsInf(v, 0) }
	for name, m := range map[string]map[string]float64{"max_regression": p.MaxRegression, "max_increase": p.MaxIncrease} {
		for k, v := range m {
			if bad(v) {
				return fmt.Errorf("%s.%s must be a non-negative number, got %v", name, k, v)
			}
		}
	}
	if bad(p.BakeScale) {
		return fmt.Errorf("bake_scale must be a non-negative number, got %v", p.BakeScale)
	}
	return nil
}

// AutoRollbackFor reports whether a deploy of svc may roll back without a
// human: the service's rollback_mode when set, otherwise policy.auto_rollback.
func (c *Config) AutoRollbackFor(svc Service) bool {
	switch svc.RollbackMode {
	case RollbackAuto:
		return true
	case RollbackShadow:
		return false
	}
	return c.Policy.AutoRollback
}

// Service returns the service with the given name.
func (c *Config) Service(name string) (Service, bool) {
	for _, s := range c.Services {
		if s.Name == name {
			return s, true
		}
	}
	return Service{}, false
}

// ServicesForPath returns the services whose path prefixes match a changed file.
func (c *Config) ServicesForPath(file string) []Service {
	file = filepath.ToSlash(file)
	var out []Service
	for _, s := range c.Services {
		for _, p := range s.Paths {
			if strings.HasPrefix(file, filepath.ToSlash(p)) {
				out = append(out, s)
				break
			}
		}
	}
	return out
}

// PolicyFor returns the effective policy for a service: the org policy with
// the service's override merged in. Without an override it is the org policy.
func (c *Config) PolicyFor(service string) Policy {
	p := c.Policy
	s, ok := c.Service(service)
	if !ok || s.Policy == nil {
		return p
	}
	o := s.Policy
	if len(o.MaxRegression) > 0 {
		p.MaxRegression = merged(p.MaxRegression, o.MaxRegression)
	}
	if len(o.MaxIncrease) > 0 {
		p.MaxIncrease = merged(p.MaxIncrease, o.MaxIncrease)
	}
	if o.BakeScale > 0 && !math.IsInf(o.BakeScale, 0) {
		base := p.BakeScale
		if base == 0 {
			base = 1
		}
		p.BakeScale = base * o.BakeScale
	}
	return p
}

// UseServicePolicy replaces the org policy with the effective policy for a
// service, so everything downstream (verifier, bake times) honours it.
func (c *Config) UseServicePolicy(service string) { c.Policy = c.PolicyFor(service) }

func merged(base, over map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(base)+len(over))
	maps.Copy(out, base)
	for k, v := range over {
		if v >= 0 && !math.IsNaN(v) && !math.IsInf(v, 0) {
			out[k] = v
		}
	}
	return out
}

// Bake scales a bake duration by the configured BakeScale.
func (c *Config) Bake(d time.Duration) time.Duration {
	return time.Duration(float64(d) * c.Policy.BakeScale)
}

// StateDir is where the file-system store keeps deployments and events.
func (c *Config) StateDir() string {
	return filepath.Join(c.Dir, ".alror")
}
