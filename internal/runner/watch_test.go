package runner

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alrors/alror/internal/api"
	"github.com/alrors/alror/internal/api/apitest"
	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/domain"
	"github.com/alrors/alror/internal/driver"
	"github.com/alrors/alror/internal/store"
)

// fakeCluster is an in-memory Argo Rollouts API with resourceVersion
// compare-and-swap, so the watcher is tested without kubectl.
type fakeCluster struct {
	mu      sync.Mutex
	ros     map[string]*driver.Rollout
	rv      int
	gets    int
	claims  int
	onClaim func() // runs before a claim is checked (to simulate a concurrent writer)
}

func newFakeCluster(images map[string]string) *fakeCluster {
	f := &fakeCluster{ros: map[string]*driver.Rollout{}}
	for svc, img := range images {
		f.rv++
		f.ros[svc] = &driver.Rollout{Name: svc, ResourceVersion: fmt.Sprint(f.rv), Generation: 1, ObservedGeneration: 1,
			Containers: map[string]string{svc: img}, Annotations: map[string]string{},
			TemplateAnnotations: map[string]string{}, TemplateLabels: map[string]string{},
			CurrentPodHash: hash(img), StableRS: hash(img), Phase: "Healthy"}
	}
	return f
}

func hash(img string) string { return fmt.Sprintf("h%x", len(img)*31+int(img[len(img)-1])) }

func (f *fakeCluster) Get(_ context.Context, svc config.Service) (*driver.Rollout, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gets++
	ro, ok := f.ros[svc.Name]
	if !ok {
		return nil, fmt.Errorf("rollouts.argoproj.io %q not found", svc.Name)
	}
	cp := *ro
	cp.Containers, cp.Annotations = clone(ro.Containers), clone(ro.Annotations)
	cp.TemplateAnnotations, cp.TemplateLabels = clone(ro.TemplateAnnotations), clone(ro.TemplateLabels)
	return &cp, nil
}

func (f *fakeCluster) Claim(_ context.Context, svc config.Service, rv, id, image string) error {
	if f.onClaim != nil {
		hook := f.onClaim
		f.onClaim = nil
		hook()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	ro := f.ros[svc.Name]
	if ro.ResourceVersion != rv {
		return fmt.Errorf("%w: the object has been modified", driver.ErrConflict)
	}
	f.claims++
	f.annotateLocked(ro, id, image)
	return nil
}

func (f *fakeCluster) annotateLocked(ro *driver.Rollout, id, image string) {
	ro.Annotations[driver.AnnotationControlledBy] = id
	ro.Annotations[driver.AnnotationImage] = image
	f.rv++
	ro.ResourceVersion = fmt.Sprint(f.rv)
}

// mark is what the engine's driver.Marker does.
func (f *fakeCluster) mark(svc, id, image string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.annotateLocked(f.ros[svc], id, image)
}

// setImage changes the pod template, as kubectl set image, a GitOps sync or
// the driver's Prepare would. Argo starts a canary unless it is the stable image.
func (f *fakeCluster) setImage(svc, image string, templateMeta map[string]string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ro := f.ros[svc]
	if ro.Containers[svc] == image {
		return
	}
	ro.Containers[svc] = image
	ro.TemplateAnnotations = clone(templateMeta)
	ro.Generation++
	ro.ObservedGeneration = ro.Generation
	ro.CurrentPodHash = hash(image)
	f.rv++
	ro.ResourceVersion = fmt.Sprint(f.rv)
}

func (f *fakeCluster) promote(svc string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ro := f.ros[svc]
	ro.StableRS = ro.CurrentPodHash
	f.rv++
	ro.ResourceVersion = fmt.Sprint(f.rv)
}

func (f *fakeCluster) annotations(svc string) map[string]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return clone(f.ros[svc].Annotations)
}

func clone(m map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range m {
		out[k] = v
	}
	return out
}

