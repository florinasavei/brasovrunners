ALTER TYPE "public"."email_message_type" ADD VALUE 'UNSIGNED_RELEASED';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "places_kept_for_club" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "release_unsigned_at_deadline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "unsigned_released_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_places_kept_non_negative" CHECK ("events"."places_kept_for_club" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_places_kept_within_capacity" CHECK ("events"."capacity" IS NULL OR "events"."places_kept_for_club" <= "events"."capacity");