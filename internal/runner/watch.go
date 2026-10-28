package runner

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/alrors/alror/internal/api"
	"github.com/alrors/alror/internal/capability"
	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/driver"
	"github.com/alrors/alror/internal/metrics"
	"github.com/alrors/alror/internal/notify"
	"github.com/alrors/alror/internal/risk"
	"github.com/alrors/alror/internal/rollout"
	"github.com/alrors/alror/internal/store"
	"github.com/alrors/alror/internal/verify"
)

// Watcher detects releases made outside Alror (experimental). It polls the
// Argo Rollout of every enrolled service and, when the pod template image
// changes and Alror did not make the change, starts one Alror-controlled
// release for it: score, plan, then step, verify and roll back with the
// rollout engine, exactly as `alror deploy` would.
//
// No double control. An image change is ignored when:
//   - the Rollout's alror.dev/controlled-by and alror.dev/image annotations
//     say an Alror deployment set this image (the engine writes them before
//     it changes the image, so CI's `alror deploy` and console jobs are
//     recognised);
//   - the service has an active (pending or rolling) deployment, or its
//     latest deployment already has this image;
//   - the change was already handled (DedupeKey in the state file, which
//     survives restarts);
//   - the Rollout is already fully on this image (no canary in progress).
//
// Otherwise the watcher claims the Rollout with a compare-and-swap
// annotation write (driver.Cluster.Claim with the resourceVersion it read),
// so two runners watching the same Rollout start at most one release.
type Watcher struct {
	Cfg *config.Config
	// Services lists extra services to watch (--watch-service); services
	// with detect: true in the config are always watched.
	Services []string
	Cluster  driver.Cluster // default &driver.KubeCluster{}
	Store    store.Store    // where releases are recorded
	// Client is the workspace client in connected mode (nil in local mode).
	// It lists a service's deployments to find active releases and stored
	// risk decisions.
	Client *api.Client
	State  *WatchState // default: in memory only
	Log    func(Level, string)
	// Refresh, when set, reloads the config before each release (connected
	// mode: GET /config), so policy changes apply without a restart.
	Refresh func(ctx context.Context) (*config.Config, error)
	// Interval between polls (default Cfg.Watch.Interval, else 15 s).
	Interval time.Duration
	// Environment is recorded on releases in connected mode (default production).
	Environment string
	// JobContext bounds running releases (default context.Background()).
	// Cancelling it aborts them, and the engine rolls the canary back.
	JobContext context.Context

	// Test hooks.
	Wait       func(ctx context.Context, d time.Duration, tick func(float64)) error
	NewDriver  func(config.Service) (driver.Driver, error)
	NewMetrics func(*config.Config) (metrics.Provider, error)
	Now        func() time.Time

	mu      sync.Mutex
	busy    map[string]bool   // services with a release in flight
	lastRV  map[string]string // resourceVersion already evaluated, per service
	lastMsg map[string]string // last warning per service, to avoid repeating it every poll
	wg      sync.WaitGroup
}

// ErrNothingToWatch means no enrolled service can be watched.
var ErrNothingToWatch = errors.New("release detection: no service can be watched")

// staleAfter is how long a non-terminal deployment without updates still
// counts as controlling its service. The engine saves on every step, so a
// live release is updated far more often; older ones were interrupted.
const staleAfter = 2 * time.Hour

func (w *Watcher) defaults() {
	if w.Cluster == nil {
		w.Cluster = &driver.KubeCluster{}
	}
	if w.State == nil {
		w.State, _ = OpenWatchState("")
	}
	if w.Log == nil {
		w.Log = func(Level, string) {}
	}
	if w.Interval <= 0 {
		w.Interval = w.Cfg.Watch.Interval
	}
	if w.Interval <= 0 {
		w.Interval = 15 * time.Second
	}
	if w.Environment == "" {
		w.Environment = w.Cfg.Watch.Environment
	}
	if w.Environment == "" {
		w.Environment = "production"
	}
	if w.JobContext == nil {
		w.JobContext = context.Background()
	}
	if w.NewDriver == nil {
		w.NewDriver = driver.For
	}
	if w.NewMetrics == nil {
		w.NewMetrics = metrics.New
	}
	if w.Now == nil {
		w.Now = time.Now
	}
	if w.busy == nil {
		w.busy, w.lastRV, w.lastMsg = map[string]bool{}, map[string]string{}, map[string]string{}
	}
}

