ALTER TABLE "registrations" ADD COLUMN "answers_written_at" timestamp with time zone;--> statement-breakpoint
-- The backfill: every row written before the column is judged as before, on the day it was created. A restart the row went through is not recoverable from the row; the readers fall back to `created_at` for a row the previous release writes during the deploy.
UPDATE "registrations" SET "answers_written_at" = "created_at" WHERE "answers_written_at" IS NULL;
