// Mirrors alror/internal/domain/domain.go. Keep the JSON field names in sync.

export type Status = "pending" | "rolling" | "promoted" | "rolled_back" | "failed";
export type Level = "low" | "medium" | "high";

export type Factor = { name: string; detail: string; points: number };

export type RiskReport = {
  score: number;
  level: Level;
  factors: Factor[] | null;
  services: string[] | null;
  ai_authored: boolean;
};

/** bake is a Go time.Duration, serialised as integer nanoseconds. */
export type Step = { weight: number; bake: number };

export type Plan = { strategy: string; steps: Step[] | null };

export type MetricResult = {
  metric: string;
  canary: number;
  baseline: number;
  delta: number;
  p_value: number;
  pass: boolean;
  reason?: string;
};

export type Verdict = { pass: boolean; results: MetricResult[] | null; summary: string };

export type Deployment = {
  id: string;
  service: string;
  image: string;
  ref?: string;
  risk: RiskReport;
  plan: Plan;
  status: Status;
  step_index: number;
  weight: number;
  reason?: string;
  created_at: string;
  updated_at: string;
  /**
   * Result of the last rollback attempt (Go Deployment.Recovery). Absent when no
   * rollback was attempted, or when the writing client predates the field.
   */
  recovery?: Recovery;
  /** Platform extensions (not in the Go struct): environment name and where the write came from. */
  environment?: string;
  source?: "cli" | "ci" | "console" | "runner";
};

/** rollback_simulated: the simulated target moved traffic back; rollback_requested: the driver accepted the command but the split was not observed; rollback_failed: the command errored and production state is unknown. */
export type Recovery = "rollback_simulated" | "rollback_requested" | "rollback_failed";

export type EventKind = "created" | "step" | "verdict" | "promoted" | "rolled_back" | "error";

export type DeployEvent = {
  at: string;
  kind: EventKind;
  message: string;
  weight?: number;
  verdict?: Verdict;
};
