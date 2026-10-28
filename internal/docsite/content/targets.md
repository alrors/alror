# Targets and metrics

## Capability matrix

This is the single capability matrix for Alror. It is generated from `internal/capability` (a test keeps this page in sync) and printed by `alror capabilities` (`--json` for scripts).

| Maturity | Meaning |
| --- | --- |
| verified | End-to-end evidence: the effect is observed. Nothing is verified yet. |
| experimental | Calls real infrastructure without end-to-end evidence. Alror reports it as *requested*, never as observed. |
| simulated | Changes in-memory or generated state only. Nothing is deployed or measured. |
| unsupported | Not implemented. Deploys and rollbacks that need it are refused before anything is recorded. |

<!-- capability-matrix:start -->
| Target | Prepare image | Shift traffic | Promote | Rollback | Observe traffic | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `simulated` | simulated | simulated | simulated | simulated | simulated | Records weights in memory. For demos and tests; nothing is deployed. |
| `kubernetes` | experimental | experimental | experimental | experimental | unsupported | Argo Rollouts via `kubectl argo rollouts`: set image once, then promote/abort. The Rollout's own steps decide the real weights; Alror's step weights are requests and are not read back. |
| `ecs` | unsupported | unsupported | unsupported | unsupported | unsupported | Not implemented. Deploys and rollbacks to an ecs target are refused. |

| Metrics provider | Maturity | Notes |
| --- | --- | --- |
| `synthetic` | simulated | Generated samples. Never production verification; refused for non-simulated targets unless `policy.allow_synthetic_telemetry` is set. |
| `prometheus` | experimental | Real query_range data. Verdicts depend on your queries; empty or non-finite results never pass. |
| `datadog` | experimental | Real metrics API data. Verdicts depend on your queries; empty or non-finite results never pass. |
<!-- capability-matrix:end -->

## What the reports claim

- **Requested versus observed routing.** Each step event records the requested canary weight and a `routing` field: `simulated`, `requested` (the driver accepted the command; the applied split was not read back) or `observed`. No current target can observe traffic, so a Kubernetes step says "requested · applied split not observed". A successful `kubectl` exit is not treated as traffic verification.
- **Image preparation.** The new image is applied once, before the first step, whatever that step's weight. Later steps never re-apply it. On Kubernetes, setting the image starts the Argo Rollout at its first canary step; each later Alror step runs `promote` once, and the last runs `promote --full`.
- **Synthetic telemetry.** Verdicts carry `evidence: synthetic` or `evidence: measured`. With a non-simulated target, `alror deploy` and `alror runner` refuse the synthetic provider before recording anything, unless `policy.allow_synthetic_telemetry: true` is set; then every verdict and receipt is still labelled synthetic.
- **Rollback.** A deployment records `recovery`: `rollback_simulated`, `rollback_requested` (the driver accepted the rollback; restored traffic was not observed) or `rollback_failed` (the driver returned an error: traffic may still be on the canary). A failed rollback sets status `failed`, never `rolled_back`, and the CLI exits with code `4`.

## Targets

| Target | How it works |
| --- | --- |
| `simulated` | Records traffic changes in memory. The default, for demos and tests. |
| `kubernetes` | Drives an Argo Rollouts resource named after the service, using `kubectl argo rollouts` (`set image`, `promote`, `promote --full`, `abort`). Needs the kubectl plugin and a Rollout whose steps match your intent. |
| `ecs` | Unsupported. There is no ECS driver; deploys and rollbacks are refused. |

## Metrics providers

| Provider | Needs |
| --- | --- |
| `synthetic` | Nothing. Realistic noise, plus `--regress` to inject failures. Only for simulated targets by default. |
| `prometheus` | `metrics.url` and PromQL `queries`. Works with Thanos, Mimir and VictoriaMetrics. |
| `datadog` | `DD_API_KEY` and `DD_APP_KEY` env vars, plus `queries`. |
