-- contract: BR-V2.08 stopped reading and writing events.video_url and events.video_poster_url (§481, §485) — migration 0092 had moved every stored film into its description as a youtube node, and since that release no page, save, preview, calendar entry, older-pictures press or orphan sweep touches either column. This drops them, and their CHECK with them, in the release after (AGENTS.md §7.6, the §390 pattern).
--
-- It also drops team_members_links_is_a_short_array_of_https_links, the six-link CHECK of §474, so
-- that migration 0094 can add it again at twelve (§NNN). Dropping a CHECK only loosens: the code
-- serving while this runs (a cap of six) writes nothing the database would now refuse. The two
-- files are applied by one migrator run in one transaction, so no row is ever written between
-- them without the check.
ALTER TABLE "events" DROP CONSTRAINT "events_video_url_is_https";--> statement-breakpoint
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_links_is_a_short_array_of_https_links";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "video_url";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "video_poster_url";
