package rollout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/alrors/alror/internal/capability"
	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/driver"
	"github.com/alrors/alror/internal/metrics"
	"github.com/alrors/alror/internal/notify"
	"github.com/alrors/alror/internal/store"
	"github.com/alrors/alror/internal/verify"
)

// ErrRollbackFailed means a rollback was needed and the driver returned an
// error. Traffic may still be on the canary: the recovery state is unknown.
// `alror deploy` and `alror rollback` exit with code 4 for it.
var ErrRollbackFailed = errors.New("rollback failed; traffic state unknown")

// ErrSyntheticTelemetry refuses a non-simulated target verified only by the
// synthetic metrics provider (unless policy.allow_synthetic_telemetry is set).
var ErrSyntheticTelemetry = errors.New("synthetic telemetry cannot verify a real target")

// rollbackTimeout bounds a rollback that runs after the rollout's context
// was cancelled (Ctrl-C, lost lease): the rollback itself must still run.
const rollbackTimeout = 2 * time.Minute

// notifyTimeout bounds a notification, which may run after the rollout's
// context was cancelled: the people on call must still hear about it.
const notifyTimeout = 15 * time.Second

// Observer receives live updates; the CLI uses it to draw progress.
type Observer interface {
	Event(domain.Event)
	Progress(step int, fraction float64)
}

// Warner is an optional Observer extension for problems that do not change
// the release's outcome (a notification that could not be sent). Warnings
// are shown live but not stored as events.
type Warner interface {
	Warn(msg string)
}

// ErrInterrupted marks a rollout stopped by its context (Ctrl-C, SIGTERM,
// a lost runner lease). The returned error also wraps the context's cause.
var ErrInterrupted = errors.New("rollout stopped")

// interrupted describes why ctx stopped the rollout, in plain words. A
// cancel cause set with context.WithCancelCause (e.g. a lost lease) names
// itself; a plain cancellation is a signal.
func interrupted(ctx context.Context, err error) error {
	cause := context.Cause(ctx)
	if cause == nil {
		cause = err
	}
	why := "interrupt or SIGTERM"
	switch {
	case errors.Is(cause, context.DeadlineExceeded):
		why = "deadline exceeded"
	case cause != nil && !errors.Is(cause, context.Canceled):
		why = cause.Error()
	}
	return &stopError{why: why, cause: cause}
}

type stopError struct {
	why   string
	cause error
}

func (e *stopError) Error() string   { return "Stopped (" + e.why + ")" }
func (e *stopError) Unwrap() []error { return []error{ErrInterrupted, e.cause} }

// Engine executes a deployment's plan: prepare, shift traffic, bake, verify, decide.
//
// State machine:
//
//	pending → rolling ─┬─ step passes ─→ next step … → promoted
//	                   ├─ step fails, auto_rollback ─→ rolled_back   (rollback failed → failed, recovery rollback_failed)
//	                   ├─ step fails, shadow mode ──→ continue (recommendation logged)
//	                   └─ driver error ─────────────→ failed (rollback attempted; its result is recorded in recovery)
//
// Before the first step the target is marked as controlled by the
// deployment (drivers implementing driver.Marker) and the image is
// prepared once. A failed mark stops the run with nothing changed.
//
// A step "fails" on a measured regression and also on insufficient or
// invalid data: no verdict passes without evidence.
type Engine struct {
	Cfg      *config.Config
	Store    store.Store
	Driver   driver.Driver
	Metrics  metrics.Provider
	Verifier verify.Verifier
	Notifier notify.Notifier
	Observer Observer

	// Wait blocks for a bake period, reporting progress. Tests replace it.
	Wait func(ctx context.Context, d time.Duration, tick func(fraction float64)) error
}

// Preflight checks a service's target and metrics provider against the
// capability matrix before a deployment is recorded or traffic moves. It
// rejects unsupported targets and, for a non-simulated target, synthetic
// telemetry unless policy.allow_synthetic_telemetry is set.
func Preflight(cfg *config.Config, svc config.Service, provider string) error {
	t, ok := capability.TargetFor(svc.Target)
	if !ok {
		return fmt.Errorf("unknown target %q for %s", svc.Target, svc.Name)
	}
	for _, op := range []capability.Operation{capability.OpPrepare, capability.OpShift, capability.OpPromote, capability.OpRollback} {
		if err := t.Check(op); err != nil {
			return fmt.Errorf("%s: %w", svc.Name, err)
		}
	}
	p, ok := capability.ProviderFor(provider)
	if !ok || p.Maturity == capability.Unsupported {
		return fmt.Errorf("metrics provider %q is not supported", provider)
	}
	if p.Maturity == capability.Simulated && t.Name != "simulated" && !cfg.Policy.AllowSyntheticTelemetry {
		return fmt.Errorf("%w: %s targets %s but metrics.provider is %s; configure prometheus or datadog, "+
			"or set policy.allow_synthetic_telemetry: true to run with verdicts labelled synthetic",
			ErrSyntheticTelemetry, svc.Name, t.Name, p.Name)
	}
	return nil
}

