# alror.yaml

Alror looks for `alror.yaml` in the working directory and its parents.

```yaml
project: shop
services:
  - name: checkout-api
    paths: [services/checkout/]
    target: kubernetes        # simulated | kubernetes (ecs is unsupported)
    cluster: prod-eu
    namespace: checkout
    critical: true
  - name: web-frontend
    paths: [web/]
    target: simulated
metrics:
  provider: prometheus        # synthetic | prometheus | datadog
  url: http://prometheus:9090
  queries:
    error_rate: >-
      sum(rate(http_requests_total{app="{{service}}",track="{{track}}",code=~"5.."}[1m]))
      / sum(rate(http_requests_total{app="{{service}}",track="{{track}}"}[1m])) * 100
    latency_p95: >-
      histogram_quantile(0.95, sum by (le)
      (rate(http_request_duration_seconds_bucket{app="{{service}}",track="{{track}}"}[1m]))) * 1000
policy:
  max_regression: { error_rate: 0.25, latency_p95: 0.15 }
  alpha: 0.05
  auto_rollback: true
  bake_scale: 1
notify:
  slack_webhook: https://hooks.slack.com/services/your/webhook/url
```

| Key | Meaning |
| --- | --- |
| `services[].paths` | Path prefixes that belong to the service. Used for blast radius. |
| `services[].critical` | Adds risk whenever the service is touched. |
| `metrics.queries` | `{{service}}` and `{{track}}` (`canary` or `baseline`) are substituted. |
| `services[].target` | `simulated` or `kubernetes` (experimental). `ecs` is unsupported and refused. See the [capability matrix](/targets). |
| `policy.max_regression` | Relative increase tolerated per metric (0.25 means +25%), used when the baseline median is positive. |
| `policy.max_increase` | Absolute increase tolerated per metric when the baseline median is zero, in the metric's units. Defaults: `error_rate` 0.01, others 0. |
| `policy.allow_synthetic_telemetry` | `true` lets a non-simulated target run with the `synthetic` provider; verdicts stay labelled synthetic. Default `false`: such deploys are refused. Local `alror.yaml` only for now. |
| `policy.alpha` | Significance level for the Mann-Whitney test. |
| `policy.auto_rollback` | `false` is shadow mode: recommend, never act. |
| `policy.bake_scale` | Multiplies every bake time. `init` sets 0.003 for simulated demos. |
| `services[].detect` | Experimental: `alror runner --watch` starts a release when this service's Argo Rollout changes image outside Alror. `kubernetes` target only. See [Release detection](/connected#release-detection-experimental). |
| `watch.enabled` | Turn release detection on without `--watch`. |
| `watch.interval` | Poll interval per Rollout, e.g. `30s` (default `15s`). |
| `watch.environment` | Environment recorded on detected releases in connected mode (default `production`). |
| `watch.state` | File that remembers handled image changes across restarts (default `.alror/watch.json`). |

`services[].detect` and `watch:` are read by the runner from the local `alror.yaml`, also in connected mode; they are not stored in the workspace.
