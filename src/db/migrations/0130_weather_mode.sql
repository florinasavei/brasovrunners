ALTER TABLE "event_translations" ADD COLUMN "weather_note" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "weather_mode" text DEFAULT 'forecast' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_weather_mode_known" CHECK ("events"."weather_mode" IN ('forecast', 'custom', 'off'));