-- «Activitatea ta pe Strava» (§NNN): the runner's own link to their race on Strava, written from their own registration page and printed
-- beside their name in the published results. Expand only: one nullable column, null on every row that exists, so nothing published
-- changes until a runner writes one.
ALTER TABLE "registrations" ADD COLUMN "strava_activity_url" text;
