-- One migration for a split that cannot be half-applied (`DECISIONS.md` §61).
--
-- `event_kind` mixed two questions — "trail run" said where you run, "interval session" said
-- how — so it becomes `type` (what the event is) and `surface` (what it is run on). The
-- coordinates go in the same step: a Google Maps link pasted in one move replaces two decimal
-- numbers typed by hand, and `map_url` already existed to hold it.
--
-- Add-then-convert-then-drop in a single file, against AGENTS.md §7.6's expand/contract
-- preference, by the owner's instruction: `type` is NOT NULL from the first release that reads
-- it, so no code can run against both shapes and a second release would buy nothing but a
-- window in which `kind` is written and `type` is not. Production has never served a
-- request, so its first migration run applies this before any code reads the table.
CREATE TYPE "public"."event_surface" AS ENUM('ASPHALT', 'TRAIL', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('GROUP_RUN', 'RACE', 'HIKE', 'COFFEE', 'MEETUP');--> statement-breakpoint
-- Nullable first, filled below, then constrained: ADD COLUMN ... NOT NULL cannot succeed on a
-- table that already has rows, and every deployed database has.
ALTER TABLE "events" ADD COLUMN "type" "event_type";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "surface" "event_surface";--> statement-breakpoint

-- The conversion. Every old value maps to exactly one new type; only TRAIL_RUN carried a
-- surface, and it is the one that becomes a stated one. OTHER becomes MEETUP rather than a
-- guess at a run — the club's own reading of what "other" was used for.
UPDATE "events" SET "type" = CASE "kind"
  WHEN 'COMMUNITY_RUN' THEN 'GROUP_RUN'
  WHEN 'INTERVAL_SESSION' THEN 'GROUP_RUN'
  WHEN 'LONG_RUN' THEN 'GROUP_RUN'
  WHEN 'TRAIL_RUN' THEN 'GROUP_RUN'
  WHEN 'RACE' THEN 'RACE'
  WHEN 'MEETUP' THEN 'MEETUP'
  WHEN 'OTHER' THEN 'MEETUP'
END::"public"."event_type";--> statement-breakpoint
UPDATE "events" SET "surface" = 'TRAIL' WHERE "kind" = 'TRAIL_RUN';--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint

CREATE INDEX "events_type_starts_at_idx" ON "events" USING btree ("type","starts_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_race_id_implies_race_type" CHECK ("events"."race_id" IS NULL OR "events"."type" = 'RACE');--> statement-breakpoint

-- The old shape, gone in the same step. The constraint and the index named `kind`; the two
-- coordinate checks guarded columns nothing reads any more.
ALTER TABLE "events" DROP CONSTRAINT "events_race_id_implies_race_kind";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_coordinates_are_a_pair";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_coordinates_in_range";--> statement-breakpoint
DROP INDEX "events_kind_starts_at_idx";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "latitude";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "longitude";--> statement-breakpoint
DROP TYPE "public"."event_kind";
