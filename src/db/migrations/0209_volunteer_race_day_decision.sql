-- «Decizie pentru ziua cursei»: one nullable `race_day_decision` on event_volunteers — what the organizers decided for the person on
-- race day, one short line — and the CHECK that holds it to 1–300 characters, the length of a person's message. Expand only: the
-- column and its constraint. Nothing is backfilled; every row from before has no decision until an organizer writes one.
ALTER TABLE "event_volunteers" ADD COLUMN "race_day_decision" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_race_day_decision_length" CHECK ("event_volunteers"."race_day_decision" IS NULL OR char_length("event_volunteers"."race_day_decision") BETWEEN 1 AND 300);