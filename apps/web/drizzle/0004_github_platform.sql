CREATE TABLE "github_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"repository_id" text NOT NULL,
	"pull_number" integer NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"head_sha" text NOT NULL,
	"base_sha" text NOT NULL,
	"policy_version" integer NOT NULL,
	"mode" text NOT NULL,
	"outcome" text NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb NOT NULL,
	"check_id" text,
	"comment_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"installation_id" text,
	"repository_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "github_deliveries_status_check" CHECK (status in ('queued', 'processing', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "github_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"full_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"policy" jsonb NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"enrolled_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "github_decisions" ADD CONSTRAINT "github_decisions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_decisions" ADD CONSTRAINT "github_decisions_repository_id_github_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_decisions_revision_key" ON "github_decisions" USING btree ("repository_id","pull_number","head_sha","base_sha","policy_version");--> statement-breakpoint
CREATE INDEX "github_decisions_org_updated_idx" ON "github_decisions" USING btree ("org_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "github_deliveries_claim_idx" ON "github_deliveries" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "github_repositories_org_idx" ON "github_repositories" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "github_repositories_installation_idx" ON "github_repositories" USING btree ("installation_id");