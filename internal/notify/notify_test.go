package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alrors/alror/internal/domain"
)

func TestTitles(t *testing.T) {
	cases := []struct {
		name string
		d    domain.Deployment
		icon string
		want string
	}{
		{"promoted", domain.Deployment{Service: "checkout", Ref: "#12", Status: domain.StatusPromoted, Weight: 100},
			":white_check_mark:", "Promoted checkout #12 to 100%"},
		{"rolled back", domain.Deployment{Service: "checkout", Ref: "#12", Status: domain.StatusRolledBack, Weight: 5, Recovery: domain.RecoveryRequested},
			":rewind:", "Rolled back checkout #12 at 5% traffic"},
		{"failed", domain.Deployment{Service: "checkout", Status: domain.StatusFailed, Weight: 25, Recovery: domain.RecoverySimulated},
			":x:", "FAILED checkout at 25% traffic"},
		{"rollback failed", domain.Deployment{Service: "checkout", Ref: "#12", Status: domain.StatusFailed, Weight: 25, Recovery: domain.RecoveryFailed},
			":rotating_light:", "ROLLBACK FAILED checkout #12 at 25% traffic"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			icon, title := Title(&c.d)
			if icon != c.icon || !strings.HasPrefix(title, c.want) {
				t.Fatalf("Title = %q %q, want %q %q…", icon, title, c.icon, c.want)
			}
			if c.d.Status != domain.StatusPromoted && strings.Contains(title, "Promoted") {
				t.Fatalf("%s must not say Promoted: %q", c.d.Status, title)
			}
		})
	}
}

func TestConsoleURL(t *testing.T) {
	if got := ConsoleURL("https://alror.example.com/", "dep_1"); got != "https://alror.example.com/app/deployments/dep_1" {
		t.Fatalf("ConsoleURL = %q", got)
	}
	if got := ConsoleURL("", "dep_1"); got != "" {
		t.Fatalf("local mode has no console URL, got %q", got)
	}
}

func TestSlackPostsDeepLink(t *testing.T) {
	var text string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		text = body["text"]
	}))
	defer srv.Close()
	d := &domain.Deployment{ID: "dep_1", Service: "checkout", Status: domain.StatusFailed, Recovery: domain.RecoveryFailed, Weight: 5}

	if err := (Slack{Webhook: srv.URL, Server: "https://alror.example.com"}).Notify(context.Background(), d, "driver error"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "ROLLBACK FAILED") || !strings.Contains(text, "<https://alror.example.com/app/deployments/dep_1|Open in console>") {
		t.Fatalf("text = %q", text)
	}

	if err := (Slack{Webhook: srv.URL}).Notify(context.Background(), d, "driver error"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, "Open in console") {
		t.Fatalf("local mode must not link to a console: %q", text)
	}
}

func TestSlackErrorHidesWebhook(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	hook := srv.URL + "/services/T000/B000/secret-token"
	srv.Close() // connection refused
	err := (Slack{Webhook: hook}).Notify(context.Background(), &domain.Deployment{ID: "dep_1"}, "x")
	if err == nil || strings.Contains(err.Error(), "secret-token") {
		t.Fatalf("err = %v", err)
	}
}

func TestForWithoutWebhookIsNop(t *testing.T) {
	if _, ok := For("", "https://x").(Nop); !ok {
		t.Fatal("no webhook should give Nop")
	}
	if s, ok := For("https://hooks.slack.com/x", "https://x").(Slack); !ok || s.Server != "https://x" {
		t.Fatalf("For = %+v", s)
	}
}