// Run drives the deployment to a terminal status. It persists every
// transition, so an interrupted run leaves an accurate record behind.
func (e *Engine) Run(ctx context.Context, d *domain.Deployment) error {
	svc, ok := e.Cfg.Service(d.Service)
	if !ok {
		return fmt.Errorf("unknown service %q", d.Service)
	}
	if e.Notifier == nil {
		e.Notifier = notify.Nop{}
	}
	if e.Wait == nil {
		e.Wait = realWait
	}
	d.Target = targetName(svc)
	if e.Metrics != nil {
		d.Telemetry = e.Metrics.Name()
	}
	if err := Preflight(e.Cfg, svc, d.Telemetry); err != nil {
		d.Status, d.Reason = domain.StatusFailed, err.Error()+" · no traffic was changed"
		e.emit(d, domain.Event{Kind: domain.EventError, Message: d.Reason})
		return err
	}
	routing := routingFor(d.Target)
	synthetic := d.Telemetry == "synthetic"

	d.Status = domain.StatusRolling
	e.emit(d, domain.Event{Kind: domain.EventCreated, Message: fmt.Sprintf(
		"Risk %d (%s) · %s plan with %d steps · target %s · telemetry %s%s",
		d.Risk.Score, d.Risk.Level, d.Plan.Strategy, len(d.Plan.Steps), describeTarget(d.Target), describeTelemetry(d.Telemetry), describeBakeScale(e.Cfg.Policy.BakeScale))})

	// Record on the target which deployment controls it before the image
	// changes, so release detection never starts a second release for it.
	// Nothing has moved yet, so a failure here needs no rollback.
	if m, ok := e.Driver.(driver.Marker); ok {
		if err := m.Mark(ctx, svc, d.ID, d.Image); err != nil {
			d.Status, d.Reason = domain.StatusFailed, fmt.Sprintf("mark %s as controlled by %s: %v · no traffic was changed", d.Service, d.ID, err)
			e.emit(d, domain.Event{Kind: domain.EventError, Message: d.Reason})
			return fmt.Errorf("mark target: %w", err)
		}
	}

	// The image is prepared once, independent of the first step's weight.
	if err := e.Driver.Prepare(ctx, svc, d.Image); err != nil {
		return e.fail(ctx, d, svc, fmt.Errorf("prepare image: %w", err))
	}

	allPassed := true
	for i, step := range d.Plan.Steps {
		d.StepIndex, d.Weight = i, step.Weight

		if step.Weight >= 100 {
			if err := e.Driver.Promote(ctx, svc); err != nil {
				return e.fail(ctx, d, svc, err)
			}
			d.Status = domain.StatusPromoted
			msg := promotedMessage(d.Service, routing, synthetic, allPassed)
			e.emit(d, domain.Event{Kind: domain.EventPromoted, Weight: 100, Message: msg, Routing: routing})
			e.notify(ctx, d, msg)
			return nil
		}

		if err := e.Driver.SetWeight(ctx, svc, i, step.Weight); err != nil {
			return e.fail(ctx, d, svc, err)
		}
		e.emit(d, domain.Event{Kind: domain.EventStep, Weight: step.Weight, Routing: routing, Message: stepMessage(step, routing, e.Cfg.Bake(step.Bake))})

		if err := e.Wait(ctx, e.Cfg.Bake(step.Bake), func(f float64) {
			if e.Observer != nil {
				e.Observer.Progress(i, f)
			}
		}); err != nil {
			return e.fail(ctx, d, svc, interrupted(ctx, err))
		}

		verdict, err := e.judge(ctx, d.Service, step.Bake)
		if err != nil {
			return e.fail(ctx, d, svc, err)
		}
		if synthetic {
			verdict.Evidence = domain.EvidenceSynthetic
		} else {
			verdict.Evidence = domain.EvidenceMeasured
		}
		e.emit(d, domain.Event{Kind: domain.EventVerdict, Weight: step.Weight, Message: verdict.Summary, Verdict: &verdict})

		if verdict.Pass {
			continue
		}
		allPassed = false
		if !e.Cfg.Policy.AutoRollback {
			e.emit(d, domain.Event{Kind: domain.EventVerdict, Weight: step.Weight,
				Message: "Shadow mode: would roll back here; continuing because auto_rollback is off"})
			continue
		}
		if err := e.rollback(ctx, svc); err != nil {
			return e.rollbackFailed(ctx, d, verdict.Summary, err)
		}
		d.Status, d.Reason, d.Recovery = domain.StatusRolledBack, verdict.Summary, recoveryFor(routing)
		e.emit(d, domain.Event{Kind: domain.EventRolledBack, Weight: step.Weight, Routing: routing, Message: fmt.Sprintf(
			"Rolled back at %d%% traffic · %s%s", step.Weight, verdict.Summary, recoveryNote(routing))})
		e.notify(ctx, d, verdict.Summary)
		return nil
	}
	return nil
}

