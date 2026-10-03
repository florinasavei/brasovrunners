ALTER TABLE "events" ADD COLUMN "hidden_list_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hidden_list_bib_start" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "participant_count_public" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "hidden_list_counted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The backfill: every event that already has a registration on the hidden list (`outside_capacity`, §643) keeps the registration page's control, so nothing it showed disappears.
UPDATE "events" SET "hidden_list_enabled" = true WHERE EXISTS (SELECT 1 FROM "registrations" WHERE "registrations"."event_id" = "events"."id" AND "registrations"."outside_capacity" = true);
