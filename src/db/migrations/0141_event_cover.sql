ALTER TABLE "events" ADD COLUMN "cover_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cover_crop" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_crop_needs_picture" CHECK ("events"."cover_crop" IS NULL OR "events"."cover_media_asset_id" IS NOT NULL);