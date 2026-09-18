-- Expand only (AGENTS.md §7.6): a nullable column and a check nothing existing can fail.
-- BR-REQ-011-01 criterion 10: the club's Strava group event for this occurrence.
ALTER TABLE "events" ADD COLUMN "strava_event_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_strava_event_url_is_https" CHECK ("events"."strava_event_url" IS NULL OR "events"."strava_event_url" LIKE 'https://%');