// CheckDetect reports why a service cannot be watched: its target cannot
// detect releases (capability matrix), or a release could not run on it
// (Preflight: unsupported target, synthetic telemetry on a real target).
func CheckDetect(cfg *config.Config, svc config.Service, provider string) error {
	t, ok := capability.TargetFor(svc.Target)
	if !ok {
		return fmt.Errorf("unknown target %q", svc.Target)
	}
	if err := t.Check(capability.OpDetect); err != nil {
		return err
	}
	return rollout.Preflight(cfg, svc, provider)
}

// Enrolled returns the services to watch (detect: true plus Services) and
// logs, without simulating anything, every enrolled service that cannot be watched.
func (w *Watcher) Enrolled() []config.Service {
	w.defaults()
	provider := w.Cfg.Metrics.Provider
	if prov, err := w.NewMetrics(w.Cfg); err == nil {
		provider = prov.Name()
	} else {
		w.Log(Error, fmt.Sprintf("watch: metrics: %v", err))
		return nil
	}
	want := map[string]bool{}
	for _, name := range w.Services {
		want[name] = true
		if _, ok := w.Cfg.Service(name); !ok {
			w.Log(Error, fmt.Sprintf("watch %s: unknown service", name))
		}
	}
	var out []config.Service
	for _, s := range w.Cfg.Services {
		if !s.Detect && !want[s.Name] {
			continue
		}
		if err := CheckDetect(w.Cfg, s, provider); err != nil {
			w.Log(Warn, fmt.Sprintf("watch %s: not watched: %v", s.Name, err))
			continue
		}
		out = append(out, s)
		w.Log(Info, fmt.Sprintf("watching %s: Rollout %s every %s (release detection is experimental)", s.Name, rolloutName(s), w.Interval))
	}
	return out
}

// Run polls every enrolled service until ctx is cancelled, then waits for
// releases in flight. With once it polls each service once and waits.
func (w *Watcher) Run(ctx context.Context, once bool) error {
	w.defaults()
	svcs := w.Enrolled()
	if len(svcs) == 0 {
		return ErrNothingToWatch
	}
	if w.State.Path() != "" {
		w.Log(Info, "watch state: "+w.State.Path())
	}
	defer w.wg.Wait()
	for {
		w.Poll(ctx, svcs)
		if once || sleep(ctx, w.Interval) != nil {
			return nil
		}
	}
}

// Poll observes each service once. Releases it starts run in the
// background; Run waits for them.
func (w *Watcher) Poll(ctx context.Context, svcs []config.Service) {
	w.defaults()
	for _, s := range svcs {
		if ctx.Err() != nil {
			return
		}
		w.observe(ctx, s)
	}
}

