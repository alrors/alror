CREATE TABLE "shadow_feedback" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"service" text NOT NULL,
	"verdict" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shadow_feedback_verdict_check" CHECK (verdict in ('correct', 'false_alarm'))
);
--> statement-breakpoint
ALTER TABLE "org_policies" ADD COLUMN "trust_ramp" jsonb;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "rollback_mode" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "ramp_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shadow_feedback" ADD CONSTRAINT "shadow_feedback_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_feedback" ADD CONSTRAINT "shadow_feedback_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shadow_feedback" ADD CONSTRAINT "shadow_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shadow_feedback_org_service_idx" ON "shadow_feedback" USING btree ("org_id","service");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_rollback_mode_check" CHECK (rollback_mode is null or rollback_mode in ('auto', 'shadow'));