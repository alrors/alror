ALTER TABLE "github_decisions" ADD COLUMN "risk" jsonb;--> statement-breakpoint
ALTER TABLE "github_decisions" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "github_decisions" ADD COLUMN "merge_sha" text;--> statement-breakpoint
CREATE INDEX "github_decisions_org_head_idx" ON "github_decisions" USING btree ("org_id","head_sha");--> statement-breakpoint
CREATE INDEX "github_decisions_org_merge_idx" ON "github_decisions" USING btree ("org_id","merge_sha");