// Rollback reverses a deployment on request (`alror rollback`). A driver
// error leaves the status as it was, records recovery rollback_failed and
// returns an error wrapping ErrRollbackFailed.
func (e *Engine) Rollback(ctx context.Context, d *domain.Deployment, reason string) error {
	svc, ok := e.Cfg.Service(d.Service)
	if !ok {
		return fmt.Errorf("unknown service %q", d.Service)
	}
	routing := routingFor(targetName(svc))
	if err := e.rollback(ctx, svc); err != nil {
		d.Recovery = domain.RecoveryFailed
		e.emit(d, domain.Event{Kind: domain.EventError, Message: fmt.Sprintf(
			"Manual rollback failed · %v · traffic state unknown; check the target before retrying", err)})
		return fmt.Errorf("%w: %v", ErrRollbackFailed, err)
	}
	d.Status, d.Reason, d.Weight, d.Recovery = domain.StatusRolledBack, reason, 0, recoveryFor(routing)
	e.emit(d, domain.Event{Kind: domain.EventRolledBack, Routing: routing, Message: "Manual rollback · " + reason + recoveryNote(routing)})
	return nil
}

func (e *Engine) judge(ctx context.Context, service string, window time.Duration) (domain.Verdict, error) {
	names := metrics.Names(e.Cfg)
	data := map[string]verify.Samples{}
	for _, m := range names {
		canary, err := e.Metrics.Sample(ctx, service, m, metrics.Canary, window)
		if err != nil {
			return domain.Verdict{}, err
		}
		baseline, err := e.Metrics.Sample(ctx, service, m, metrics.Baseline, window)
		if err != nil {
			return domain.Verdict{}, err
		}
		data[m] = verify.Samples{Canary: canary, Baseline: baseline}
	}
	v := e.Verifier
	if v.Required == nil {
		v.Required = names
	}
	return v.Judge(data), nil
}

// rollback runs the driver's rollback even when ctx is already cancelled:
// an interrupted rollout is exactly when the canary must be pulled back.
func (e *Engine) rollback(ctx context.Context, svc config.Service) error {
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), rollbackTimeout)
	defer cancel()
	return e.Driver.Rollback(rctx, svc)
}

// fail stops the rollout after an error and attempts a rollback. The
// rollback's own result is recorded; a failed rollback is never reported
// as a restoration.
func (e *Engine) fail(ctx context.Context, d *domain.Deployment, svc config.Service, cause error) error {
	if err := e.rollback(ctx, svc); err != nil {
		return e.rollbackFailed(ctx, d, cause.Error(), err)
	}
	routing := routingFor(d.Target)
	reason, msg := cause.Error(), cause.Error()+recoveryNote(routing)
	if errors.Is(cause, ErrInterrupted) {
		reason = cause.Error() + stoppedNote(routing)
		msg = reason
	}
	d.Status, d.Reason, d.Recovery = domain.StatusFailed, reason, recoveryFor(routing)
	e.emit(d, domain.Event{Kind: domain.EventError, Weight: d.Weight, Routing: routing, Message: msg})
	e.notify(ctx, d, msg)
	return cause
}

func (e *Engine) rollbackFailed(ctx context.Context, d *domain.Deployment, why string, rbErr error) error {
	d.Status, d.Recovery = domain.StatusFailed, domain.RecoveryFailed
	d.Reason = fmt.Sprintf("%s · rollback failed: %v · traffic state unknown", why, rbErr)
	e.emit(d, domain.Event{Kind: domain.EventError, Weight: d.Weight, Message: d.Reason})
	e.notify(ctx, d, d.Reason)
	return fmt.Errorf("%s: %w: %v", why, ErrRollbackFailed, rbErr)
}

