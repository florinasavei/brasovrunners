ALTER TABLE "registrations" ADD COLUMN "answers_written_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The backfill: every row written before the column is judged as before, on the day it was created. A restart the row went through is not recoverable from the row. The default is evaluated at each insert, so a row the previous release writes during the deploy carries its own insert instant.
UPDATE "registrations" SET "answers_written_at" = "created_at";
