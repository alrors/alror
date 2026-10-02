package cli

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	gh "github.com/alrors/alror/internal/github"
)

func TestActionsDeploymentReceipts(t *testing.T) {
	for _, tc := range []struct {
		name, pr, comment, want string
		args                    []string
		exit, apiStatus         int
		post                    bool
	}{
		{name: "promoted", pr: "7", comment: "true", want: "**Promoted.**", post: true},
		{name: "rollback", pr: "7", comment: "true", want: "**Rolled back.**", args: []string{"--regress", "error_rate=3"}, exit: 2, post: true},
		{name: "shadow", pr: "7", comment: "true", want: "Promoted with failed verification", args: []string{"--regress", "error_rate=3", "--shadow"}, post: true},
		{name: "forbidden", pr: "7", comment: "true", want: "**Rolled back.**", args: []string{"--regress", "error_rate=3"}, exit: 2, apiStatus: 403},
		{name: "api-failure", pr: "7", comment: "true", want: "**Rolled back.**", args: []string{"--regress", "error_rate=3"}, exit: 2, apiStatus: 500},
		{name: "push", comment: "true", want: "**Promoted.**"},
		{name: "disabled", pr: "7", comment: "false", want: "**Promoted.**"},
		{name: "invalid-pr", pr: "oops", comment: "true", want: "**Promoted.**"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			isolate(t)
			repo := t.TempDir()
			mustRun(t, 0, "-C", repo, "init")
			bodies := make(chan string, 4)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.apiStatus != 0 {
					w.WriteHeader(tc.apiStatus)
					_, _ = w.Write([]byte(`{"message":"denied"}`))
					return
				}
				if r.URL.Path != "/repos/acme/shop/issues/7/comments" {
					t.Errorf("unexpected path %s", r.URL.Path)
				}
				if r.Method == http.MethodGet {
					_, _ = w.Write([]byte("[]"))
					return
				}
				var body map[string]string
				_ = json.NewDecoder(r.Body).Decode(&body)
				bodies <- body["body"]
				_, _ = w.Write([]byte(`{"html_url":"https://github.test/comment/1"}`))
			}))
			defer srv.Close()
			for k, v := range map[string]string{
				"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "acme/shop", "GITHUB_SHA": "abc", "GITHUB_TOKEN": "test-token", "ALROR_GITHUB_TOKEN": "",
				"GITHUB_EVENT_PATH": "", "GITHUB_API_URL": srv.URL, "ALROR_GITHUB_COMMENT": tc.comment, "ALROR_GITHUB_PR": tc.pr,
				"GITHUB_STEP_SUMMARY": filepath.Join(repo, "summary.md"), "GITHUB_OUTPUT": filepath.Join(repo, "outputs"),
				"GITHUB_SERVER_URL": "https://github.test", "GITHUB_RUN_ID": "42",
			} {
				t.Setenv(k, v)
			}
			args := append([]string{"-C", repo, "--json", "deploy", "-s", "checkout-api", "-i", "app:v2", "--risk", "10", "--fast"}, tc.args...)
			mustRun(t, tc.exit, args...)
			md, err := os.ReadFile(filepath.Join(repo, "summary.md"))
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{tc.want, "Stage at", "View workflow run and logs", "Metrics provider"} {
				if !strings.Contains(string(md), want) {
					t.Errorf("missing %q in summary", want)
				}
			}
			out, err := os.ReadFile(filepath.Join(repo, "outputs"))
			if err != nil || !strings.Contains(string(out), "risk=10") || !strings.Contains(string(out), "duration=") {
				t.Fatalf("outputs: %s, %v", out, err)
			}
			if tc.post {
				select {
				case body := <-bodies:
					if body != gh.DeploymentMarker("checkout-api", "")+"\n"+strings.TrimSuffix(string(md), "\n") {
						t.Fatal("comment must match summary")
					}
				default:
					t.Fatal("deployment comment not posted")
				}
			} else if len(bodies) != 0 {
				t.Fatal("unexpected comment")
			}
		})
	}
}

func TestJSONRiskGateKeepsFailureExitCode(t *testing.T) {
	isolate(t)
	repo := t.TempDir()
	mustRun(t, 0, "-C", repo, "init")
	for _, args := range [][]string{{"init"}, {"add", "."}, {"-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-m", "Initial"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git: %s: %v", out, err)
		}
	}
	if err := os.WriteFile(filepath.Join(repo, "alror.yaml"), []byte("# changed policy\n"+readTestFile(t, filepath.Join(repo, "alror.yaml"))), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"GITHUB_REPOSITORY", "GITHUB_EVENT_PATH", "GITHUB_BASE_REF", "GITHUB_TOKEN", "ALROR_GITHUB_TOKEN", "GITHUB_STEP_SUMMARY", "GITHUB_OUTPUT"} {
		t.Setenv(key, "")
	}
	mustRun(t, 3, "-C", repo, "--json", "github", "check", "--base", "HEAD", "--fail-above", "1", "--dry-run")
}

func readTestFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
