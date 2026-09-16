CREATE TYPE "public"."event_cost_type" AS ENUM('FREE', 'PAID');--> statement-breakpoint
CREATE TYPE "public"."event_difficulty" AS ENUM('EASY', 'MODERATE', 'HARD');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "difficulty" "event_difficulty";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cost_type" "event_cost_type";--> statement-breakpoint

-- Backfill from the free text these two columns replace, in the same migration that adds
-- them: a deployment must never serve a window where an event page has lost its difficulty
-- and cost because the new columns are empty and the old ones are already ignored.
--
-- Matching is case-insensitive and accepts both languages, because the text was typed by hand
-- in whichever one the organizer was thinking in. Anything unrecognised stays NULL, which the
-- page renders as "not stated" — the honest answer for a word this migration cannot classify,
-- and better than guessing EASY for a difficulty somebody spelled unusually.
UPDATE "events" SET "difficulty" = CASE
  WHEN lower(trim("difficulty_label")) IN ('ușor', 'usor', 'easy') THEN 'EASY'
  WHEN lower(trim("difficulty_label")) IN ('mediu', 'moderate', 'medium') THEN 'MODERATE'
  WHEN lower(trim("difficulty_label")) IN ('avansat', 'greu', 'dificil', 'hard', 'advanced', 'difficult') THEN 'HARD'
END::"public"."event_difficulty"
WHERE "difficulty_label" IS NOT NULL;--> statement-breakpoint

-- Cost keeps the *fact* and loses the amount, which is the accepted trade: "50 lei" becomes
-- PAID, and the number it named is gone until the amount column exists. Nothing in this
-- database charges money today — every row reads "Gratuit" — so this drops no figure anyone
-- has published. An event that charges is entered again with an amount once there is a column
-- to hold one.
UPDATE "events" SET "cost_type" = CASE
  WHEN lower(trim("cost_text")) IN ('gratuit', 'gratuită', 'gratuita', 'free', 'free entry', 'no charge', '0') THEN 'FREE'
  ELSE 'PAID'
END::"public"."event_cost_type"
WHERE "cost_text" IS NOT NULL;
