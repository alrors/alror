CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_label" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"target" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_actor_type_check" CHECK (actor_type in ('user', 'api_key', 'system'))
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"weight" integer,
	"verdict" jsonb,
	CONSTRAINT "deployment_events_kind_check" CHECK (kind in ('created', 'step', 'verdict', 'promoted', 'rolled_back', 'error'))
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"service" text NOT NULL,
	"image" text NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"risk" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"source" text DEFAULT 'cli' NOT NULL,
	"created_by_user" uuid,
	"created_by_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_status_check" CHECK (status in ('pending', 'rolling', 'promoted', 'rolled_back', 'failed')),
	CONSTRAINT "deployments_source_check" CHECK (source in ('cli', 'console', 'ci', 'runner'))
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"protected" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_role_check" CHECK (role in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"requested_by_user" uuid,
	"requested_by_key" uuid,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"deployment_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_kind_check" CHECK (kind in ('deploy', 'rollback')),
	CONSTRAINT "jobs_status_check" CHECK (status in ('queued', 'claimed', 'done', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK (role in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "notification_reads" (
	"notification_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_notification_id_user_id_pk" PRIMARY KEY("notification_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_policies" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"max_regression" jsonb DEFAULT '{"error_rate":0.25,"latency_p95":0.15}'::jsonb NOT NULL,
	"alpha" numeric DEFAULT 0.05 NOT NULL,
	"auto_rollback" boolean DEFAULT true NOT NULL,
	"bake_scale" numeric DEFAULT 1 NOT NULL,
	"metrics" jsonb DEFAULT '{"provider":"synthetic"}'::jsonb NOT NULL,
	"slack_webhook" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'team' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_plan_check" CHECK (plan in ('free', 'team', 'business'))
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paths" text[] DEFAULT '{}'::text[] NOT NULL,
	"target" text DEFAULT 'simulated' NOT NULL,
	"cluster" text DEFAULT '' NOT NULL,
	"namespace" text DEFAULT '' NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"policy_override" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "services_target_check" CHECK (target in ('simulated', 'kubernetes', 'ecs'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_lower" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_events" ADD CONSTRAINT "deployment_events_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_user_users_id_fk" FOREIGN KEY ("created_by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_created_by_key_api_keys_id_fk" FOREIGN KEY ("created_by_key") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_user_users_id_fk" FOREIGN KEY ("requested_by_user") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_key_api_keys_id_fk" FOREIGN KEY ("requested_by_key") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policies" ADD CONSTRAINT "org_policies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policies" ADD CONSTRAINT "org_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_at_idx" ON "audit_log" USING btree ("org_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployment_events_dep_idx" ON "deployment_events" USING btree ("deployment_id","id");--> statement-breakpoint
CREATE INDEX "deployments_org_created_idx" ON "deployments" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployments_org_service_created_idx" ON "deployments" USING btree ("org_id","service_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "deployments_org_status_idx" ON "deployments" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_org_name_key" ON "environments" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "jobs_org_status_created_idx" ON "jobs" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_org_created_idx" ON "jobs" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "services_org_name_key" ON "services" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");