CREATE TYPE "public"."event_checkpoint_kind" AS ENUM('WATER', 'FOOD', 'FIRST_AID', 'TIMING');--> statement-breakpoint
CREATE TABLE "event_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"km" numeric(6, 2) NOT NULL,
	"kinds" "event_checkpoint_kind"[] DEFAULT '{}' NOT NULL,
	"cutoff_time" time,
	"note_ro" text,
	"note_en" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_checkpoints_km_not_negative" CHECK ("event_checkpoints"."km" >= 0),
	CONSTRAINT "event_checkpoints_name_length" CHECK (char_length("event_checkpoints"."name_ro") BETWEEN 1 AND 60 AND char_length("event_checkpoints"."name_en") BETWEEN 1 AND 60),
	CONSTRAINT "event_checkpoints_note_both_languages" CHECK (("event_checkpoints"."note_ro" IS NULL) = ("event_checkpoints"."note_en" IS NULL) AND ("event_checkpoints"."note_ro" IS NULL OR (char_length("event_checkpoints"."note_ro") BETWEEN 1 AND 120 AND char_length("event_checkpoints"."note_en") BETWEEN 1 AND 120)))
);
--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_checkpoints_event_idx" ON "event_checkpoints" USING btree ("event_id");