// fakeKube is the kubernetes driver against fakeCluster.
type fakeKube struct{ c *fakeCluster }

func (k *fakeKube) Name() string { return "kubernetes" }
func (k *fakeKube) Mark(_ context.Context, svc config.Service, id, image string) error {
	k.c.mark(svc.Name, id, image)
	return nil
}
func (k *fakeKube) Prepare(_ context.Context, svc config.Service, image string) error {
	k.c.mu.Lock()
	meta := clone(k.c.ros[svc.Name].TemplateAnnotations)
	k.c.mu.Unlock()
	k.c.setImage(svc.Name, image, meta)
	return nil
}
func (k *fakeKube) SetWeight(context.Context, config.Service, int, int) error { return nil }
func (k *fakeKube) Promote(_ context.Context, svc config.Service) error {
	k.c.promote(svc.Name)
	return nil
}
func (k *fakeKube) Rollback(context.Context, config.Service) error { return nil }

func watchConfig(dir string) *config.Config {
	cfg := config.Default("t")
	cfg.Dir = dir
	cfg.Services = []config.Service{{Name: "checkout-api", Target: "kubernetes", Namespace: "shop", Detect: true}}
	cfg.Policy.AllowSyntheticTelemetry = true
	cfg.ApplyDefaults()
	return cfg
}

func newWatcher(t *testing.T, cl *fakeCluster, st store.Store, state *WatchState) (*Watcher, *logbook) {
	t.Helper()
	lb := &logbook{}
	w := &Watcher{
		Cfg: watchConfig(t.TempDir()), Cluster: cl, Store: st, State: state, Log: lb.log, Wait: noWait,
		NewDriver: func(config.Service) (driver.Driver, error) { return &fakeKube{c: cl}, nil },
	}
	return w, lb
}

func fsStore(t *testing.T) store.Store {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return st
}

func runOnce(t *testing.T, w *Watcher) {
	t.Helper()
	if err := w.Run(context.Background(), true); err != nil {
		t.Fatal(err)
	}
}

func listAll(t *testing.T, st store.Store) []*domain.Deployment {
	t.Helper()
	all, err := st.List()
	if err != nil {
		t.Fatal(err)
	}
	return all
}

func TestWatchNewImageStartsExactlyOneRelease(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1.0.0"})
	st := fsStore(t)
	w, lb := newWatcher(t, cl, st, nil)

	runOnce(t, w) // baseline
	if d := listAll(t, st); len(d) != 0 {
		t.Fatalf("the first sight is a baseline, not a release: %+v", d)
	}

	cl.setImage("checkout-api", "reg/checkout:sha-3f9c2ab1", nil) // e.g. a GitOps sync, no CI change
	for i := 0; i < 3; i++ {
		runOnce(t, w)
	}
	all := listAll(t, st)
	if len(all) != 1 {
		t.Fatalf("want exactly one deployment, got %d\n%s", len(all), lb)
	}
	d := all[0]
	if d.Status != domain.StatusPromoted || d.Image != "reg/checkout:sha-3f9c2ab1" || d.Ref != "3f9c2ab1" || d.Target != "kubernetes" {
		t.Fatalf("deployment = %+v\n%s", d, lb)
	}
	last := d.Risk.Factors[len(d.Risk.Factors)-1]
	if last.Name != "Detected in cluster" || !strings.Contains(last.Detail, "commit 3f9c2ab1 (from image tag)") || !strings.Contains(last.Detail, "reg/checkout:1.0.0") {
		t.Fatalf("detection factor = %+v", last)
	}
	if d.Risk.Level != domain.LevelMedium || !strings.Contains(d.Risk.Factors[0].Detail, "no portal decision or local git checkout") {
		t.Fatalf("without git or a stored decision the risk is medium, and says why: %+v", d.Risk)
	}
	if a := cl.annotations("checkout-api"); a[driver.AnnotationControlledBy] != d.ID || a[driver.AnnotationImage] != d.Image {
		t.Fatalf("the Rollout must be marked as controlled by %s: %+v", d.ID, a)
	}
	if cl.claims != 1 {
		t.Fatalf("claims = %d, want 1", cl.claims)
	}
	if h, ok := w.State.Lookup(DedupeKey("checkout-api", d.Image)); !ok || h.DeploymentID != d.ID || h.Outcome != "released" {
		t.Fatalf("dedupe entry = %+v %v", h, ok)
	}
}

