"use client";

import { useId, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { LogoMark } from "../navbar";
import { SCENARIOS, series } from "./rollout-data";

/** User-controlled preview using the same captured CLI verdicts as the deeper demos. */
export function ReleasePreview() {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [stageIndex, setStageIndex] = useState(1);
  const chartId = useId();
  const scenario = SCENARIOS[scenarioIndex];
  const regression = scenario.id === "regression";
  const stage =
    scenario.stages[Math.min(stageIndex, scenario.stages.length - 1)];
  const error = stage.verdicts[0];
  const latency = stage.verdicts[1];
  const promoted = !regression && stageIndex === 3;
  const weights = [5, 25, 50, 100];
  const color = regression ? "#f4887f" : "#64dca6";
  const path = (values: number[]) =>
    values
      .map(
        (value, i) =>
          `${i ? "L" : "M"}${((i / (values.length - 1)) * 640).toFixed(1)},${(130 - (value / 0.5) * 120).toFixed(1)}`,
      )
      .join(" ");
  const canary = path(
    series(error.canary, 60, regression ? 0.12 : 0.09, 11 + stageIndex),
  );
  const baseline = path(series(error.baseline, 60, 0.05, 97));

  return (
    <div className="lp-release-frame">
      <div className="lp-release-bar">
        <div className="lp-release-breadcrumb">
          <LogoMark className="h-5 w-5" />
          <span>acme</span>
          <span className="lp-slash">/</span>
          <span>checkout-api</span>
          <ChevronRight size={12} />
          <span className="lp-environment">Production</span>
        </div>
        <span className="lp-demo-label">
          <span /> Interactive demo
        </span>
      </div>
      <div className="lp-release-body">
        <div className="lp-release-main">
          <div className="lp-release-heading">
            <div>
              <p className="lp-overline">DEPLOYMENT OVERVIEW</p>
              <h2>Every release. Under control.</h2>
            </div>
            <span className={`lp-verdict ${regression ? "is-warning" : ""}`}>
              {regression ? <RotateCcw size={12} /> : <ShieldCheck size={13} />}
              {regression ? "Rolled back" : promoted ? "Promoted" : "Verified"}
            </span>
          </div>
          <div className="lp-release-ref">
            <GitBranch size={13} />
            <span>main</span>
            <span className="lp-ref-dot">·</span>
            <span>{scenario.image}</span>
            <span className="lp-pr-ref">{scenario.ref}</span>
          </div>
          <div className="lp-stage-track" aria-label="Preview rollout stage">
            {weights.map((weight, i) => {
              const reached = regression ? i === 0 : i <= stageIndex;
              return (
                <button
                  key={weight}
                  type="button"
                  disabled={regression && i > 0}
                  aria-pressed={stageIndex === i}
                  onClick={() => setStageIndex(i)}
                  className={`lp-stage ${reached ? "is-reached" : ""} ${stageIndex === i ? "is-current" : ""} ${regression && i === 0 ? "is-warning" : ""}`}
                >
                  <span className="lp-stage-node">
                    {regression && i === 0 ? (
                      <RotateCcw size={13} />
                    ) : reached ? (
                      <Check size={14} />
                    ) : (
                      <span />
                    )}
                  </span>
                  <strong>{weight}%</strong>
                  <small>
                    {regression
                      ? i === 0
                        ? "Rolled back"
                        : "Protected"
                      : i < stageIndex
                        ? "Passed"
                        : i === stageIndex
                          ? promoted
                            ? "Promoted"
                            : "Verified"
                          : "Next stage"}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="lp-metric-row">
            <div>
              <span>Error rate</span>
              <strong>
                {error.canary.toFixed(3)}
                <small>%</small>
              </strong>
              <em className={regression ? "is-warning" : ""}>
                {regression ? (
                  <ArrowUpRight size={12} />
                ) : (
                  <ArrowDownLeft size={12} />
                )}
                {Math.abs(error.delta * 100).toFixed(1)}% vs baseline
              </em>
            </div>
            <div>
              <span>p95 latency</span>
              <strong>
                {latency.canary}
                <small>ms</small>
              </strong>
              <em>
                <ArrowDownLeft size={12} />
                {Math.abs(latency.delta * 100).toFixed(1)}% vs baseline
              </em>
            </div>
            <div>
              <span>Canary traffic</span>
              <strong>
                {regression ? "0" : promoted ? "100" : stage.weight}
                <small>%</small>
              </strong>
              <em className="lp-neutral">
                {regression
                  ? "Baseline restored"
                  : promoted
                    ? "Fully promoted"
                    : "Progressive rollout"}
              </em>
            </div>
          </div>
          <div className="lp-preview-chart">
            <div className="lp-chart-heading">
              <span>
                <Activity size={12} /> Error rate
              </span>
              <div>
                <span>
                  <i style={{ background: color }} />
                  Canary
                </span>
                <span>
                  <i />
                  Baseline
                </span>
              </div>
            </div>
            <svg
              viewBox="0 0 640 145"
              role="img"
              aria-label={`Illustrative error-rate samples. Canary ${error.canary}%, baseline ${error.baseline}%.`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id={chartId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.13" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[25, 65, 105].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="640"
                  y1={y}
                  y2={y}
                  stroke="#242829"
                  strokeDasharray="3 5"
                />
              ))}
              <path
                d={`${canary} L640,145 L0,145 Z`}
                fill={`url(#${chartId})`}
              />
              <path
                d={baseline}
                fill="none"
                stroke="#737b79"
                strokeWidth="1.5"
                strokeDasharray="4 5"
              />
              <path
                d={canary}
                fill="none"
                stroke={color}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <div className="lp-chart-axis">
              <span>Stage start</span>
              <span>Verification window</span>
              <span>Stage end</span>
            </div>
          </div>
        </div>
        <aside className="lp-release-aside" aria-label="Release decisions">
          <div className="lp-risk-heading">
            <span className="lp-overline">CHANGE INTELLIGENCE</span>
            <GitPullRequest size={14} />
          </div>
          <div className="lp-risk-number">
            62<span>/ 100</span>
            <span className="lp-risk-pill">Medium risk</span>
          </div>
          <div className="lp-risk-meter" aria-label="Risk score 62 out of 100">
            {Array.from({ length: 30 }, (_, i) => (
              <span key={i} className={i < 19 ? "is-filled" : ""} />
            ))}
          </div>
          <p className="lp-risk-description">
            Higher risk. Smaller steps.
            <br />A rollout that matches the change.
          </p>
          <div className="lp-risk-factors">
            <span>
              Critical service <b>+12</b>
            </span>
            <span>
              Recent rollbacks <b>+12</b>
            </span>
            <span>
              Payment path <b>+10</b>
            </span>
            <a href="#risk">
              Explore risk factors <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="lp-event-list">
            <p className="lp-overline">RELEASE ACTIVITY</p>
            <div>
              <span className="lp-event-icon">
                <Check size={11} />
              </span>
              <p>
                Change evaluated<small>Risk-sized plan selected</small>
              </p>
            </div>
            <div>
              <span className="lp-event-icon">
                <Box size={11} />
              </span>
              <p>
                Canary deployed
                <small>{scenario.image.split(":")[1]} · checkout-api</small>
              </p>
            </div>
            <div>
              <span
                className={`lp-event-icon ${regression ? "is-warning" : ""}`}
              >
                {regression ? (
                  <RotateCcw size={11} />
                ) : (
                  <ShieldCheck size={11} />
                )}
              </span>
              <p>
                {regression ? "Regression contained" : "Metrics verified"}
                <small>
                  {regression
                    ? "Traffic returned to baseline"
                    : "Error rate and latency passed"}
                </small>
              </p>
            </div>
          </div>
        </aside>
      </div>
      <div className="lp-preview-bottom">
        <span>
          <span className="lp-status-dot" />
          {regression
            ? "Caught at 5%. Baseline restored."
            : "Your infrastructure. A little more confidence."}
        </span>
        <div
          className="lp-scenario-switch"
          role="group"
          aria-label="Release scenario"
        >
          {SCENARIOS.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={i === scenarioIndex}
              onClick={() => {
                setScenarioIndex(i);
                setStageIndex(i === 0 ? 1 : 0);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <span className="sr-only" role="status">
        {scenario.label}:{" "}
        {regression
          ? "Rolled back. Baseline restored."
          : `${weights[stageIndex]} percent stage ${promoted ? "promoted" : "verified"}.`}
      </span>
    </div>
  );
}