func (w *Watcher) observe(ctx context.Context, svc config.Service) {
	w.mu.Lock()
	busy := w.busy[svc.Name]
	w.mu.Unlock()
	if busy {
		return
	}
	gctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	ro, err := w.Cluster.Get(gctx, svc)
	cancel()
	if err != nil {
		w.warnOnce(svc.Name, Warn, fmt.Sprintf("watch %s: read Rollout %s: %v", svc.Name, rolloutName(svc), err))
		return
	}
	if ro.ResourceVersion != "" && w.lastRVFor(svc.Name) == ro.ResourceVersion {
		return // nothing changed since the last evaluation
	}
	done := func() { w.setLastRV(svc.Name, ro.ResourceVersion) }

	if ro.WorkloadRef != "" {
		w.warnOnce(svc.Name, Warn, fmt.Sprintf("watch %s: Rollout %s uses workloadRef %s; detection reads the Rollout's own pod template and is unsupported here",
			svc.Name, rolloutName(svc), ro.WorkloadRef))
		done()
		return
	}
	image, ok := ro.Image(svc.Name)
	if !ok {
		w.warnOnce(svc.Name, Warn, fmt.Sprintf("watch %s: Rollout %s has no container named %s (the kubernetes driver sets the image of that container)",
			svc.Name, rolloutName(svc), svc.Name))
		done()
		return
	}
	w.clearWarning(svc.Name)

	last, seen := w.State.Last(svc.Name)
	if !seen {
		// First sight: this is the baseline, not a change.
		w.save(w.State.Seen(svc.Name, image, ro.Generation))
		w.Log(Info, fmt.Sprintf("watch %s: baseline image %s", svc.Name, image))
		done()
		return
	}
	if image == last.Image {
		done()
		return
	}
	if !ro.Reconciled() {
		return // the controller has not caught up; its status would describe the old image
	}
	key := DedupeKey(svc.Name, image)
	if h, ok := w.State.Lookup(key); ok && h.Generation == ro.Generation {
		w.save(w.State.Seen(svc.Name, image, ro.Generation))
		done()
		return
	}

	skip := func(depID, reason string) {
		w.save(w.State.Record(Handled{Service: svc.Name, Image: image, Generation: ro.Generation, DeploymentID: depID, Outcome: "skipped: " + reason}))
		w.Log(Info, fmt.Sprintf("watch %s: image %s · not starting a release: %s", svc.Name, image, reason))
		done()
	}
	if by := ro.Annotations[driver.AnnotationControlledBy]; by != "" && ro.Annotations[driver.AnnotationImage] == image {
		skip(by, "set by Alror deployment "+by)
		return
	}
	other, why, err := w.controlling(ctx, svc.Name, image)
	if err != nil {
		w.warnOnce(svc.Name, Warn, fmt.Sprintf("watch %s: image %s changed, but the workspace could not be checked for an active release (%v); will retry", svc.Name, image, err))
		return
	}
	if other != nil {
		skip(other.ID, why)
		return
	}
	if ro.CurrentPodHash != "" && ro.CurrentPodHash == ro.StableRS {
		skip("", "the Rollout is already fully on this image (no canary to control)")
		return
	}

	commit, how := CommitFor(ro, image)
	id := store.NewID()
	cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	err = w.Cluster.Claim(cctx, svc, ro.ResourceVersion, id, image)
	cancel()
	if err != nil {
		if errors.Is(err, driver.ErrConflict) {
			w.Log(Info, fmt.Sprintf("watch %s: Rollout changed while claiming it; re-reading next poll", svc.Name))
		} else {
			w.warnOnce(svc.Name, Warn, fmt.Sprintf("watch %s: could not claim Rollout %s: %v", svc.Name, rolloutName(svc), err))
		}
		return
	}
	// Remember the change before the release starts: a restart mid-release
	// must not start it again.
	w.save(w.State.Record(Handled{Service: svc.Name, Image: image, Generation: ro.Generation, DeploymentID: id, Outcome: "released"}))
	done()

	det := detection{id: id, svc: svc, image: image, previous: last.Image, commit: commit, how: how}
	w.mu.Lock()
	w.busy[svc.Name] = true
	w.mu.Unlock()
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		defer func() {
			w.mu.Lock()
			delete(w.busy, svc.Name)
			w.mu.Unlock()
		}()
		if err := w.safeRelease(det); err != nil {
			w.Log(Error, fmt.Sprintf("watch %s: release %s for %s: %v", svc.Name, id, image, err))
			w.save(w.State.Update(key, "failed: "+err.Error()))
		}
	}()
}

// controlling returns a deployment that already controls this service:
// an active one (any image), or the latest one when it has this image.
func (w *Watcher) controlling(ctx context.Context, service, image string) (*domain.Deployment, string, error) {
	recent, err := w.recent(ctx, service)
	if err != nil {
		return nil, "", err
	}
	now := w.Now()
	for _, d := range recent {
		if d.Status.Terminal() {
			continue
		}
		if now.Sub(lastUpdate(d)) > staleAfter {
			continue // interrupted long ago; it controls nothing now
		}
		return d, fmt.Sprintf("deployment %s (%s, source %s, image %s) controls the rollout", d.ID, d.Status, orUnknown(d.Source), d.Image), nil
	}
	if len(recent) > 0 && recent[0].Image == image {
		return recent[0], fmt.Sprintf("deployment %s already released this image", recent[0].ID), nil
	}
	return nil, "", nil
}

