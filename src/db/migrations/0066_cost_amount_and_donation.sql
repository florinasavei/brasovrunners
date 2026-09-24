ALTER TYPE "public"."event_cost_type" ADD VALUE 'DONATION';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cost_amount" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cost_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cost_url_is_https" CHECK ("events"."cost_url" IS NULL OR "events"."cost_url" LIKE 'https://%');