ALTER TYPE "public"."email_message_type" ADD VALUE 'PLACES_ALERT';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "free_places_by_offer_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "places_alert_at" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "places_alert_sent" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "public_registration_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_places_alert_at_non_negative" CHECK ("events"."places_alert_at" IS NULL OR "events"."places_alert_at" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_places_alert_sent_known" CHECK ("events"."places_alert_sent" IS NULL OR "events"."places_alert_sent" IN ('LOW', 'FULL'));