// Drizzle schema for the Alror platform. Mirrors docs/platform-contract.md, section 3.
// Generate SQL migrations with `npm run db:generate` and apply them with `npm run db:migrate`.

import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();

export const PLANS = ["free", "team", "business"] as const;
export const ROLES = ["owner", "admin", "member"] as const;
export const SCOPES = ["deploy:read", "deploy:write", "jobs:run", "config:write"] as const;
export const TARGETS = ["simulated", "kubernetes", "ecs"] as const;
export const STATUSES = ["pending", "rolling", "promoted", "rolled_back", "failed"] as const;
export const SOURCES = ["cli", "console", "ci", "runner"] as const;
export const EVENT_KINDS = ["created", "step", "verdict", "promoted", "rolled_back", "error"] as const;
export const JOB_KINDS = ["deploy", "rollback"] as const;
export const JOB_STATUSES = ["queued", "claimed", "done", "failed", "canceled"] as const;
export const ACTOR_TYPES = ["user", "api_key", "system"] as const;

export type Plan = (typeof PLANS)[number];
export type Role = (typeof ROLES)[number];
export type Scope = (typeof SCOPES)[number];
export type Target = (typeof TARGETS)[number];
export type DeploymentStatus = (typeof STATUSES)[number];
export type DeploymentSource = (typeof SOURCES)[number];
export type EventKindDb = (typeof EVENT_KINDS)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];

