package rollout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/driver"
	"github.com/alrors/alror/internal/metrics"
	"github.com/alrors/alror/internal/notify"
	"github.com/alrors/alror/internal/store"
	"github.com/alrors/alror/internal/verify"
)

// fakeDriver records calls and can fail any operation.
type fakeDriver struct {
	name                     string
	calls                    []string
	failSet, failRollback    error
	rollbackCtxWasCancelled  bool
	rollbackCalledAfterError bool
}

func (f *fakeDriver) Name() string { return f.name }
func (f *fakeDriver) Prepare(_ context.Context, _ config.Service, image string) error {
	f.calls = append(f.calls, "prepare "+image)
	return nil
}
func (f *fakeDriver) SetWeight(_ context.Context, _ config.Service, step, weight int) error {
	f.calls = append(f.calls, fmt.Sprintf("weight %d@%d", weight, step))
	return f.failSet
}
func (f *fakeDriver) Promote(context.Context, config.Service) error {
	f.calls = append(f.calls, "promote")
	return nil
}
func (f *fakeDriver) Rollback(ctx context.Context, _ config.Service) error {
	f.calls = append(f.calls, "rollback")
	f.rollbackCtxWasCancelled = ctx.Err() != nil
	return f.failRollback
}

// emptyMetrics returns no samples, like a Prometheus query that matches nothing.
type emptyMetrics struct{}

func (emptyMetrics) Name() string { return "prometheus" }
func (emptyMetrics) Sample(context.Context, string, string, metrics.Track, time.Duration) ([]float64, error) {
	return nil, nil
}

type setup struct {
	target   string
	level    domain.Level
	drv      driver.Driver
	prov     metrics.Provider
	allowSyn bool
	auto     bool
	ctx      context.Context
	notifier notify.Notifier
	obs      Observer
}

func runWith(t *testing.T, s setup) (*domain.Deployment, []domain.Event, error) {
	t.Helper()
	cfg := config.Default("t")
	cfg.Dir = t.TempDir()
	cfg.Policy.AutoRollback = s.auto
	cfg.Policy.AllowSyntheticTelemetry = s.allowSyn
	cfg.Services[0].Target = s.target
	st, err := store.Open(cfg.StateDir())
	if err != nil {
		t.Fatal(err)
	}
	if s.prov == nil {
		s.prov = metrics.NewSynthetic(nil)
	}
	report := domain.RiskReport{Score: 20, Level: s.level}
	d := &domain.Deployment{ID: store.NewID(), Service: "checkout-api", Image: "img:2", Risk: report, Plan: PlanFor(report), CreatedAt: time.Now()}
	wait := noWait
	if s.ctx != nil {
		wait = func(ctx context.Context, _ time.Duration, tick func(float64)) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			tick(1)
			return nil
		}
	}
	eng := &Engine{Cfg: cfg, Store: st, Driver: s.drv, Metrics: s.prov, Wait: wait, Notifier: s.notifier, Observer: s.obs,
		Verifier: verify.Verifier{MaxRegression: cfg.Policy.MaxRegression, Alpha: cfg.Policy.Alpha}}
	ctx := s.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	runErr := eng.Run(ctx, d)
	events, _ := st.Events(d.ID)
	return d, events, runErr
}

func TestLowRiskPlanAt25PercentStillAppliesTheImage(t *testing.T) {
	var cmds []string
	k := &driver.Kubernetes{Run: func(_ context.Context, args ...string) error {
		cmds = append(cmds, strings.Join(args, " "))
		return nil
	}}
	d, events, err := runWith(t, setup{target: "kubernetes", level: domain.LevelLow, drv: k, allowSyn: true, auto: true})
	if err != nil || d.Status != domain.StatusPromoted {
		t.Fatalf("status %s, err %v (%s)", d.Status, err, d.Reason)
	}
	want := []string{
		// The control mark comes first, so release detection never mistakes this change for an external one.
		"annotate rollouts.argoproj.io checkout-api alror.dev/controlled-by=" + d.ID + " alror.dev/image=img:2 --overwrite",
		"argo rollouts set image checkout-api checkout-api=img:2",
		"argo rollouts promote checkout-api --full",
	}
	if strings.Join(cmds, "\n") != strings.Join(want, "\n") {
		t.Fatalf("kubectl calls:\n%s\nwant:\n%s", strings.Join(cmds, "\n"), strings.Join(want, "\n"))
	}
	for _, e := range events {
		if e.Kind == domain.EventStep && (e.Routing != domain.RoutingRequested || !strings.Contains(e.Message, "requested")) {
			t.Fatalf("a kubernetes step must be reported as requested, not observed: %+v", e)
		}
		if e.Kind == domain.EventPromoted && (strings.Contains(e.Message, "Verified") || !strings.Contains(e.Message, "synthetic")) {
			t.Fatalf("promotion message overclaims: %q", e.Message)
		}
		if e.Kind == domain.EventVerdict && e.Verdict != nil && e.Verdict.Evidence != domain.EvidenceSynthetic {
			t.Fatalf("synthetic verdicts must be labelled: %+v", e.Verdict)
		}
	}
}

