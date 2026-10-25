ALTER TABLE "events" ADD COLUMN "award_places" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "award_categories" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_award_places_range" CHECK ("events"."award_places" >= 1 AND "events"."award_places" <= 10);