func lastUpdate(d *domain.Deployment) time.Time {
	if d.UpdatedAt.After(d.CreatedAt) {
		return d.UpdatedAt
	}
	return d.CreatedAt
}

// recent lists a service's latest deployments, newest first.
func (w *Watcher) recent(ctx context.Context, service string) ([]*domain.Deployment, error) {
	if w.Client != nil {
		lctx, cancel := context.WithTimeout(ctx, time.Minute)
		defer cancel()
		return w.Client.ListDeployments(lctx, api.ListOptions{Service: service, Limit: 20})
	}
	all, err := w.Store.List()
	if err != nil {
		return nil, err
	}
	var out []*domain.Deployment
	for _, d := range all {
		if d.Service == service {
			out = append(out, d)
			if len(out) == 20 {
				break
			}
		}
	}
	return out, nil
}

type detection struct {
	id, image, previous string
	commit, how         string
	svc                 config.Service
}

func (w *Watcher) safeRelease(det detection) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("watcher panic: %v", r)
		}
	}()
	return w.release(det)
}

// release runs one detected release with the rollout engine.
func (w *Watcher) release(det detection) error {
	ctx := w.JobContext
	cfg := w.Cfg
	if w.Refresh != nil {
		// Pick up policy and metrics changed in the console since the runner started.
		if fresh, err := w.Refresh(ctx); err == nil {
			cfg = fresh
		} else {
			w.Log(Warn, fmt.Sprintf("%s: could not refresh the config (%v); using the one loaded at start", det.id, err))
		}
	}
	svc, ok := cfg.Service(det.svc.Name)
	if !ok {
		return fmt.Errorf("service %q is no longer configured", det.svc.Name)
	}
	// The service's rollback_mode (trust ramp) wins over the policy default.
	// Work on a copy: cfg may be the watcher's shared config.
	own := *cfg
	own.Policy.AutoRollback = own.AutoRollbackFor(svc)
	cfg = &own
	report, plan := w.score(ctx, cfg, svc, det.commit)
	detail := fmt.Sprintf("Rollout %s changed from %s to %s outside Alror", rolloutName(svc), orNone(det.previous), det.image)
	if det.commit != "" {
		detail += fmt.Sprintf(" · commit %s (from %s)", det.commit, det.how)
	} else {
		detail += " · commit unknown: " + det.how
	}
	report.Factors = append(report.Factors, domain.Factor{Name: "Detected in cluster", Detail: detail})

	drv, err := w.NewDriver(svc)
	if err != nil {
		return err
	}
	prov, err := w.NewMetrics(cfg)
	if err != nil {
		return err
	}
	if err := rollout.Preflight(cfg, svc, prov.Name()); err != nil {
		return err
	}
	server := ""
	if w.Client != nil {
		server = w.Client.Server()
	}
	notifier := notify.For(cfg.Notify.SlackWebhook, server)
	d := &domain.Deployment{
		ID: det.id, Service: svc.Name, Image: det.image, Ref: det.commit,
		Risk: report, Plan: plan, Status: domain.StatusPending, CreatedAt: time.Now().UTC(),
	}
	if w.Client != nil {
		d.Environment, d.Source = w.Environment, "runner"
	}
	if err := w.Store.Save(d); err != nil {
		return fmt.Errorf("record deployment: %w", err)
	}
	commit := det.commit
	if commit == "" {
		commit = "commit unknown"
	}
	w.Log(Info, fmt.Sprintf("%s · detected %s %s (%s) · risk %d (%s) · %s on %s",
		d.ID, d.Service, d.Image, commit, report.Score, report.Level, planWeights(d.Plan), drv.Name()))

	eng := &rollout.Engine{
		Cfg: cfg, Store: w.Store, Driver: drv, Metrics: prov, Notifier: notifier, Wait: w.Wait,
		Observer: &observer{log: w.Log, d: d},
		Verifier: verify.Verifier{MaxRegression: cfg.Policy.MaxRegression, MaxIncrease: cfg.Policy.MaxIncrease, Alpha: cfg.Policy.Alpha},
	}
	runErr := eng.Run(ctx, d)
	if err := w.Store.Save(d); err != nil {
		w.Log(Warn, fmt.Sprintf("%s: could not save the final state: %v", d.ID, err))
	}
	return runErr
}

