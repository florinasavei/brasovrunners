-- «Prezent»: one boolean on event_volunteers — the organizers' mark that the person came on the day, which «Lista pentru
-- tombolă — doar prezenții» reads. Expand only: one column, not null with its default false, so every volunteer from before
-- reads not present and a row written without the column too. Nothing is backfilled.
ALTER TABLE "event_volunteers" ADD COLUMN "present" boolean DEFAULT false NOT NULL;