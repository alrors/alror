CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"message" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_policies" ADD COLUMN "plans" jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_org_created_idx" ON "feedback" USING btree ("org_id","created_at" DESC NULLS LAST);