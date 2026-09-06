ALTER TABLE "events" DROP COLUMN "difficulty_label";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "cost_text";
-- Separate from 0018 on purpose: that migration adds the enum columns and fills them from
-- these two, and this one removes the source only once that has run. A single migration doing
-- both would still be correct here, but the split is what makes the backfill re-runnable and
-- reviewable on its own — and it is the same add-then-drop shape drizzle-kit needs anyway,
-- since a rename it has to guess at is a prompt no CI can answer.
