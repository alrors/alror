package cli

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/api/apitest"
	"github.com/alrors/alror/internal/config"
)

const (
	testWebhook = "https://hooks.slack.com/services/T000/B000/s3cr3t-hook"
	testToken   = "s3cr3t-token"
)

func TestRedactURL(t *testing.T) {
	cases := map[string]string{
		"https://prom:" + testToken + "@prom.example.com/x": "https://prom:xxxxx@prom.example.com/x",
		"https://" + testToken + "@prom.example.com":        "https://xxxxx@prom.example.com",
		"http://prometheus:9090":                            "http://prometheus:9090",
		"":                                                  "",
	}
	for in, want := range cases {
		if got := redactURL(in); got != want {
			t.Errorf("redactURL(%q) = %q, want %q", in, got, want)
		}
	}
	if got := metricsLabel(config.Metrics{Provider: "prometheus", URL: "https://u:" + testToken + "@h"}); strings.Contains(got, testToken) {
		t.Fatalf("metricsLabel leaks the token: %q", got)
	}
}

func TestRedactConfigLeavesOriginalAlone(t *testing.T) {
	c := config.Default("acme")
	c.Notify.SlackWebhook = testWebhook
	c.Metrics.URL = "https://u:" + testToken + "@h"
	r := redactConfig(c)
	if r.Notify.SlackWebhook != "" || strings.Contains(r.Metrics.URL, testToken) {
		t.Fatalf("redacted = %+v %+v", r.Notify, r.Metrics)
	}
	if c.Notify.SlackWebhook != testWebhook || !strings.Contains(c.Metrics.URL, testToken) {
		t.Fatal("redactConfig must not modify its input")
	}
}

func TestKeepSecretsOut(t *testing.T) {
	remote := config.Default("acme")
	remote.Notify.SlackWebhook = testWebhook
	remote.Metrics = config.Metrics{Provider: "prometheus", URL: "https://u:" + testToken + "@prom"}
	notes := keepSecretsOut(remote, &config.Config{})
	if remote.Notify.SlackWebhook != "" || remote.Metrics.URL != "https://prom" || len(notes) != 2 {
		t.Fatalf("remote = %+v %+v, notes %+v", remote.Notify, remote.Metrics, notes)
	}

	// Values alror.yaml already holds are the user's choice and stay.
	remote.Notify.SlackWebhook = testWebhook
	remote.Metrics.URL = "https://u:" + testToken + "@prom"
	local := &config.Config{Notify: config.Notify{SlackWebhook: "https://hooks.slack.com/local"}, Metrics: remote.Metrics}
	keepSecretsOut(remote, local)
	if remote.Notify.SlackWebhook != "https://hooks.slack.com/local" || remote.Metrics.URL != local.Metrics.URL {
		t.Fatalf("remote = %+v %+v", remote.Notify, remote.Metrics)
	}
}

// capture runs fn with stdout redirected and returns what it printed.
func capture(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	done := make(chan string)
	go func() {
		b, _ := io.ReadAll(r)
		done <- string(b)
	}()
	defer func() { os.Stdout = old }()
	fn()
	w.Close()
	os.Stdout = old
	return <-done
}

func TestConfigPullKeepsSecretsOutOfFileAndOutput(t *testing.T) {
	isolate(t)
	f, srv := apitest.Start()
	defer srv.Close()
	cfg := f.Config()
	cfg.Notify.SlackWebhook = testWebhook
	cfg.Metrics = config.Metrics{Provider: "prometheus", URL: "https://prom:" + testToken + "@prom.example.com",
		Queries: map[string]string{"error_rate": "x", "latency_p95": "y"}}
	f.SetConfig(cfg)
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, "alror.yaml"), []byte("server: "+srv.URL+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ALROR_API_KEY", apitest.DefaultKey)

	var code int
	out := capture(t, func() { code = run([]string{"-C", repo, "--json", "config", "pull"}) })
	if code != 0 {
		t.Fatalf("exit %d: %s", code, out)
	}
	if strings.Contains(out, "s3cr3t") {
		t.Fatalf("--json output leaks a secret:\n%s", out)
	}
	if !strings.Contains(out, `"slack_webhook": "set"`) {
		t.Fatalf("--json should say the webhook is set:\n%s", out)
	}
	raw, err := os.ReadFile(filepath.Join(repo, "alror.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "s3cr3t") || strings.Contains(string(raw), "slack_webhook") {
		t.Fatalf("alror.yaml must not hold workspace secrets:\n%s", raw)
	}
	if !strings.Contains(string(raw), "https://prom.example.com") {
		t.Fatalf("the metrics URL itself should still be written:\n%s", raw)
	}

	out = capture(t, func() { code = run([]string{"-C", repo, "config", "pull", "--dry-run"}) })
	if code != 0 || strings.Contains(out, "s3cr3t") || !strings.Contains(out, "not written to alror.yaml") {
		t.Fatalf("exit %d:\n%s", code, out)
	}
}
