-- Expand only (AGENTS.md §7.6): a nullable column and a check nothing existing can fail.
-- BR-REQ-011-01 criterion 9: last year's film on the event page, as a YouTube link.
ALTER TABLE "events" ADD COLUMN "video_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_video_url_is_https" CHECK ("events"."video_url" IS NULL OR "events"."video_url" LIKE 'https://%');