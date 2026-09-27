-- expand: the difficulty as one level on the club's scale of fifteen (§NNN) — five bands of three steps. A new nullable column, its range, and a backfill; the band column `difficulty` stays, written beside the level by the new code, so the release serving while this runs reads and writes exactly what it did.
ALTER TABLE "events" ADD COLUMN "difficulty_level" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_difficulty_level_in_scale" CHECK ("events"."difficulty_level" IS NULL OR "events"."difficulty_level" BETWEEN 1 AND 15);--> statement-breakpoint
-- Every stated band at its middle step: the one reading that rounds no event up or down. Compared as
-- text: a database built from nothing applies 0078's ADD VALUE in this same transaction, and
-- PostgreSQL refuses an enum literal of a value not yet committed (55P04).
UPDATE "events" SET "difficulty_level" = CASE "difficulty"::text
  WHEN 'VERY_EASY' THEN 2
  WHEN 'EASY' THEN 5
  WHEN 'MODERATE' THEN 8
  WHEN 'HARD' THEN 11
  WHEN 'VERY_HARD' THEN 14
END WHERE "difficulty" IS NOT NULL;
