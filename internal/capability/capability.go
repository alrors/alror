// Package capability is the single source of truth for what each deployment
// target and metrics provider can actually do. The CLI prints it, the docs
// embed it (a test keeps them in sync), and the engine reads it to decide
// how to describe what happened: a requested traffic change is never
// reported as an observed one.
package capability

import (
	"errors"
	"fmt"
	"strings"
)

// Maturity is how much a capability can be trusted.
type Maturity string

const (
	// Verified means the operation has end-to-end evidence (tests against a
	// real system, observed effect). Nothing in Alror is verified yet.
	Verified Maturity = "verified"
	// Experimental means the operation calls real infrastructure but has no
	// end-to-end evidence; Alror reports only that it was requested.
	Experimental Maturity = "experimental"
	// Simulated means the operation only changes in-memory or generated state.
	Simulated Maturity = "simulated"
	// Unsupported means the operation is not implemented and is refused.
	Unsupported Maturity = "unsupported"
)

// Operation is one thing a target can be asked to do.
type Operation string

const (
	OpPrepare  Operation = "prepare_image"   // point the workload at the new image, once, before the first step
	OpShift    Operation = "shift_traffic"   // move the canary to a step's weight
	OpPromote  Operation = "promote"         // send all traffic to the new version
	OpRollback Operation = "rollback"        // return traffic to the stable version
	OpObserve  Operation = "observe_traffic" // read back the traffic split actually applied
	OpDetect   Operation = "detect_release"  // notice an image change made outside Alror (`alror runner --watch`)
)

// Operations lists every operation in display order.
var Operations = []Operation{OpPrepare, OpShift, OpPromote, OpRollback, OpObserve, OpDetect}

// Target describes one deployment target.
type Target struct {
	Name  string                 `json:"name"`
	Ops   map[Operation]Maturity `json:"operations"`
	Notes string                 `json:"notes"`
}

// Provider describes one metrics provider.
type Provider struct {
	Name     string   `json:"name"`
	Maturity Maturity `json:"maturity"`
	Notes    string   `json:"notes"`
}

// Targets is the target matrix.
var Targets = []Target{
	{Name: "simulated", Notes: "Records weights in memory. For demos and tests; nothing is deployed, so there is no release to detect.",
		Ops: map[Operation]Maturity{OpPrepare: Simulated, OpShift: Simulated, OpPromote: Simulated, OpRollback: Simulated, OpObserve: Simulated, OpDetect: Unsupported}},
	{Name: "kubernetes", Notes: "Argo Rollouts via `kubectl argo rollouts`: set image once, then promote/abort. The Rollout's own steps decide the real weights; Alror's step weights are requests and are not read back. Release detection polls the Rollout's pod template image with `kubectl get`.",
		Ops: map[Operation]Maturity{OpPrepare: Experimental, OpShift: Experimental, OpPromote: Experimental, OpRollback: Experimental, OpObserve: Unsupported, OpDetect: Experimental}},
	{Name: "ecs", Notes: "Not implemented. Deploys, rollbacks and release detection on an ecs target are refused.",
		Ops: map[Operation]Maturity{OpPrepare: Unsupported, OpShift: Unsupported, OpPromote: Unsupported, OpRollback: Unsupported, OpObserve: Unsupported, OpDetect: Unsupported}},
}

// Providers is the metrics provider matrix.
var Providers = []Provider{
	{Name: "synthetic", Maturity: Simulated, Notes: "Generated samples. Never production verification; refused for non-simulated targets unless `policy.allow_synthetic_telemetry` is set."},
	{Name: "prometheus", Maturity: Experimental, Notes: "Real query_range data. Verdicts depend on your queries; empty or non-finite results never pass."},
	{Name: "datadog", Maturity: Experimental, Notes: "Real metrics API data. Verdicts depend on your queries; empty or non-finite results never pass."},
}

// ErrUnsupported is returned for an operation a target cannot perform.
var ErrUnsupported = errors.New("unsupported")

// TargetFor returns the capability entry for a target name ("" is simulated).
func TargetFor(name string) (Target, bool) {
	if name == "" {
		name = "simulated"
	}
	for _, t := range Targets {
		if t.Name == name {
			return t, true
		}
	}
	return Target{}, false
}

// ProviderFor returns the capability entry for a metrics provider ("" is synthetic).
func ProviderFor(name string) (Provider, bool) {
	if name == "" {
		name = "synthetic"
	}
	for _, p := range Providers {
		if p.Name == name {
			return p, true
		}
	}
	return Provider{}, false
}

// Maturity returns the maturity of one operation (Unsupported if unknown).
func (t Target) Maturity(op Operation) Maturity {
	if m, ok := t.Ops[op]; ok {
		return m
	}
	return Unsupported
}

// Check returns an ErrUnsupported error when the target cannot perform op.
func (t Target) Check(op Operation) error {
	if t.Maturity(op) == Unsupported {
		return fmt.Errorf("target %s: %s is %w (see `alror capabilities`)", t.Name, op, ErrUnsupported)
	}
	return nil
}

// Overall is the least mature of the operations a rollout needs
// (prepare, shift, promote, rollback); observe and detect are reported separately.
func (t Target) Overall() Maturity {
	rank := map[Maturity]int{Verified: 3, Experimental: 2, Simulated: 1, Unsupported: 0}
	out := Verified
	for _, op := range []Operation{OpPrepare, OpShift, OpPromote, OpRollback} {
		if m := t.Maturity(op); rank[m] < rank[out] {
			out = m
		}
	}
	return out
}

// Markdown renders the matrix as the tables embedded in the docs.
func Markdown() string {
	var b strings.Builder
	b.WriteString("| Target | Prepare image | Shift traffic | Promote | Rollback | Observe traffic | Detect release | Notes |\n")
	b.WriteString("| --- | --- | --- | --- | --- | --- | --- | --- |\n")
	for _, t := range Targets {
		fmt.Fprintf(&b, "| `%s` |", t.Name)
		for _, op := range Operations {
			fmt.Fprintf(&b, " %s |", t.Maturity(op))
		}
		fmt.Fprintf(&b, " %s |\n", t.Notes)
	}
	b.WriteString("\n| Metrics provider | Maturity | Notes |\n| --- | --- | --- |\n")
	for _, p := range Providers {
		fmt.Fprintf(&b, "| `%s` | %s | %s |\n", p.Name, p.Maturity, p.Notes)
	}
	return b.String()
}
