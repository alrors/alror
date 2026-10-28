# Rollouts and verification

The engine is a small state machine. It persists every transition, so an interrupted run leaves an accurate record behind.

```
pending → rolling ─┬─ step passes ──────────────▶ next step … → promoted
                   ├─ step fails, auto_rollback ─▶ rolled_back
                   │                    rollback errors ─▶ failed (recovery: rollback_failed, exit 4)
                   ├─ step fails, shadow mode ───▶ continue (recommendation logged)
                   └─ driver error ──────────────▶ failed (rollback attempted; result recorded in recovery)
```

A step fails on a measured regression **and** on insufficient or invalid data. Nothing passes without evidence.

## Before the first step

1. The target and metrics provider are checked against the [capability matrix](/targets). Unsupported targets are refused. A non-simulated target with the `synthetic` provider is refused unless `policy.allow_synthetic_telemetry: true`.
2. The driver prepares the new image **once**, whatever the first step's weight. A low-risk plan that starts at 25% applies the image exactly like a high-risk plan that starts at 1%, and later steps never re-apply it.

## Each step

1. The driver is asked to move the canary to the step's weight. The step event records the requested weight and its `routing` evidence: `simulated`, `requested` (accepted by the target, not read back) or `observed`. A successful command is not treated as proof of the traffic split.
2. The engine waits for the bake period, scaled by `bake_scale`.
3. The metrics provider returns canary and baseline samples for each metric.
4. The verifier judges each metric. The verdict is labelled `evidence: synthetic` or `evidence: measured`.

## The verifier

When the baseline median is positive, a metric is a **regression** only when both are true:

- the canary median is worse than the baseline median by more than `max_regression` (relative), and
- a one-sided Mann-Whitney U test gives p < `alpha`.

When the baseline median is zero, a relative change is undefined, so the absolute increase is judged instead: the canary is a regression when its median exceeds the baseline by more than `max_increase` (in the metric's own units) and p < `alpha`. The default is `0.01` for `error_rate` (the documented query reports percent) and `0` for other metrics. Zero errors on both sides is healthy.

Requiring both effect size and significance keeps false rollbacks rare: a noisy blip that isn't significant passes, and so does a significant but tiny drift.

Every metric result has a `status`, and the verdict an `outcome`:

| Value | Meaning | Step |
| --- | --- | --- |
| `pass` | Enough finite samples, no regression | passes |
| `regression` | The canary was measured to be worse | fails |
| `insufficient_data` | No metrics at all, a required metric missing, or fewer than 8 samples per side | fails |
| `invalid_data` | NaN or ±Inf observations | fails |

A measured regression is reported ahead of bad data, and bad data ahead of missing data. Summaries start with `Regression:`, `Invalid data:` or `Insufficient data:`, so a report never presents missing telemetry as a measured regression, or as a pass.

## Rollback

When a step fails with `auto_rollback` on, the engine asks the driver to roll back. The deployment records `recovery`:

| `recovery` | Meaning |
| --- | --- |
| `rollback_simulated` | The simulated target recorded traffic back on stable |
| `rollback_requested` | The driver accepted the rollback; restored traffic was not observed |
| `rollback_failed` | The driver returned an error. Traffic may still be on the canary: the state is unknown. Status is `failed`, and `alror deploy` / `alror rollback` exit `4` |

An interrupted rollout (Ctrl-C, `SIGTERM`, a lost runner lease) still runs the rollback, with its own two-minute timeout, and is recorded as failed with a plain reason such as "Stopped (interrupt or SIGTERM); canary rolled back".
