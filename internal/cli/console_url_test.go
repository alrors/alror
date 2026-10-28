package cli

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/api/apitest"
)

func TestConnectedOutputLinksToTheConsole(t *testing.T) {
	isolate(t)
	_, srv := apitest.Start()
	defer srv.Close()
	t.Setenv("ALROR_SERVER", srv.URL)
	t.Setenv("ALROR_API_KEY", apitest.DefaultKey)
	repo := t.TempDir()

	var code int
	out := capture(t, func() {
		code = run([]string{"-C", repo, "--json", "deploy", "-s", "checkout-api", "-i", "app:2", "--risk", "10", "--fast"})
	})
	var dep struct {
		Deployment struct{ ID string } `json:"deployment"`
		ConsoleURL string              `json:"console_url"`
	}
	if err := json.Unmarshal([]byte(out), &dep); err != nil || code != 0 {
		t.Fatalf("exit %d, %v:\n%s", code, err, out)
	}
	want := srv.URL + "/app/deployments/" + dep.Deployment.ID
	if dep.ConsoleURL != want {
		t.Fatalf("deploy console_url = %q, want %q", dep.ConsoleURL, want)
	}

	out = capture(t, func() { code = run([]string{"-C", repo, "--json", "status", dep.Deployment.ID}) })
	if code != 0 || !strings.Contains(out, `"console_url": "`+want+`"`) {
		t.Fatalf("status --json, exit %d:\n%s", code, out)
	}
	out = capture(t, func() { code = run([]string{"-C", repo, "status", dep.Deployment.ID}) })
	if lines := strings.Split(strings.TrimSpace(out), "\n"); code != 0 || !strings.Contains(lines[len(lines)-1], want) ||
		!strings.Contains(lines[len(lines)-1], "open in console") {
		t.Fatalf("status should end with the console link, exit %d:\n%s", code, out)
	}

	out = capture(t, func() { code = run([]string{"-C", repo, "--json", "rollback", dep.Deployment.ID}) })
	var rb struct {
		ID         string `json:"id"`
		Status     string `json:"status"`
		ConsoleURL string `json:"console_url"`
	}
	if err := json.Unmarshal([]byte(out), &rb); err != nil || code != 0 || rb.ID != dep.Deployment.ID || rb.Status != "rolled_back" || rb.ConsoleURL != want {
		t.Fatalf("rollback --json, exit %d, %v: %+v\n%s", code, err, rb, out)
	}
}

func TestLocalOutputHasNoConsoleURL(t *testing.T) {
	isolate(t)
	repo := t.TempDir()
	mustRun(t, 0, "-C", repo, "--no-anim", "init")
	var code int
	out := capture(t, func() {
		code = run([]string{"-C", repo, "--json", "deploy", "-s", "checkout-api", "-i", "app:2", "--risk", "10", "--fast"})
	})
	if code != 0 || strings.Contains(out, "console_url") {
		t.Fatalf("exit %d:\n%s", code, out)
	}
}