// notify tells people about a terminal outcome. It runs even when ctx is
// cancelled (an interrupted rollout must still be reported); a delivery
// error is shown as a warning and never changes the outcome.
func (e *Engine) notify(ctx context.Context, d *domain.Deployment, summary string) {
	nctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), notifyTimeout)
	defer cancel()
	if err := e.Notifier.Notify(nctx, d, summary); err != nil {
		if w, ok := e.Observer.(Warner); ok {
			w.Warn(fmt.Sprintf("Notification not sent: %v · the release outcome is unchanged", err))
		}
	}
}

// stoppedNote completes "Stopped (…)" with what the rollback achieved.
func stoppedNote(routing string) string {
	switch routing {
	case domain.RoutingSimulated:
		return "; canary rolled back (simulated)"
	case domain.RoutingObserved:
		return "; canary rolled back"
	default:
		return "; canary rollback requested, restored traffic not observed"
	}
}

func (e *Engine) emit(d *domain.Deployment, ev domain.Event) {
	ev.At = time.Now().UTC()
	_ = e.Store.Save(d)
	_ = e.Store.Append(d.ID, ev)
	if e.Observer != nil {
		e.Observer.Event(ev)
	}
}

func targetName(svc config.Service) string {
	if svc.Target == "" {
		return "simulated"
	}
	return svc.Target
}

// routingFor says what a traffic event on this target can claim.
func routingFor(target string) string {
	t, ok := capability.TargetFor(target)
	if !ok {
		return domain.RoutingRequested
	}
	switch t.Maturity(capability.OpObserve) {
	case capability.Simulated:
		return domain.RoutingSimulated
	case capability.Verified:
		return domain.RoutingObserved
	default:
		return domain.RoutingRequested
	}
}

func recoveryFor(routing string) string {
	if routing == domain.RoutingSimulated {
		return domain.RecoverySimulated
	}
	return domain.RecoveryRequested
}

func recoveryNote(routing string) string {
	switch routing {
	case domain.RoutingSimulated:
		return " · rollback simulated"
	case domain.RoutingObserved:
		return ""
	default:
		return " · rollback command accepted; restored traffic not observed"
	}
}

func describeTarget(name string) string {
	if t, ok := capability.TargetFor(name); ok {
		return fmt.Sprintf("%s (%s)", name, t.Overall())
	}
	return name
}

func describeTelemetry(name string) string {
	if p, ok := capability.ProviderFor(name); ok {
		if p.Maturity == capability.Simulated {
			return name + " (simulated, not production verification)"
		}
		return fmt.Sprintf("%s (%s)", name, p.Maturity)
	}
	return name
}

func stepMessage(step domain.Step, routing string, bake time.Duration) string {
	b := bake.Round(time.Second)
	if b <= 0 && bake > 0 {
		b = bake.Round(time.Millisecond)
	}
	switch routing {
	case domain.RoutingSimulated:
		return fmt.Sprintf("Canary at %d%% (simulated) · baking %s", step.Weight, b)
	case domain.RoutingObserved:
		return fmt.Sprintf("Canary at %d%% (observed) · baking %s", step.Weight, b)
	default:
		return fmt.Sprintf("Canary %d%% requested · applied split not observed · baking %s", step.Weight, b)
	}
}

func promotedMessage(service, routing string, synthetic, allPassed bool) string {
	var checks string
	switch {
	case !allPassed:
		checks = "promoted despite failed or inconclusive verdicts (shadow mode)"
	case synthetic:
		checks = "every step passed on synthetic telemetry (not production verification)"
	default:
		checks = "every step passed on measured telemetry"
	}
	switch routing {
	case domain.RoutingSimulated:
		return fmt.Sprintf("Simulated rollout · %s · promoted %s to 100%% (simulated)", checks, service)
	case domain.RoutingObserved:
		return fmt.Sprintf("%s · promoted %s to 100%%", capitalize(checks), service)
	default:
		return fmt.Sprintf("%s · promotion of %s to 100%% requested; applied split not observed", capitalize(checks), service)
	}
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func realWait(ctx context.Context, d time.Duration, tick func(float64)) error {
	if d <= 0 {
		tick(1)
		return nil
	}
	start := time.Now()
	t := time.NewTicker(80 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case now := <-t.C:
			f := float64(now.Sub(start)) / float64(d)
			if f >= 1 {
				tick(1)
				return nil
			}
			tick(f)
		}
	}
}

// describeBakeScale notes shortened or lengthened bakes in the created event.
func describeBakeScale(scale float64) string {
	if scale <= 0 || scale == 1 {
		return ""
	}
	return fmt.Sprintf(" · bakes ×%g", scale)
}
