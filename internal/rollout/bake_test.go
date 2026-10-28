package rollout

import "testing"

func TestCompressSimulatedBakes(t *testing.T) {
	cases := []struct {
		name             string
		target, provider string
		scale            float64
		fast, full       bool
		want             bool
	}{
		{"simulated synthetic default", "simulated", "synthetic", 1, false, false, true},
		{"--full-bakes keeps timings", "simulated", "synthetic", 1, false, true, false},
		{"--fast already set", "simulated", "synthetic", 1, true, false, false},
		{"tuned scale still compresses", "simulated", "synthetic", 0.6, false, false, true},
		{"already at the fast scale", "simulated", "synthetic", FastBakeScale, false, false, false},
		{"real target", "kubernetes", "synthetic", 1, false, false, false},
		{"real metrics", "simulated", "prometheus", 1, false, false, false},
	}
	for _, c := range cases {
		if got := CompressSimulatedBakes(c.target, c.provider, c.scale, c.fast, c.full); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}