func TestWatchIgnoresImagesSetByAlror(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	st := fsStore(t)
	w, lb := newWatcher(t, cl, st, nil)
	runOnce(t, w)

	// `alror deploy` in CI: the engine marks the Rollout, then sets the image.
	cl.mark("checkout-api", "dep_ci", "reg/checkout:2")
	runOnce(t, w) // between mark and image change: nothing to do
	cl.setImage("checkout-api", "reg/checkout:2", nil)
	runOnce(t, w)
	runOnce(t, w)

	if d := listAll(t, st); len(d) != 0 {
		t.Fatalf("an image set by Alror must not start another release: %+v", d)
	}
	if cl.claims != 0 || !strings.Contains(lb.String(), "set by Alror deployment dep_ci") {
		t.Fatalf("claims %d\n%s", cl.claims, lb)
	}
}

func connectedWatcher(t *testing.T, cl *fakeCluster) (*Watcher, *apitest.Fake, *logbook) {
	t.Helper()
	f, srv := apitest.Start()
	t.Cleanup(srv.Close)
	client := api.New(srv.URL, apitest.DefaultKey, api.WithRetries(1, time.Millisecond))
	w, lb := newWatcher(t, cl, store.NewRemote(client), nil)
	w.Client = client
	return w, f, lb
}

func TestWatchYieldsToActiveCIRelease(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	w, f, lb := connectedWatcher(t, cl)
	runOnce(t, w)

	// An older CI pipeline (no control annotation) is rolling image 2 out.
	f.PutDeployment(&domain.Deployment{ID: "dep_20261028T000000_c1c1c1", Service: "checkout-api", Image: "reg/checkout:2",
		Status: domain.StatusRolling, Source: "ci", CreatedAt: time.Now(), UpdatedAt: time.Now()})
	cl.setImage("checkout-api", "reg/checkout:2", nil)
	runOnce(t, w)
	runOnce(t, w)

	all, err := w.Store.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || cl.claims != 0 {
		t.Fatalf("the CI release controls the rollout; want no second deployment, got %d (claims %d)\n%s", len(all), cl.claims, lb)
	}
	if !strings.Contains(lb.String(), "dep_20261028T000000_c1c1c1 (rolling, source ci") {
		t.Fatalf("the skip must name the controlling deployment:\n%s", lb)
	}
}

