/*
  The four columns that were never a translation (DECISIONS.md §36, AGENTS.md §11.7, §7.6).

      location_name       the meeting point
      location_address    the street address
      difficulty_label    the difficulty
      cost_text           the cost

  All four are one fact about the event in both languages, not a fact stated twice, so they live
  on `events`. The code stopped reading them in BR-V1.19 and this drop ships one release later,
  which is what §7.6 requires: for one release the schema had to satisfy both the new code and
  the old, so that a rollback found a database its own code could still run against.

  `location_name` was also the third clause of `event_translations_required_fields_present`, so
  the constraint is dropped and rebuilt with the two clauses that remain — title and slug, the
  fields a public page renders from this row. The meeting point is still required; it is checked
  on `events`, where it now is.

  Recorded because the numbering surprises: DECISIONS.md §36 and docs/PLATFORM.md called this
  "migration 0015" when the debt was written down. 0015 and 0016 were taken by work that shipped
  in between, so it is 0017. The documents have been corrected rather than left to mislead.

  Irreversible, and deliberately so. Rolling this back restores empty columns, not the values:
  the data these held is on `events` and has been the only copy read since BR-V1.19.
*/
ALTER TABLE "event_translations" DROP CONSTRAINT "event_translations_required_fields_present";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "location_name";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "location_address";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "difficulty_label";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "cost_text";--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_required_fields_present" CHECK (length(btrim("event_translations"."title")) > 0
          AND length(btrim("event_translations"."slug")) > 0);