func TestImageIsPreparedOnceAcrossLowWeightSteps(t *testing.T) {
	var cmds []string
	k := &driver.Kubernetes{Run: func(_ context.Context, args ...string) error {
		cmds = append(cmds, strings.Join(args, " "))
		return nil
	}}
	d, _, err := runWith(t, setup{target: "kubernetes", level: domain.LevelHigh, drv: k, allowSyn: true, auto: true})
	if err != nil || d.Status != domain.StatusPromoted {
		t.Fatalf("status %s, err %v (%s)", d.Status, err, d.Reason)
	}
	sets, promotes := 0, 0
	for _, c := range cmds {
		if strings.Contains(c, "set image") {
			sets++
		}
		if strings.HasSuffix(c, "promote checkout-api") {
			promotes++
		}
	}
	// High risk is 1 → 5 → 25 → 50 → 100: one image change, then one promote per later step, then --full.
	if sets != 1 || promotes != 3 || !strings.HasSuffix(cmds[len(cmds)-1], "--full") ||
		!strings.HasPrefix(cmds[0], "annotate ") || !strings.Contains(cmds[1], "set image") {
		t.Fatalf("kubectl calls: %q", cmds)
	}
}

func TestPrepareRunsBeforeFirstStep(t *testing.T) {
	f := &fakeDriver{name: "simulated"}
	d, _, err := runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: f, auto: true})
	if err != nil || d.Status != domain.StatusPromoted {
		t.Fatalf("status %s, err %v", d.Status, err)
	}
	if got := strings.Join(f.calls, ","); got != "prepare img:2,weight 25@0,promote" {
		t.Fatalf("calls = %s", got)
	}
	if d.Target != "simulated" || d.Telemetry != "synthetic" {
		t.Fatalf("deployment should record its evidence sources: %+v", d)
	}
}

func TestSyntheticTelemetryIsRefusedForRealTargets(t *testing.T) {
	f := &fakeDriver{name: "kubernetes"}
	d, _, err := runWith(t, setup{target: "kubernetes", level: domain.LevelLow, drv: f, auto: true})
	if !errors.Is(err, ErrSyntheticTelemetry) || d.Status != domain.StatusFailed || len(f.calls) != 0 {
		t.Fatalf("err %v, status %s, calls %v", err, d.Status, f.calls)
	}
	if !strings.Contains(d.Reason, "no traffic was changed") {
		t.Fatalf("reason = %q", d.Reason)
	}
}

func TestUnsupportedTargetIsRefused(t *testing.T) {
	f := &fakeDriver{name: "ecs"}
	_, _, err := runWith(t, setup{target: "ecs", level: domain.LevelLow, drv: f, prov: emptyMetrics{}, auto: true})
	if err == nil || !strings.Contains(err.Error(), "unsupported") || len(f.calls) != 0 {
		t.Fatalf("ecs must be refused before any driver call: err %v, calls %v", err, f.calls)
	}
	if _, err := driver.For(config.Service{Name: "x", Target: "ecs"}); err == nil {
		t.Fatal("driver.For must refuse ecs")
	}
}

func TestEmptyTelemetryRollsBackAsInsufficientData(t *testing.T) {
	f := &fakeDriver{name: "simulated"}
	d, events, err := runWith(t, setup{target: "simulated", level: domain.LevelMedium, drv: f, prov: emptyMetrics{}, auto: true})
	if err != nil || d.Status != domain.StatusRolledBack || d.Recovery != domain.RecoverySimulated {
		t.Fatalf("status %s, recovery %s, err %v", d.Status, d.Recovery, err)
	}
	if !strings.HasPrefix(d.Reason, "Insufficient data") {
		t.Fatalf("reason should say the data was insufficient, not a regression: %q", d.Reason)
	}
	for _, e := range events {
		if e.Verdict != nil && (e.Verdict.Pass || e.Verdict.Outcome != domain.OutcomeInsufficientData || e.Verdict.Evidence != domain.EvidenceMeasured) {
			t.Fatalf("verdict = %+v", e.Verdict)
		}
	}
}

