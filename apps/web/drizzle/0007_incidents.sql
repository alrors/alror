CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"fingerprint" text NOT NULL,
	"title" text NOT NULL,
	"service" text DEFAULT '' NOT NULL,
	"environment" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"event_count" integer DEFAULT 1 NOT NULL,
	"raw" jsonb NOT NULL,
	"candidates" jsonb NOT NULL,
	"auto_action" jsonb,
	"rollback_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_status_check" CHECK (status in ('open', 'resolved')),
	CONSTRAINT "incidents_severity_check" CHECK (severity in ('critical', 'error', 'warning', 'info'))
);
--> statement-breakpoint
CREATE TABLE "org_alert_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"secret_prefix" text,
	"secret_hash" text,
	"secret_rotated_at" timestamp with time zone,
	"auto_rollback" boolean DEFAULT false NOT NULL,
	"threshold" integer DEFAULT 80 NOT NULL,
	"max_age_minutes" integer DEFAULT 30 NOT NULL,
	"window_minutes" integer DEFAULT 120 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "org_alert_settings_threshold_check" CHECK (threshold between 0 and 100),
	CONSTRAINT "org_alert_settings_minutes_check" CHECK (max_age_minutes between 1 and 1440 and window_minutes between 5 and 1440)
);
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_alert_settings" ADD CONSTRAINT "org_alert_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_alert_settings" ADD CONSTRAINT "org_alert_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_fingerprint_key" ON "incidents" USING btree ("org_id","source","fingerprint") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "incidents_org_status_started_idx" ON "incidents" USING btree ("org_id","status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_org_created_idx" ON "incidents" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "org_alert_settings_secret_prefix_key" ON "org_alert_settings" USING btree ("secret_prefix");