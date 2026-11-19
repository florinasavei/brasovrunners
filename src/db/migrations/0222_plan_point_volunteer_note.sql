-- «Notă pentru voluntari», one per point of the volunteers' plan: two columns on event_checkpoints, the note in Romanian and in
-- English, both or neither, each 1 to 500 characters — what everybody standing at the point has to know. Read by the plan's page
-- and the volunteer's own «Punctul tău de voluntar» email; never public.
-- Adds columns and a CHECK constraint only. Nothing is backfilled: no point has a note until somebody writes one.
ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_ro" text;--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_en" text;--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_volunteer_note_both_languages" CHECK (("event_checkpoints"."volunteer_note_ro" IS NULL) = ("event_checkpoints"."volunteer_note_en" IS NULL) AND ("event_checkpoints"."volunteer_note_ro" IS NULL OR (char_length("event_checkpoints"."volunteer_note_ro") BETWEEN 1 AND 500 AND char_length("event_checkpoints"."volunteer_note_en") BETWEEN 1 AND 500)));