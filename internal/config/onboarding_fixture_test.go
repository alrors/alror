package config_test

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"

	"github.com/alrors/alror/internal/config"
	"github.com/alrors/alror/internal/driver"
)

// The portal (apps/web, TypeScript) proposes alror.yaml files during GitHub
// onboarding. Its tests write golden proposals to testdata/onboarding; this test
// proves the CLI accepts them: strict field names, the real loader and a driver
// for every target.
func TestOnboardingProposalsLoad(t *testing.T) {
	dirs, err := filepath.Glob(filepath.Join("..", "..", "testdata", "onboarding", "*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(dirs) == 0 {
		t.Fatal("no onboarding fixtures found in testdata/onboarding")
	}
	for _, dir := range dirs {
		t.Run(filepath.Base(dir), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, config.FileName))
			if err != nil {
				t.Fatal(err)
			}
			dec := yaml.NewDecoder(bytes.NewReader(raw))
			dec.KnownFields(true)
			var strict config.Config
			if err := dec.Decode(&strict); err != nil {
				t.Fatalf("unknown or mistyped field: %v", err)
			}
			cfg, err := config.Load(dir)
			if err != nil {
				t.Fatal(err)
			}
			if cfg.Policy.AutoRollback {
				t.Error("onboarding proposals must start in shadow mode")
			}
			for _, svc := range cfg.Services {
				if _, err := driver.For(svc); err != nil {
					t.Errorf("service %s: %v", svc.Name, err)
				}
			}
		})
	}
}
