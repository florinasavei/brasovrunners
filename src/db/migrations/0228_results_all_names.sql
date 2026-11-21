-- «Toate numele în clasament»: the Administrator's switch that names every confirmed runner in a race's published results, over
-- each runner's own tick. Expand only: one boolean, false for every event that exists and every one created after, so nothing
-- published changes until an Administrator ticks it on «Clasament».
ALTER TABLE "events" ADD COLUMN "results_all_names" boolean DEFAULT false NOT NULL;
