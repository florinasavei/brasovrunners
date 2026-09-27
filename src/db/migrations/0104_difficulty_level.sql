-- expand: the difficulty as one level on the club's scale of fifteen (§526) — five bands of three steps: ușor, mediu, greuț, greu, foarte greu (1–3, 4–6, 7–9, 10–12, 13–15). A new nullable column, its range, and a backfill; the old `difficulty` column stays, unread by the new code and written beside the level with a best-effort value, so the release serving while this runs reads and writes what it did.
ALTER TABLE "events" ADD COLUMN "difficulty_level" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_difficulty_level_in_scale" CHECK ("events"."difficulty_level" IS NULL OR "events"."difficulty_level" BETWEEN 1 AND 15);--> statement-breakpoint
-- The old five words onto the owner's scale: «foarte ușor» is «ușor 1», «ușor» is «ușor 2», «mediu»
-- is «mediu 2», «greu» is «greu 2», «foarte greu» is «foarte greu 2». Compared as text: a database
-- built from nothing applies 0078's ADD VALUE in this same transaction, and PostgreSQL refuses an
-- enum literal of a value not yet committed (55P04). Idempotent: a row that has a level keeps it.
UPDATE "events" SET "difficulty_level" = CASE "difficulty"::text
  WHEN 'VERY_EASY' THEN 1
  WHEN 'EASY' THEN 2
  WHEN 'MODERATE' THEN 5
  WHEN 'HARD' THEN 11
  WHEN 'VERY_HARD' THEN 14
END WHERE "difficulty" IS NOT NULL AND "difficulty_level" IS NULL;
