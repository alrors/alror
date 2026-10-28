CREATE TABLE "tuning_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"service_id" uuid,
	"service" text,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"auto_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_label" text,
	CONSTRAINT "tuning_proposals_kind_check" CHECK (kind in ('service_policy', 'risk_weights')),
	CONSTRAINT "tuning_proposals_status_check" CHECK (status in ('open', 'accepted', 'dismissed', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "tuning_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"bounds" jsonb,
	"risk_weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "tuning_proposals" ADD CONSTRAINT "tuning_proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuning_proposals" ADD CONSTRAINT "tuning_proposals_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuning_proposals" ADD CONSTRAINT "tuning_proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuning_settings" ADD CONSTRAINT "tuning_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tuning_settings" ADD CONSTRAINT "tuning_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tuning_proposals_org_status_idx" ON "tuning_proposals" USING btree ("org_id","status","created_at" DESC NULLS LAST);