package rollout

// FastBakeScale turns a 10-minute bake into about 2 seconds.
const FastBakeScale = 0.003

// CompressSimulatedBakes reports whether bakes should be shortened
// automatically. Waiting on generated samples proves nothing, so a simulated
// target with synthetic metrics bakes in seconds unless the bakes are already
// that short, the caller asked for --fast explicitly, or --full-bakes asks for
// real timings.
func CompressSimulatedBakes(target, provider string, bakeScale float64, fast, full bool) bool {
	return target == "simulated" && provider == "synthetic" && bakeScale > FastBakeScale && !fast && !full
}
