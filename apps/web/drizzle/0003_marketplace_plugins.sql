CREATE TABLE "org_plugins" (
	"org_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_plugins_org_id_plugin_id_pk" PRIMARY KEY("org_id","plugin_id")
);
--> statement-breakpoint
CREATE TABLE "plugin_votes" (
	"org_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_votes_org_id_plugin_id_user_id_pk" PRIMARY KEY("org_id","plugin_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "org_plugins" ADD CONSTRAINT "org_plugins_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_plugins" ADD CONSTRAINT "org_plugins_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_votes" ADD CONSTRAINT "plugin_votes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_votes" ADD CONSTRAINT "plugin_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_votes_plugin_idx" ON "plugin_votes" USING btree ("plugin_id");