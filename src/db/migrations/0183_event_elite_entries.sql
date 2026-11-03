CREATE TABLE "event_elite_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bib_number" integer,
	"created_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_elite_entries_name_length" CHECK (char_length("event_elite_entries"."name") BETWEEN 1 AND 80),
	CONSTRAINT "event_elite_entries_bib_number" CHECK ("event_elite_entries"."bib_number" IS NULL OR "event_elite_entries"."bib_number" BETWEEN 1 AND 99999)
);
--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD CONSTRAINT "event_elite_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD CONSTRAINT "event_elite_entries_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_elite_entries_event_idx" ON "event_elite_entries" USING btree ("event_id");