const oneOf = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(", ")})`);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_key").on(t.email), check("users_email_lower", sql`${t.email} = lower(${t.email})`)],
);

export const orgs = pgTable(
  "orgs",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    plan: text("plan").$type<Plan>().notNull().default("team"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("orgs_slug_key").on(t.slug), check("orgs_plan_check", oneOf("plan", PLANS))],
);

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_check", oneOf("role", ROLES)),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull().default("member"),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invites_token_hash_key").on(t.tokenHash),
    index("invites_org_idx").on(t.orgId),
    check("invites_role_check", oneOf("role", ROLES)),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().$type<Scope[]>().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_key_hash_key").on(t.keyHash), index("api_keys_org_idx").on(t.orgId)],
);

export const environments = pgTable(
  "environments",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    protected: boolean("protected").notNull().default(false),
  },
  (t) => [uniqueIndex("environments_org_name_key").on(t.orgId, t.name)],
);

export const services = pgTable(
  "services",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    paths: text("paths").array().notNull().default(sql`'{}'::text[]`),
    target: text("target").$type<Target>().notNull().default("simulated"),
    cluster: text("cluster").notNull().default(""),
    namespace: text("namespace").notNull().default(""),
    critical: boolean("critical").notNull().default(false),
    policyOverride: jsonb("policy_override").$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
    archivedAt: ts("archived_at"),
  },
  (t) => [uniqueIndex("services_org_name_key").on(t.orgId, t.name), check("services_target_check", oneOf("target", TARGETS))],
);

export const orgPolicies = pgTable("org_policies", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  maxRegression: jsonb("max_regression")
    .$type<Record<string, number>>()
    .notNull()
    .default({ error_rate: 0.25, latency_p95: 0.15 }),
  alpha: numeric("alpha", { mode: "number" }).notNull().default(0.05),
  autoRollback: boolean("auto_rollback").notNull().default(true),
  bakeScale: numeric("bake_scale", { mode: "number" }).notNull().default(1),
  metrics: jsonb("metrics")
    .$type<{ provider: string; url?: string; queries?: Record<string, string> }>()
    .notNull()
    .default({ provider: "synthetic" }),
  slackWebhook: text("slack_webhook"),
  /** Custom rollout plans per risk level ({low|medium|high: [{weight, bake (ns)}]}); null = the built-in planner. */
  plans: jsonb("plans").$type<Record<string, { weight: number; bake: number }[]> | null>(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const deployments = pgTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "no action" }),
    environmentId: uuid("environment_id")
      .notNull()
      .references(() => environments.id, { onDelete: "no action" }),
    service: text("service").notNull(),
    image: text("image").notNull(),
    ref: text("ref").notNull().default(""),
    status: text("status").$type<DeploymentStatus>().notNull(),
    stepIndex: integer("step_index").notNull().default(0),
    weight: integer("weight").notNull().default(0),
    reason: text("reason").notNull().default(""),
    risk: jsonb("risk").$type<unknown>().notNull(),
    plan: jsonb("plan").$type<unknown>().notNull(),
    source: text("source").$type<DeploymentSource>().notNull().default("cli"),
    createdByUser: uuid("created_by_user").references(() => users.id, { onDelete: "set null" }),
    createdByKey: uuid("created_by_key").references(() => apiKeys.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("deployments_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("deployments_org_service_created_idx").on(t.orgId, t.serviceId, t.createdAt.desc()),
    index("deployments_org_status_idx").on(t.orgId, t.status),
    check("deployments_status_check", oneOf("status", STATUSES)),
    check("deployments_source_check", oneOf("source", SOURCES)),
  ],
);

export const deploymentEvents = pgTable(
  "deployment_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
    kind: text("kind").$type<EventKindDb>().notNull(),
    message: text("message").notNull().default(""),
    weight: integer("weight"),
    verdict: jsonb("verdict").$type<unknown>(),
  },
  (t) => [index("deployment_events_dep_idx").on(t.deploymentId, t.id), check("deployment_events_kind_check", oneOf("kind", EVENT_KINDS))],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    kind: text("kind").$type<JobKind>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    requestedByUser: uuid("requested_by_user").references(() => users.id, { onDelete: "set null" }),
    requestedByKey: uuid("requested_by_key").references(() => apiKeys.id, { onDelete: "set null" }),
    claimedBy: text("claimed_by"),
    claimedByKey: uuid("claimed_by_key").references(() => apiKeys.id, { onDelete: "set null" }),
    claimedAt: ts("claimed_at"),
    /** Lease: a claimed job whose heartbeat is older than 2 minutes can be claimed again. */
    heartbeatAt: ts("heartbeat_at"),
    attempts: integer("attempts").notNull().default(0),
    finishedAt: ts("finished_at"),
    error: text("error"),
    deploymentId: text("deployment_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_org_status_created_idx").on(t.orgId, t.status, t.createdAt),
    index("jobs_org_created_idx").on(t.orgId, t.createdAt.desc()),
    index("jobs_org_claimed_heartbeat_idx").on(t.orgId, t.heartbeatAt).where(sql`status = 'claimed'`),
    check("jobs_kind_check", oneOf("kind", JOB_KINDS)),
    check("jobs_status_check", oneOf("status", JOB_STATUSES)),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    actorLabel: text("actor_label").notNull().default(""),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_at_idx").on(t.orgId, t.at.desc()), check("audit_log_actor_type_check", oneOf("actor_type", ACTOR_TYPES))],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    createdAt: createdAt(),
    readAt: ts("read_at"),
  },
  (t) => [index("notifications_org_created_idx").on(t.orgId, t.createdAt.desc())],
);

export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: ts("read_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] })],
);

/** In-console feedback ("Feedback" button in the top bar). Stored locally; never sent anywhere. */
export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    page: text("page").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("feedback_org_created_idx").on(t.orgId, t.createdAt.desc())],
);

/**
 * Marketplace plugins an org has installed (catalog: src/lib/server/marketplace/catalog.ts).
 * `config` holds non-secret settings only; secrets live in the policy (Slack webhook)
 * or in the runner's environment (Datadog keys) and are never copied here.
 */
export const orgPlugins = pgTable(
  "org_plugins",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    installedBy: uuid("installed_by").references(() => users.id, { onDelete: "set null" }),
    installedAt: ts("installed_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.pluginId] })],
);

/** "I want this" votes for planned marketplace items. One per user, per org. */
export const pluginVotes = pgTable(
  "plugin_votes",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.pluginId, t.userId] }), index("plugin_votes_plugin_idx").on(t.pluginId)],
);
