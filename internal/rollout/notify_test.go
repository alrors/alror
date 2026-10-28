package rollout

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/metrics"
)

// recordingNotifier remembers every outcome it was told about.
type recordingNotifier struct {
	statuses  []domain.Status
	recovery  []string
	summaries []string
	ctxErr    []error
	err       error
}

func (r *recordingNotifier) Notify(ctx context.Context, d *domain.Deployment, summary string) error {
	r.statuses = append(r.statuses, d.Status)
	r.recovery = append(r.recovery, d.Recovery)
	r.summaries = append(r.summaries, summary)
	r.ctxErr = append(r.ctxErr, ctx.Err())
	return r.err
}

type warnObserver struct{ warnings []string }

func (*warnObserver) Event(domain.Event)    {}
func (*warnObserver) Progress(int, float64) {}
func (w *warnObserver) Warn(msg string)     { w.warnings = append(w.warnings, msg) }

func TestEveryTerminalOutcomeIsNotified(t *testing.T) {
	cases := []struct {
		name     string
		s        setup
		status   domain.Status
		recovery string
	}{
		{"promoted", setup{drv: &fakeDriver{name: "simulated"}}, domain.StatusPromoted, ""},
		{"rolled back", setup{drv: &fakeDriver{name: "simulated"}, prov: metrics.NewSynthetic(map[string]float64{"error_rate": 1.8})},
			domain.StatusRolledBack, domain.RecoverySimulated},
		{"failed", setup{drv: &fakeDriver{name: "simulated", failSet: errors.New("api down")}}, domain.StatusFailed, domain.RecoverySimulated},
		{"rollback failed", setup{drv: &fakeDriver{name: "simulated", failSet: errors.New("api down"), failRollback: errors.New("still down")}},
			domain.StatusFailed, domain.RecoveryFailed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			n := &recordingNotifier{}
			c.s.target, c.s.level, c.s.auto, c.s.notifier = "simulated", domain.LevelMedium, true, n
			runWith(t, c.s)
			if len(n.statuses) != 1 || n.statuses[0] != c.status || n.recovery[0] != c.recovery || n.summaries[0] == "" {
				t.Fatalf("notified %v %v %q, want one %s/%s", n.statuses, n.recovery, n.summaries, c.status, c.recovery)
			}
		})
	}
}

func TestInterruptedRolloutIsNotifiedWithLiveContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	n := &recordingNotifier{}
	d, _, _ := runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: &fakeDriver{name: "simulated"}, auto: true, ctx: ctx, notifier: n})
	if d.Status != domain.StatusFailed || len(n.statuses) != 1 || n.ctxErr[0] != nil {
		t.Fatalf("status %s, notified %v, ctx errors %v", d.Status, n.statuses, n.ctxErr)
	}
	if !strings.HasPrefix(n.summaries[0], "Stopped (interrupt or SIGTERM)") {
		t.Fatalf("summary = %q", n.summaries[0])
	}
}

func TestInterruptCauseIsNamed(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	cancel(errors.New("lease lost"))
	d, _, err := runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: &fakeDriver{name: "simulated"}, auto: true, ctx: ctx})
	if !errors.Is(err, ErrInterrupted) || !strings.HasPrefix(d.Reason, "Stopped (lease lost)") {
		t.Fatalf("err %v, reason %q", err, d.Reason)
	}
}

func TestNotifyErrorIsAWarningNotAFailure(t *testing.T) {
	n := &recordingNotifier{err: errors.New("slack webhook: HTTP 500")}
	obs := &warnObserver{}
	d, _, err := runWith(t, setup{target: "simulated", level: domain.LevelLow, drv: &fakeDriver{name: "simulated"}, auto: true, notifier: n, obs: obs})
	if err != nil || d.Status != domain.StatusPromoted {
		t.Fatalf("a failed notification must not change the outcome: %v %s", err, d.Status)
	}
	if len(obs.warnings) != 1 || !strings.Contains(obs.warnings[0], "HTTP 500") {
		t.Fatalf("warnings = %q", obs.warnings)
	}
}
