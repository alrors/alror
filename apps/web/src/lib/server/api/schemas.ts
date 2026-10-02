import "server-only";
import { z } from "zod";
import { EVENT_KINDS, JOB_STATUSES, SOURCES, STATUSES, TARGETS } from "../db/schema";

// Request schemas for /api/v1. Domain shapes follow alror/internal/domain (snake_case, bake in ns).

const nullableArray = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform((v) => v ?? null);

export const Factor = z.looseObject({ name: z.string(), detail: z.string(), points: z.number().int() });

export const Risk = z.looseObject({
  score: z.number().int().min(0).max(100),
  level: z.enum(["low", "medium", "high"]),
  factors: nullableArray(Factor),
  services: nullableArray(z.string()),
  ai_authored: z.boolean().default(false),
});

export const Step = z.looseObject({ weight: z.number().int().min(0).max(100), bake: z.number().int().min(0) });
export const Plan = z.looseObject({ strategy: z.string(), steps: nullableArray(Step) });

export const MetricResult = z.looseObject({
  metric: z.string(),
  canary: z.number(),
  baseline: z.number(),
  delta: z.number(),
  p_value: z.number(),
  pass: z.boolean(),
  reason: z.string().optional(),
});

export const Verdict = z.looseObject({ pass: z.boolean(), results: nullableArray(MetricResult), summary: z.string() });

const time = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an RFC 3339 time");

export const DeploymentBody = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  service: z.string().min(1).max(128),
  image: z.string().max(512),
  ref: z.string().max(256).optional(),
  risk: Risk,
  plan: Plan,
  status: z.enum(STATUSES),
  step_index: z.number().int().min(0),
  weight: z.number().int().min(0).max(100),
  reason: z.string().max(4000).optional(),
  created_at: time.optional(),
  updated_at: time.optional(),
  // Extensions (not in the Go struct; optional):
  environment: z.string().max(40).optional(),
  source: z.enum(SOURCES).optional(),
});

export const EventBody = z.object({
  at: time.optional(),
  kind: z.enum(EVENT_KINDS),
  message: z.string().max(4000).default(""),
  weight: z.number().int().min(0).max(100).optional(),
  verdict: Verdict.nullish(),
});

export const JobBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("deploy"),
    payload: z.object({
      service: z.string().min(1),
      image: z.string().min(1),
      ref: z.string().optional(),
      environment: z.string().optional(),
      shadow: z.boolean().optional(),
      /** A level or a 0-100 score (number or numeric string); stored as sent. */
      risk_override: z
        .union([
          z.enum(["low", "medium", "high"]),
          z.number().int().min(0).max(100),
          z.string().regex(/^\d{1,3}$/).refine((v) => Number(v) <= 100, "score must be 0 to 100"),
          z.literal(""),
        ])
        .optional(),
    }),
  }),
  z.object({
    kind: z.literal("rollback"),
    payload: z.object({ deployment_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), reason: z.string().max(500).optional() }),
  }),
]);

/** `worker` is the contract's field name; `runner` is accepted as an alias. Stored as claimed_by. */
export const ClaimBody = z.object({
  worker: z.string().min(1).max(128).optional(),
  runner: z.string().min(1).max(128).optional(),
  /** Optional override of the long-poll wait, in seconds (0..25). */
  wait: z.number().min(0).max(25).optional(),
});

export const FinishBody = z.object({
  status: z.enum(["done", "failed"]),
  /** Optional claimer name; when sent, a finish by a runner that lost its lease is a 409. */
  worker: z.string().min(1).max(128).optional(),
  runner: z.string().min(1).max(128).optional(),
  error: z.string().max(4000).optional(),
  deployment_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});

export const HeartbeatBody = z.object({
  worker: z.string().min(1).max(128).optional(),
  runner: z.string().min(1).max(128).optional(),
});

export const JobStatusQuery = z.enum(JOB_STATUSES).optional();

export const ConfigBody = z.object({
  project: z.string().optional(),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        paths: z.array(z.string()).nullish().transform((v) => v ?? []),
        target: z
          .enum(TARGETS)
          .or(z.literal(""))
          .optional()
          .transform((v) => (v ? v : "simulated")),
        cluster: z.string().optional(),
        namespace: z.string().optional(),
        critical: z.boolean().optional(),
      }),
    )
    .nullish()
    .transform((v) => v ?? undefined),
  metrics: z
    .object({ provider: z.string().min(1), url: z.string().optional(), queries: z.record(z.string(), z.string()).nullish().transform((v) => v ?? undefined) })
    .optional(),
  policy: z
    .object({
      max_regression: z.record(z.string(), z.number().min(0)).nullish().transform((v) => v ?? undefined),
      alpha: z.number().gt(0).lt(1).optional(),
      auto_rollback: z.boolean().optional(),
      bake_scale: z.number().min(0).optional(),
      /** Optional custom rollout plans per risk level; null resets to the built-in planner. */
      plans: z
        .partialRecord(
          z.enum(["low", "medium", "high"]),
          z.array(z.object({ weight: z.number().int().min(1).max(100), bake: z.number().int().min(0) })).min(1).max(10),
        )
        .nullish(),
    })
    .optional(),
  notify: z.object({ slack_webhook: z.string().optional() }).optional(),
});

export const SignupBody = z.object({
  email: z.string(),
  password: z.string(),
  name: z.string().optional(),
  org: z.string().optional(),
});

export const LoginBody = z.object({ email: z.string(), password: z.string() });
