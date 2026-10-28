// Package notify sends deployment outcomes to people.
package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/alrors/alror/internal/domain"
)

// Notifier is told about terminal outcomes: promoted, rolled back, failed
// and rollback failed.
type Notifier interface {
	Notify(ctx context.Context, d *domain.Deployment, summary string) error
}

// Nop discards notifications.
type Nop struct{}

func (Nop) Notify(context.Context, *domain.Deployment, string) error { return nil }

// For returns the notifier for a config: Slack when a webhook is set,
// otherwise Nop. server is the Alror workspace URL in connected mode (empty
// in local mode); when set, messages deep-link to the release in the console.
func For(slackWebhook, server string) Notifier {
	if slackWebhook == "" {
		return Nop{}
	}
	return Slack{Webhook: slackWebhook, Server: server}
}

// ConsoleURL is the console page of a deployment, or "" when server is unknown.
func ConsoleURL(server, deploymentID string) string {
	server = strings.TrimRight(server, "/")
	if server == "" || deploymentID == "" {
		return ""
	}
	return server + "/app/deployments/" + deploymentID
}

// Slack posts to an incoming webhook.
type Slack struct {
	Webhook string
	// Server is the Alror workspace URL; empty in local mode (no link).
	Server string
}

// Title is the bold first line of a notification: what happened, in one phrase.
func Title(d *domain.Deployment) (icon, title string) {
	ref := strings.TrimSpace(d.Service + " " + d.Ref)
	switch {
	case d.Recovery == domain.RecoveryFailed:
		return ":rotating_light:", fmt.Sprintf("ROLLBACK FAILED %s at %d%% traffic · traffic state unknown", ref, d.Weight)
	case d.Status == domain.StatusFailed:
		return ":x:", fmt.Sprintf("FAILED %s at %d%% traffic · rollback attempted", ref, d.Weight)
	case d.Status == domain.StatusRolledBack:
		return ":rewind:", fmt.Sprintf("Rolled back %s at %d%% traffic", ref, d.Weight)
	default:
		return ":white_check_mark:", fmt.Sprintf("Promoted %s to 100%%", ref)
	}
}

// Message is the Slack text for an outcome. consoleURL may be empty.
func Message(d *domain.Deployment, summary, consoleURL string) string {
	icon, title := Title(d)
	msg := fmt.Sprintf("%s *%s*\n%s\nRisk %d (%s) · deployment `%s`", icon, title, summary, d.Risk.Score, d.Risk.Level, d.ID)
	if consoleURL != "" {
		msg += fmt.Sprintf("\n<%s|Open in console>", consoleURL)
	}
	return msg
}

// Notify implements Notifier.
func (s Slack) Notify(ctx context.Context, d *domain.Deployment, summary string) error {
	body, _ := json.Marshal(map[string]string{"text": Message(d, summary, ConsoleURL(s.Server, d.ID))})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Webhook, bytes.NewReader(body))
	if err != nil {
		return errors.New("slack webhook: the URL is invalid")
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		// url.Error quotes the request URL, and the webhook URL is a secret.
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return fmt.Errorf("slack webhook: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("slack webhook: HTTP %d", res.StatusCode)
	}
	return nil
}