func TestWatchConnectedPrefersThePortalDecision(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	w, f, lb := connectedWatcher(t, cl)
	runOnce(t, w)

	head := "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d"
	merge := "3f9c2ab1d4e5f60718293a4b5c6d7e8f90a1b2c3"
	plan := domain.Plan{Strategy: "canary", Steps: []domain.Step{{Weight: 2, Bake: time.Minute}, {Weight: 100}}}
	f.PutDecision(api.Decision{HeadSHA: head, MergeSHA: merge, Repository: "acme/shop", PullNumber: 4821,
		URL: "https://github.com/acme/shop/pull/4821", RulesVersion: 1, Plan: plan,
		Risk: domain.RiskReport{Score: 85, Level: domain.LevelHigh, Factors: []domain.Factor{{Name: "Migrations", Points: 40}}}})
	// The merge commit reaches the cluster through GitOps, named by the annotation.
	cl.setImage("checkout-api", "reg/checkout:2.0.0", map[string]string{driver.AnnotationCommit: merge})
	runOnce(t, w)

	all, err := w.Store.List()
	if err != nil || len(all) != 1 {
		t.Fatalf("want one detected release, got %+v %v\n%s", all, err, lb)
	}
	got := all[0]
	if got.Ref != merge || got.Risk.Score != 85 || got.Risk.Level != domain.LevelHigh || got.Source != "runner" || got.Environment != "production" {
		t.Fatalf("deployment = %+v", got)
	}
	factors := fmt.Sprint(got.Risk.Factors)
	if !strings.Contains(factors, "pull request acme/shop#4821") || !strings.Contains(factors, "pod template annotation alror.dev/commit") {
		t.Fatalf("factors = %+v", got.Risk.Factors)
	}
	if len(got.Plan.Steps) != 2 || got.Plan.Steps[0].Weight != 2 {
		t.Fatalf("the portal's stored plan must be used: %+v", got.Plan)
	}

	// No decision for the commit: medium risk, and the reason is recorded.
	other := "9e8d7c6b5a4f"
	cl.setImage("checkout-api", "reg/checkout:sha-"+other, nil)
	runOnce(t, w)
	all, _ = w.Store.List()
	if len(all) != 2 || all[0].Risk.Level != domain.LevelMedium || !strings.Contains(all[0].Risk.Factors[0].Detail, "no portal decision or local git checkout for commit "+other) {
		t.Fatalf("fallback = %+v\n%s", all[0], lb)
	}
}

func TestWatchRestartDoesNotDuplicate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "watch.json")
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	st := fsStore(t)

	state, err := OpenWatchState(path)
	if err != nil {
		t.Fatal(err)
	}
	w1, _ := newWatcher(t, cl, st, state)
	runOnce(t, w1)
	cl.setImage("checkout-api", "reg/checkout:2", nil)
	runOnce(t, w1)
	if n := len(listAll(t, st)); n != 1 {
		t.Fatalf("deployments = %d", n)
	}

	// Restart with the state file.
	state2, err := OpenWatchState(path)
	if err != nil {
		t.Fatal(err)
	}
	if h, ok := state2.Lookup(DedupeKey("checkout-api", "reg/checkout:2")); !ok || h.Outcome != "released" {
		t.Fatalf("the state file must remember the release: %+v %v", h, ok)
	}
	w2, _ := newWatcher(t, cl, st, state2)
	runOnce(t, w2)
	runOnce(t, w2)

	// Restart without it (lost volume): the image is a new baseline, and the
	// control annotation still says Alror set it.
	w3, lb3 := newWatcher(t, cl, st, nil)
	runOnce(t, w3)

	// And a change that happened while the runner was down is still caught once.
	cl.setImage("checkout-api", "reg/checkout:3", nil)
	state4, _ := OpenWatchState(path)
	w4, _ := newWatcher(t, cl, st, state4)
	runOnce(t, w4)
	runOnce(t, w4)

	all := listAll(t, st)
	images := []string{}
	for _, d := range all {
		images = append(images, d.Image)
	}
	if len(all) != 2 || cl.claims != 2 {
		t.Fatalf("want one release per image change (2 and 3), got %v, claims %d\n%s", images, cl.claims, lb3)
	}
}

func TestWatchCompareAndSwapClaim(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	st := fsStore(t)
	w1, _ := newWatcher(t, cl, st, nil)
	w2, lb2 := newWatcher(t, cl, st, nil) // a second runner replica
	runOnce(t, w1)
	runOnce(t, w2)

	cl.setImage("checkout-api", "reg/checkout:2", nil)
	// Something writes the Rollout between w1's read and its claim.
	cl.onClaim = func() { cl.mark("checkout-api", "dep_other", "reg/checkout:1") }
	runOnce(t, w1)
	if n := len(listAll(t, st)); n != 0 {
		t.Fatalf("a claim on a stale resourceVersion must not start a release: %d", n)
	}
	runOnce(t, w1) // re-read, claim succeeds
	runOnce(t, w2) // the replica sees w1's mark and stays out
	runOnce(t, w1)

	if n := len(listAll(t, st)); n != 1 || cl.claims != 1 {
		t.Fatalf("deployments %d, claims %d, want 1 and 1\n%s", n, cl.claims, lb2)
	}
	if !strings.Contains(lb2.String(), "set by Alror deployment") {
		t.Fatalf("the replica must say why it stayed out:\n%s", lb2)
	}
}

