-- expand: drops team_members_links_is_a_short_array_of_https_links, the six-link CHECK of §474, so that migration 0094 can add it again at twelve (§491). Dropping a CHECK only loosens: the code serving while this runs caps a card at six links and writes nothing the database would now refuse, and no release before or after needs the six-link version.
--
-- The film's old columns, events.video_url and events.video_poster_url, and their CHECK are NOT
-- dropped here. BR-V2.10 removes them from the Drizzle schema only; BR-V2.09, which may still be
-- serving while this runs, declares them, so every bare select, returning and insert of `events`
-- it makes names them. Their drop is BR-V2.11's own contract migration (AGENTS.md §7.6, §491).
ALTER TABLE "team_members" DROP CONSTRAINT "team_members_links_is_a_short_array_of_https_links";
