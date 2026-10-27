CREATE TABLE "learn_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learn_lectures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"youtube_id" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learn_lectures_youtube_id_check" CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$')
);
--> statement-breakpoint
ALTER TABLE "learn_lectures" ADD CONSTRAINT "learn_lectures_course_id_learn_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."learn_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learn_courses_slug_key" ON "learn_courses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "learn_courses_position_idx" ON "learn_courses" USING btree ("position");--> statement-breakpoint
CREATE UNIQUE INDEX "learn_lectures_course_slug_key" ON "learn_lectures" USING btree ("course_id","slug");--> statement-breakpoint
CREATE INDEX "learn_lectures_course_position_idx" ON "learn_lectures" USING btree ("course_id","position");