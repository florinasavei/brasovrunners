-- «Lucruri de adus» on «Ziua cursei»: one event's checklist of the things the organizers bring to the race — a label, an
-- optional note, whether it was brought and by whom and when, and its place in the list. A new table only: nothing existing
-- changes and nothing is backfilled. The rows go with their event (ON DELETE CASCADE); a staff account removed leaves the
-- tick naming nobody (ON DELETE SET NULL).
CREATE TABLE "event_race_day_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"note" text,
	"brought" boolean DEFAULT false NOT NULL,
	"brought_at" timestamp with time zone,
	"brought_by_staff_user_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_race_day_items_label_length" CHECK (char_length("event_race_day_items"."label") BETWEEN 1 AND 120),
	CONSTRAINT "event_race_day_items_note_length" CHECK ("event_race_day_items"."note" IS NULL OR char_length("event_race_day_items"."note") <= 200),
	CONSTRAINT "event_race_day_items_position_positive" CHECK ("event_race_day_items"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_race_day_items" ADD CONSTRAINT "event_race_day_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_race_day_items" ADD CONSTRAINT "event_race_day_items_brought_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("brought_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_race_day_items_event_position_idx" ON "event_race_day_items" USING btree ("event_id","position");
