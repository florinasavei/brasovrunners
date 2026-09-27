-- contract: events.video_url, events.video_poster_url and their CHECK events_video_url_is_https.
-- BR-V2.08 stopped reading and writing them once migration 0092 moved every film into its
-- description (§481); BR-V2.10 stopped declaring them in the Drizzle schema (§491), so no
-- release that can still be serving while this runs names them in a select, a returning or an
-- insert. The drop ships in the release after that one, never with it (AGENTS.md §7.6, §390).
ALTER TABLE "events" DROP CONSTRAINT "events_video_url_is_https";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "video_url";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "video_poster_url";
