CREATE TABLE "event_reserve_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"note" text,
	"created_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_reserve_entries_name_length" CHECK (char_length("event_reserve_entries"."first_name") BETWEEN 1 AND 100 AND char_length("event_reserve_entries"."last_name") BETWEEN 1 AND 100),
	CONSTRAINT "event_reserve_entries_email_length" CHECK ("event_reserve_entries"."email" IS NULL OR char_length("event_reserve_entries"."email") BETWEEN 3 AND 254),
	CONSTRAINT "event_reserve_entries_note_length" CHECK ("event_reserve_entries"."note" IS NULL OR char_length("event_reserve_entries"."note") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "event_reserve_entries" ADD CONSTRAINT "event_reserve_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_reserve_entries" ADD CONSTRAINT "event_reserve_entries_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_reserve_entries_event_idx" ON "event_reserve_entries" USING btree ("event_id","created_at");