// score rates a detected change and plans it. Connected mode prefers the
// decision the portal stored for the commit (GET /decisions/{sha}: the
// shared rules plus the org's history, and the pull request it came from);
// otherwise the offline scorer reads the commit from a local git checkout
// (alror.yaml's directory); otherwise the change is treated as medium risk,
// and says so.
func (w *Watcher) score(ctx context.Context, cfg *config.Config, svc config.Service, commit string) (domain.RiskReport, domain.Plan) {
	why := "commit unknown"
	if commit != "" {
		why = "no portal decision or local git checkout for commit " + commit
	}
	if commit != "" && w.Client != nil {
		dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		d, err := w.Client.Decision(dctx, commit)
		cancel()
		switch {
		case err == nil && usablePlan(d.Plan):
			r := d.Risk
			r.Score = max(0, min(r.Score, 100))
			if r.Level != domain.LevelLow && r.Level != domain.LevelMedium && r.Level != domain.LevelHigh {
				r.Level = risk.LevelFor(r.Score)
			}
			pr := fmt.Sprintf("%s#%d", d.Repository, d.PullNumber)
			if d.URL != "" {
				pr += " (" + d.URL + ")"
			}
			r.Factors = append(append([]domain.Factor(nil), r.Factors...), domain.Factor{Name: "Portal decision",
				Detail: fmt.Sprintf("risk and plan stored for commit %s, pull request %s, shared rules v%d", d.SHA, pr, d.RulesVersion)})
			return r, d.Plan
		case err == nil:
			why = "the portal decision for " + commit + " has no usable plan, and no local git checkout has the commit"
		case !errors.Is(err, api.ErrNotFound):
			w.Log(Warn, fmt.Sprintf("watch %s: could not read the portal decision for %s: %v", svc.Name, commit, err))
		}
	}
	if commit != "" && cfg.Dir != "" {
		if change, err := risk.FromCommit(cfg.Dir, commit); err == nil {
			change.RecentRollbacks, _ = w.Store.RecentRollbacks(time.Now().AddDate(0, 0, -30))
			r := risk.Score(cfg, change)
			return r, rollout.PlanFor(r)
		}
	}
	r := domain.RiskReport{Score: 50, Level: domain.LevelMedium, Services: []string{svc.Name},
		Factors: []domain.Factor{{Name: "Default score", Detail: why + "; assuming medium risk", Points: 50}}}
	return r, rollout.PlanFor(r)
}

// usablePlan reports whether a stored plan can drive the engine: steps of
// 1 to 100%, ending with 100% (promote).
func usablePlan(p domain.Plan) bool {
	if len(p.Steps) == 0 || p.Steps[len(p.Steps)-1].Weight != 100 {
		return false
	}
	for _, s := range p.Steps {
		if s.Weight < 1 || s.Weight > 100 || s.Bake < 0 {
			return false
		}
	}
	return true
}

func (w *Watcher) save(err error) {
	if err != nil {
		w.Log(Warn, "watch state: "+err.Error())
	}
}

func (w *Watcher) lastRVFor(service string) string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.lastRV[service]
}

func (w *Watcher) setLastRV(service, rv string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastRV[service] = rv
}

func (w *Watcher) warnOnce(service string, lv Level, msg string) {
	w.mu.Lock()
	repeat := w.lastMsg[service] == msg
	w.lastMsg[service] = msg
	w.mu.Unlock()
	if !repeat {
		w.Log(lv, msg)
	}
}

func (w *Watcher) clearWarning(service string) {
	w.mu.Lock()
	delete(w.lastMsg, service)
	w.mu.Unlock()
}

func rolloutName(s config.Service) string {
	name := s.Name
	if s.Namespace != "" {
		name = s.Namespace + "/" + name
	}
	if s.Cluster != "" {
		name += " (context " + s.Cluster + ")"
	}
	return name
}

func orNone(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}