func TestWatchSkipsStableAndUnreconciledRollouts(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	st := fsStore(t)
	w, lb := newWatcher(t, cl, st, nil)
	runOnce(t, w)

	// The controller has not observed the new spec yet: wait.
	cl.setImage("checkout-api", "reg/checkout:2", nil)
	cl.mu.Lock()
	cl.ros["checkout-api"].ObservedGeneration = 1
	cl.mu.Unlock()
	runOnce(t, w)
	if len(listAll(t, st)) != 0 || cl.claims != 0 {
		t.Fatal("an unreconciled Rollout must not be acted on")
	}

	// Reconciled, but already fully on this image (e.g. a revert to stable).
	cl.mu.Lock()
	ro := cl.ros["checkout-api"]
	ro.ObservedGeneration, ro.StableRS = ro.Generation, ro.CurrentPodHash
	cl.rv++
	ro.ResourceVersion = fmt.Sprint(cl.rv)
	cl.mu.Unlock()
	runOnce(t, w)
	if len(listAll(t, st)) != 0 || !strings.Contains(lb.String(), "already fully on this image") {
		t.Fatalf("a stable Rollout has no canary to control:\n%s", lb)
	}
}

func TestWatchReportsUnsupportedTargets(t *testing.T) {
	cl := newFakeCluster(map[string]string{})
	w, lb := newWatcher(t, cl, fsStore(t), nil)
	w.Cfg.Policy.AllowSyntheticTelemetry = false
	w.Cfg.Services = []config.Service{
		{Name: "billing", Target: "ecs", Detect: true},
		{Name: "web", Target: "simulated", Detect: true},
		{Name: "checkout-api", Target: "kubernetes", Detect: true}, // synthetic telemetry on a real target
		{Name: "search", Target: "kubernetes"},                     // not enrolled
	}
	w.Services = []string{"ghost"}
	err := w.Run(context.Background(), true)
	if !errors.Is(err, ErrNothingToWatch) {
		t.Fatalf("err = %v", err)
	}
	log := lb.String()
	for _, want := range []string{
		"watch billing: not watched: target ecs: detect_release is unsupported",
		"watch web: not watched: target simulated: detect_release is unsupported",
		"watch checkout-api: not watched: synthetic telemetry cannot verify a real target",
		"watch ghost: unknown service",
	} {
		if !strings.Contains(log, want) {
			t.Errorf("log lacks %q:\n%s", want, log)
		}
	}
	if strings.Contains(log, "search") || cl.gets != 0 {
		t.Fatalf("nothing may be read or simulated for unwatchable services (gets %d):\n%s", cl.gets, log)
	}
}

func TestWatchReportsMissingContainer(t *testing.T) {
	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	cl.ros["checkout-api"].Containers = map[string]string{"app": "reg/checkout:1"}
	w, lb := newWatcher(t, cl, fsStore(t), nil)
	runOnce(t, w)
	runOnce(t, w)
	if n := strings.Count(lb.String(), "has no container named checkout-api"); n != 1 {
		t.Fatalf("report once, got %d:\n%s", n, lb)
	}
}

