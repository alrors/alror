package runner

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// maxHandled bounds the dedupe memory; the oldest entries are dropped first.
const maxHandled = 500

// WatchState is the watcher's memory across restarts: the last image seen
// on each watched Rollout and every image change already handled, keyed by
// DedupeKey. With no path it lives in memory only.
type WatchState struct {
	path   string
	mu     sync.Mutex // guards data
	saveMu sync.Mutex // serialises writes, so the newest data lands last
	data   watchFile
}

type watchFile struct {
	Version  int                      `json:"version"`
	Services map[string]*ServiceWatch `json:"services"`
	Handled  map[string]Handled       `json:"handled"`
}

// ServiceWatch is the last image the watcher saw on a service's Rollout.
type ServiceWatch struct {
	Image      string    `json:"image"`
	Generation int64     `json:"generation"`
	SeenAt     time.Time `json:"seen_at"`
}

// Handled records what the watcher decided for one image change.
type Handled struct {
	Service    string    `json:"service"`
	Image      string    `json:"image"`
	Generation int64     `json:"generation"`
	At         time.Time `json:"at"`
	// DeploymentID is the release the watcher started, or the deployment
	// that already controlled the change.
	DeploymentID string `json:"deployment_id,omitempty"`
	// Outcome is "released" or "skipped: <reason>".
	Outcome string `json:"outcome"`
}

// DedupeKey identifies one image change: service plus image (tag or digest).
func DedupeKey(service, image string) string { return service + "|" + image }

// OpenWatchState loads the state file at path, creating nothing until the
// first save. An empty path keeps the state in memory.
func OpenWatchState(path string) (*WatchState, error) {
	s := &WatchState{path: path, data: watchFile{Version: 1, Services: map[string]*ServiceWatch{}, Handled: map[string]Handled{}}}
	if path == "" {
		return s, nil
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if s.data.Services == nil {
		s.data.Services = map[string]*ServiceWatch{}
	}
	if s.data.Handled == nil {
		s.data.Handled = map[string]Handled{}
	}
	return s, nil
}

// Path is the state file ("" when in memory).
func (s *WatchState) Path() string { return s.path }

// Last returns the last image seen for a service.
func (s *WatchState) Last(service string) (ServiceWatch, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w, ok := s.data.Services[service]
	if !ok {
		return ServiceWatch{}, false
	}
	return *w, true
}

// Lookup returns the handled entry for a dedupe key.
func (s *WatchState) Lookup(key string) (Handled, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h, ok := s.data.Handled[key]
	return h, ok
}

// Seen records the image now on a service's Rollout and saves.
func (s *WatchState) Seen(service, image string, generation int64) error {
	s.mu.Lock()
	s.data.Services[service] = &ServiceWatch{Image: image, Generation: generation, SeenAt: time.Now().UTC()}
	s.mu.Unlock()
	return s.save()
}

// Record stores a handled image change (and the image as seen) and saves.
// It is written before a release starts, so a restart mid-release does not
// start it again.
func (s *WatchState) Record(h Handled) error {
	s.mu.Lock()
	if h.At.IsZero() {
		h.At = time.Now().UTC()
	}
	s.data.Handled[DedupeKey(h.Service, h.Image)] = h
	s.data.Services[h.Service] = &ServiceWatch{Image: h.Image, Generation: h.Generation, SeenAt: h.At}
	s.prune()
	s.mu.Unlock()
	return s.save()
}

// Update changes the outcome of a handled entry (e.g. a release that could
// not start) and saves.
func (s *WatchState) Update(key, outcome string) error {
	s.mu.Lock()
	if h, ok := s.data.Handled[key]; ok {
		h.Outcome = outcome
		s.data.Handled[key] = h
	}
	s.mu.Unlock()
	return s.save()
}

func (s *WatchState) prune() {
	if len(s.data.Handled) <= maxHandled {
		return
	}
	keys := make([]string, 0, len(s.data.Handled))
	for k := range s.data.Handled {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return s.data.Handled[keys[i]].At.Before(s.data.Handled[keys[j]].At) })
	for _, k := range keys[:len(keys)-maxHandled] {
		delete(s.data.Handled, k)
	}
}

// save writes the file atomically (temp file, then rename).
func (s *WatchState) save() error {
	if s.path == "" {
		return nil
	}
	s.saveMu.Lock()
	defer s.saveMu.Unlock()
	s.mu.Lock()
	raw, err := json.MarshalIndent(s.data, "", "  ")
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".watch-*.json")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return err
	}
	return os.Rename(tmp.Name(), s.path)
}
