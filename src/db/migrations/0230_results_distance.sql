-- «Distanța parcursă» on one result (§1034): the metres a runner covered when it differs from the race's. Expand only: one nullable
-- column, null on every row that exists — the race's own distance — so nothing published changes until an Administrator sets one.
ALTER TABLE "event_results" ADD COLUMN "distance_meters" integer;
