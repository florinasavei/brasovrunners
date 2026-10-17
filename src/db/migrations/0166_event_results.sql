CREATE TYPE "public"."event_result_status" AS ENUM('FINISHED', 'DNF', 'DNS', 'DSQ');--> statement-breakpoint
CREATE TABLE "event_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid,
	"bib_number" integer NOT NULL,
	"display_name" text,
	"sex" "registration_sex",
	"birth_date" date,
	"status" "event_result_status" NOT NULL,
	"gun_time_ms" integer,
	"chip_time_ms" integer,
	"note" text,
	"position_overall" integer,
	"position_sex" integer,
	"position_category" integer,
	"category_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_user_id" uuid,
	CONSTRAINT "event_results_bib_positive" CHECK ("event_results"."bib_number" > 0),
	CONSTRAINT "event_results_time_matches_status" CHECK (("event_results"."status" = 'FINISHED') = ("event_results"."gun_time_ms" IS NOT NULL)),
	CONSTRAINT "event_results_times_positive" CHECK (("event_results"."gun_time_ms" IS NULL OR "event_results"."gun_time_ms" > 0) AND ("event_results"."chip_time_ms" IS NULL OR "event_results"."chip_time_ms" > 0)),
	CONSTRAINT "event_results_chip_only_finished" CHECK ("event_results"."chip_time_ms" IS NULL OR "event_results"."status" = 'FINISHED'),
	CONSTRAINT "event_results_note_length" CHECK ("event_results"."note" IS NULL OR char_length("event_results"."note") BETWEEN 1 AND 200),
	CONSTRAINT "event_results_name_length" CHECK ("event_results"."display_name" IS NULL OR char_length(btrim("event_results"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "event_results_positions_finished" CHECK ("event_results"."status" = 'FINISHED' OR ("event_results"."position_overall" IS NULL AND "event_results"."position_sex" IS NULL AND "event_results"."position_category" IS NULL)),
	CONSTRAINT "event_results_positions_positive" CHECK (("event_results"."position_overall" IS NULL OR "event_results"."position_overall" > 0) AND ("event_results"."position_sex" IS NULL OR "event_results"."position_sex" > 0) AND ("event_results"."position_category" IS NULL OR "event_results"."position_category" > 0))
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "results_published" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "results_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_results" ADD CONSTRAINT "event_results_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_results" ADD CONSTRAINT "event_results_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_results" ADD CONSTRAINT "event_results_updated_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("updated_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_results_event_bib_unique" ON "event_results" USING btree ("event_id","bib_number");--> statement-breakpoint
CREATE UNIQUE INDEX "event_results_event_registration_unique" ON "event_results" USING btree ("event_id","registration_id") WHERE "event_results"."registration_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "event_results_event_position_idx" ON "event_results" USING btree ("event_id","position_overall");