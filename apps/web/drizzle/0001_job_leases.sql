ALTER TABLE "jobs" ADD COLUMN "claimed_by_key" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_claimed_by_key_api_keys_id_fk" FOREIGN KEY ("claimed_by_key") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_org_claimed_heartbeat_idx" ON "jobs" USING btree ("org_id","heartbeat_at") WHERE status = 'claimed';