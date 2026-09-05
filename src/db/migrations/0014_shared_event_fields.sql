/*
  The four facts that are the same event in either language move to the event row
  (BR-REQ-010-01, DECISIONS.md §36).

  The meeting point, the street address, the difficulty and the cost lived on
  `event_translations` and were entered twice. The second copy was not a translation: the street
  address is identical word for word, and the other three are one decision the club made once.

  Additive only, per AGENTS.md §7.6. The four columns arrive nullable — old code inserting an
  event without them keeps working during the overlap — and the values are carried up from the
  Romanian translation, or from whichever translation exists if there is no Romanian row. The
  matching columns on `event_translations` are NOT dropped here: a drop ships in the release
  after the code that stopped needing it, so a rollback finds a schema its code can still run
  against. Until then they are still written, as a copy, because this table's NOT NULL and its
  `event_translations_required_fields_present` CHECK still name `location_name`.
*/
ALTER TABLE "events" ADD COLUMN "location_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "location_address" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "difficulty_label" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cost_text" text;--> statement-breakpoint

UPDATE "events" AS e
SET "location_name" = t."location_name",
    "location_address" = t."location_address",
    "difficulty_label" = t."difficulty_label",
    "cost_text" = t."cost_text"
FROM "event_translations" AS t
WHERE t."event_id" = e."id" AND t."locale" = 'ro';--> statement-breakpoint

/*
  An event with no Romanian row should not exist — both locales are required to create one — but
  a backfill that silently skipped a row would leave an event with no meeting point, which is a
  page missing the one fact a runner needs. `DISTINCT ON` picks exactly one translation per
  event rather than letting a join multiply the rows.
*/
UPDATE "events" AS e
SET "location_name" = t."location_name",
    "location_address" = t."location_address",
    "difficulty_label" = t."difficulty_label",
    "cost_text" = t."cost_text"
FROM (
  SELECT DISTINCT ON ("event_id") "event_id", "location_name", "location_address",
         "difficulty_label", "cost_text"
  FROM "event_translations"
  ORDER BY "event_id", "locale"
) AS t
WHERE t."event_id" = e."id" AND e."location_name" IS NULL;
