package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/alrors/alror/internal/api"
	"github.com/alrors/alror/internal/cli/ui"
	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/credentials"
	"github.com/alrors/alror/internal/runner"
	"github.com/alrors/alror/internal/store"
)

func runnerCmd() *cobra.Command {
	var (
		name        string
		once        bool
		concurrency int
		wf          watchFlags
	)
	cmd := &cobra.Command{
		Use:   "runner",
		Short: "Run deploys and rollbacks queued from the Alror console, in your own infrastructure",
		Long: "Claims jobs with POST /jobs/claim (long-poll), runs them with the rollout\n" +
			"engine against the Alror workspace, and reports each outcome. Ctrl-C (SIGINT or\n" +
			"SIGTERM) stops claiming and lets the current job finish; a second Ctrl-C aborts\n" +
			"it, which rolls the canary back. Needs an API key with the jobs:run scope.\n\n" +
			"--watch (experimental) also watches the Argo Rollouts of services with\n" +
			"detect: true (or --watch-service) and starts one verified release when\n" +
			"their image changes outside Alror, so CI needs no `alror deploy` step. With\n" +
			"--local it only watches, using alror.yaml and .alror/.",
		Example: "  alror runner\n  alror runner --name ci-runner-1 --concurrency 2\n  alror runner --once      # run at most one job, then exit\n" +
			"  alror runner --watch     # also start releases for image changes made in the cluster\n" +
			"  alror runner --local --watch --watch-service checkout-api",
		RunE: func(*cobra.Command, []string) error {
			res, local, err := resolve()
			if err != nil {
				return err
			}
			watching := wf.enabled(local)
			if watching && (g.local || res.Server == "") {
				return runLocalWatch(local, wf, once)
			}
			client, res, _, err := connectedClient("runner")
			if err != nil {
				return err
			}
			if name == "" {
				name, _ = os.Hostname()
				if name == "" {
					name = "runner"
				}
			}
			log := newRunnerLog(g.json)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			who, err := client.Whoami(ctx)
			cancel()
			switch {
			case err == nil && !who.HasScope(api.ScopeJobsRun):
				return fmt.Errorf("the API key %s lacks the jobs:run scope (has: %v)", keyPrefix(res.Key), who.Scopes)
			case err == nil:
				log.line(runner.Info, fmt.Sprintf("runner %s · %s workspace (%s) · concurrency %d%s", name, who.Org.Slug, res.Server, concurrency, onceNote(once)))
			case api.IsTransient(err):
				log.line(runner.Warn, fmt.Sprintf("runner %s · %s not reachable yet (%v); will keep trying", name, res.Server, err))
			default:
				return explainAPIError(res.Server, err)
			}

			claimCtx, stopClaiming := context.WithCancel(context.Background())
			defer stopClaiming()
			jobCtx, abortJobs := context.WithCancel(context.Background())
			defer abortJobs()

			defer trapSignals(log, stopClaiming, abortJobs, "stopping: no new jobs; the current job will finish (Ctrl-C again to abort it)")()

			w := &runner.Runner{Client: client, Name: name, Concurrency: concurrency, Log: log.line, JobContext: jobCtx}
			var watchDone chan error
			if watching {
				wt, err := connectedWatcher(client, res, local, wf, log.line, jobCtx)
				if err != nil {
					return err
				}
				watchDone = make(chan error, 1)
				go func() {
					err := wt.Run(claimCtx, once)
					if errors.Is(err, runner.ErrNothingToWatch) {
						// Jobs still run; the reasons were logged per service.
						log.line(runner.Warn, "release detection is off: no enrolled service can be watched")
						err = nil
					}
					watchDone <- err
				}()
			}
			runErr := w.Run(claimCtx, once)
			if runErr != nil {
				stopClaiming() // a fatal job-loop error stops the watcher too
			}
			if watchDone != nil {
				if err := <-watchDone; err != nil && runErr == nil {
					runErr = err
				}
			}
			if runErr != nil {
				return runErr
			}
			if !once {
				log.line(runner.OK, "runner stopped")
			}
			return nil
		},
	}
	cmd.Flags().StringVar(&name, "name", "", "runner name reported as claimed_by (default: hostname)")
	cmd.Flags().BoolVar(&once, "once", false, "claim at most one job (one long-poll), run it and exit")
	cmd.Flags().IntVar(&concurrency, "concurrency", 1, "jobs to run in parallel")
	cmd.Flags().BoolVar(&wf.watch, "watch", false, "experimental: start releases for image changes made in the cluster (services with detect: true)")
	cmd.Flags().StringSliceVar(&wf.services, "watch-service", nil, "also watch this service (repeatable; implies --watch)")
	cmd.Flags().DurationVar(&wf.interval, "watch-interval", 0, "how often each Rollout is polled (default watch.interval, else 15s)")
	cmd.Flags().StringVar(&wf.state, "watch-state", "", "file that remembers handled image changes (default watch.state, else .alror/watch.json)")
	return cmd
}

