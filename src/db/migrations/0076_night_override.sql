-- "Eveniment de noapte" (DECISIONS.md, the night event): events.headlamp_required becomes the
-- organizer's override of a computed answer. NULL is "Automat" (the start and the end against civil dusk and
-- dawn at the club's place), true is "Da", false is "Nu". Expand only (AGENTS.md §7.6): the column is loosened,
-- never dropped or renamed, and a row §382's checkbox left unticked (false) had said nothing, so it
-- becomes automatic; a ticked one (true) keeps the club's word.
ALTER TABLE "events" ALTER COLUMN "headlamp_required" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "headlamp_required" DROP NOT NULL;--> statement-breakpoint
UPDATE "events" SET "headlamp_required" = NULL WHERE "headlamp_required" = false;