func TestFailedRollbackIsReportedAsUnknownState(t *testing.T) {
	f := &fakeDriver{name: "simulated", failRollback: errors.New("abort timed out")}
	d, events, err := runWith(t, setup{target: "simulated", level: domain.LevelMedium, drv: f, prov: metrics.NewSynthetic(map[string]float64{"error_rate": 1.8}), auto: true})
	if !errors.Is(err, ErrRollbackFailed) {
		t.Fatalf("want ErrRollbackFailed, got %v", err)
	}
	if d.Status != domain.StatusFailed || d.Recovery != domain.RecoveryFailed || !strings.Contains(d.Reason, "traffic state unknown") {
		t.Fatalf("deployment = %+v", d)
	}
	for _, e := range events {
		if e.Kind == domain.EventRolledBack {
			t.Fatalf("a failed rollback must not emit rolled_back: %+v", e)
		}
	}
	if n := strings.Count(strings.Join(f.calls, ","), "rollback"); n != 1 {
		t.Fatalf("rollback attempted %d times: %v", n, f.calls)
	}
}

func TestDriverErrorRecordsRollbackResult(t *testing.T) {
	f := &fakeDriver{name: "simulated", failSet: errors.New("api down")}
	d, _, err := runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: f, auto: true})
	if err == nil || errors.Is(err, ErrRollbackFailed) || d.Status != domain.StatusFailed || d.Recovery != domain.RecoverySimulated {
		t.Fatalf("err %v, status %s, recovery %s", err, d.Status, d.Recovery)
	}

	f = &fakeDriver{name: "simulated", failSet: errors.New("api down"), failRollback: errors.New("still down")}
	d, _, err = runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: f, auto: true})
	if !errors.Is(err, ErrRollbackFailed) || d.Recovery != domain.RecoveryFailed || !strings.Contains(d.Reason, "api down") {
		t.Fatalf("err %v, deployment %+v", err, d)
	}
}

func TestInterruptedRolloutStillRollsBack(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f := &fakeDriver{name: "simulated"}
	cfgWait := func(ctx context.Context, _ time.Duration, _ func(float64)) error { return ctx.Err() }
	cfg := config.Default("t")
	cfg.Dir = t.TempDir()
	st, _ := store.Open(cfg.StateDir())
	report := domain.RiskReport{Level: domain.LevelLow}
	d := &domain.Deployment{ID: store.NewID(), Service: "checkout-api", Image: "img:2", Risk: report, Plan: PlanFor(report)}
	eng := &Engine{Cfg: cfg, Store: st, Driver: f, Metrics: metrics.NewSynthetic(nil), Wait: cfgWait}
	err := eng.Run(ctx, d)
	if !errors.Is(err, ErrInterrupted) || !errors.Is(err, context.Canceled) {
		t.Fatalf("interrupted run should return ErrInterrupted wrapping the cancellation, got %v", err)
	}
	if want := "Stopped (interrupt or SIGTERM); canary rolled back (simulated)"; d.Reason != want {
		t.Fatalf("reason = %q, want %q", d.Reason, want)
	}
	if f.rollbackCtxWasCancelled || d.Recovery != domain.RecoverySimulated {
		t.Fatalf("rollback must run with a live context: cancelled=%v recovery=%s", f.rollbackCtxWasCancelled, d.Recovery)
	}
}

func TestManualRollbackFailureIsNotRestoration(t *testing.T) {
	cfg := config.Default("t")
	cfg.Dir = t.TempDir()
	st, _ := store.Open(cfg.StateDir())
	d := &domain.Deployment{ID: store.NewID(), Service: "checkout-api", Status: domain.StatusPromoted, Weight: 100}
	eng := &Engine{Cfg: cfg, Store: st, Driver: &fakeDriver{failRollback: errors.New("denied")}}
	err := eng.Rollback(context.Background(), d, "pager")
	if !errors.Is(err, ErrRollbackFailed) || d.Status != domain.StatusPromoted || d.Recovery != domain.RecoveryFailed {
		t.Fatalf("err %v, deployment %+v", err, d)
	}
}