// watchFlags are the release detection flags of `alror runner`.
type watchFlags struct {
	watch    bool
	services []string
	interval time.Duration
	state    string
}

func (wf watchFlags) enabled(local *config.Config) bool {
	return wf.watch || len(wf.services) > 0 || (local != nil && local.Watch.Enabled)
}

// newWatcher builds the watcher for cfg; the flags win over alror.yaml's watch:.
func newWatcher(cfg *config.Config, st store.Store, wf watchFlags, log func(runner.Level, string), jobCtx context.Context) (*runner.Watcher, error) {
	path := wf.state
	if path == "" {
		path = cfg.Watch.State
	}
	if path == "" {
		path = filepath.Join(cfg.StateDir(), "watch.json")
	} else if !filepath.IsAbs(path) {
		path = filepath.Join(cfg.Dir, path)
	}
	state, err := runner.OpenWatchState(path)
	if err != nil {
		return nil, fmt.Errorf("watch state: %w", err)
	}
	return &runner.Watcher{Cfg: cfg, Services: wf.services, Store: st, State: state, Log: log,
		Interval: wf.interval, JobContext: jobCtx}, nil
}

func connectedWatcher(client *api.Client, res credentials.Resolved, local *config.Config, wf watchFlags,
	log func(runner.Level, string), jobCtx context.Context) (*runner.Watcher, error) {
	load := func(ctx context.Context) (*config.Config, error) {
		cfg, err := client.Config(ctx)
		if err != nil {
			return nil, explainAPIError(res.Server, err)
		}
		if err := mergeWorkspaceConfig(cfg, local, res.Server); err != nil {
			return nil, err
		}
		return cfg, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cfg, err := load(ctx)
	if err != nil {
		return nil, err
	}
	wt, err := newWatcher(cfg, store.NewRemote(client), wf, log, jobCtx)
	if err != nil {
		return nil, err
	}
	wt.Client, wt.Refresh = client, load
	return wt, nil
}

// runLocalWatch runs only the watcher, against alror.yaml and .alror/:
// claiming jobs needs a workspace, detecting releases does not.
func runLocalWatch(local *config.Config, wf watchFlags, once bool) error {
	if local == nil {
		return config.ErrNotFound
	}
	if err := local.Validate(); err != nil {
		return err
	}
	st, err := store.Open(local.StateDir())
	if err != nil {
		return fmt.Errorf("open state dir: %w", err)
	}
	log := newRunnerLog(g.json)
	watchCtx, stopWatching := context.WithCancel(context.Background())
	defer stopWatching()
	jobCtx, abortJobs := context.WithCancel(context.Background())
	defer abortJobs()
	stop := trapSignals(log, stopWatching, abortJobs, "stopping: no new releases; the current release will finish (Ctrl-C again to abort it)")
	defer stop()

	wt, err := newWatcher(local, st, wf, log.line, jobCtx)
	if err != nil {
		return err
	}
	log.line(runner.Info, "release detection (experimental) · local mode · state "+local.StateDir()+onceNote(once))
	if err := wt.Run(watchCtx, once); err != nil {
		return err
	}
	if !once {
		log.line(runner.OK, "watcher stopped")
	}
	return nil
}

// trapSignals stops on the first SIGINT/SIGTERM and aborts on the second.
func trapSignals(log *runnerLog, stop, abort context.CancelFunc, stopMsg string) func() {
	sigs := make(chan os.Signal, 2)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		n := 0
		for range sigs {
			n++
			if n == 1 {
				log.line(runner.Warn, stopMsg)
				stop()
			} else {
				log.line(runner.Error, "aborting; the engine rolls the canary back")
				abort()
			}
		}
	}()
	return func() { signal.Stop(sigs) }
}

func onceNote(once bool) string {
	if once {
		return " · once"
	}
	return ""
}

// runnerLog prints one line per event: "15:04:05  ✓ message". No animations:
// the runner is a daemon whose output usually ends up in a log file.
type runnerLog struct {
	mu   sync.Mutex
	json bool
}

func newRunnerLog(asJSON bool) *runnerLog { return &runnerLog{json: asJSON} }

func (l *runnerLog) line(lv runner.Level, msg string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.json {
		levels := map[runner.Level]string{runner.Info: "info", runner.OK: "ok", runner.Warn: "warn", runner.Error: "error"}
		raw, _ := json.Marshal(map[string]string{"at": now.UTC().Format(time.RFC3339Nano), "level": levels[lv], "msg": msg})
		fmt.Println(string(raw))
		return
	}
	ts := ui.Fainter.Render(now.Format("15:04:05"))
	switch lv {
	case runner.OK:
		fmt.Printf("%s  %s\n", ts, ui.OK(msg))
	case runner.Warn:
		fmt.Printf("%s  %s\n", ts, ui.WarnLine(msg))
	case runner.Error:
		fmt.Printf("%s  %s\n", ts, ui.Fail(msg))
	default:
		fmt.Printf("%s  %s %s\n", ts, ui.Fainter.Render("·"), msg)
	}
}