func TestCommitFor(t *testing.T) {
	ro := func(ann, labels map[string]string) *driver.Rollout {
		return &driver.Rollout{TemplateAnnotations: ann, TemplateLabels: labels}
	}
	full := "3f9c2ab1d4e5f60718293a4b5c6d7e8f90a1b2c3"
	cases := []struct {
		name, image string
		ann, labels map[string]string
		sha, how    string
	}{
		{"bare short sha", "reg/app:3f9c2ab", nil, nil, "3f9c2ab", "image tag"},
		{"full sha", "reg/app:" + full, nil, nil, full, "image tag"},
		{"metadata-action", "ghcr.io/o/app:sha-3f9c2ab", nil, nil, "3f9c2ab", "image tag"},
		{"git describe", "reg/app:v1.4.2-3-g3f9c2ab", nil, nil, "3f9c2ab", "image tag"},
		{"version suffix", "reg/app:1.4.2-3f9c2ab", nil, nil, "3f9c2ab", "image tag"},
		{"registry port", "localhost:5000/app:main_3f9c2ab", nil, nil, "3f9c2ab", "image tag"},
		{"annotation wins", "reg/app:sha-1111aaa", map[string]string{"alror.dev/commit": full}, nil, full, "pod template annotation alror.dev/commit"},
		{"label", "reg/app:1.0", nil, map[string]string{"alror.dev/commit": "ABCDEF1"}, "abcdef1", "pod template label alror.dev/commit"},
		{"semver", "reg/app:1.4.2", nil, nil, "", "not a commit SHA"},
		{"date", "reg/app:20261028", nil, nil, "", "not a commit SHA"},
		{"word", "reg/app:defaced", nil, nil, "", "not a commit SHA"},
		{"digest only", "reg/app@sha256:" + strings.Repeat("ab12", 16), nil, nil, "", "not a commit SHA"},
		{"no tag, port", "localhost:5000/app", nil, nil, "", "not a commit SHA"},
		{"bad annotation", "reg/app:sha-3f9c2ab", map[string]string{"alror.dev/commit": "main"}, nil, "", `alror.dev/commit="main" is not a commit SHA`},
	}
	for _, c := range cases {
		sha, how := CommitFor(ro(c.ann, c.labels), c.image)
		if sha != c.sha || !strings.Contains(how, c.how) {
			t.Errorf("%s: CommitFor(%q) = %q, %q; want %q, …%q…", c.name, c.image, sha, how, c.sha, c.how)
		}
	}
}

func TestWatchScoresTheCommitFromALocalCheckout(t *testing.T) {
	repo := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-c", "user.name=dev", "-c", "user.email=dev@example.com", "-c", "commit.gpgsign=false"}, args...)...)
		cmd.Dir = repo
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
		return strings.TrimSpace(string(out))
	}
	write := func(name, body string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(repo, filepath.Dir(name)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(repo, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	write("README.md", "hi\n")
	git("add", ".")
	git("commit", "-q", "-m", "init")
	write("services/checkout/payment.go", strings.Repeat("x := 1\n", 300))
	git("add", ".")
	git("commit", "-q", "-m", "payments")
	sha := git("rev-parse", "--short=9", "HEAD")

	cl := newFakeCluster(map[string]string{"checkout-api": "reg/checkout:1"})
	st := fsStore(t)
	w, lb := newWatcher(t, cl, st, nil)
	w.Cfg.Dir = repo
	w.Cfg.Services[0].Paths = []string{"services/checkout/"}
	w.Cfg.Services[0].Critical = true
	runOnce(t, w)
	cl.setImage("checkout-api", "reg/checkout:main-"+sha, nil)
	runOnce(t, w)

	all := listAll(t, st)
	if len(all) != 1 {
		t.Fatalf("deployments = %d\n%s", len(all), lb)
	}
	d := all[0]
	factors := fmt.Sprint(d.Risk.Factors)
	if d.Ref != sha || strings.Contains(factors, "Default score") || !strings.Contains(factors, "payment") {
		t.Fatalf("the commit must be scored offline from the checkout: ref %q, risk %+v", d.Ref, d.Risk)
	}
}
