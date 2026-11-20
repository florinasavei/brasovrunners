-- «V001, V002, …»: every volunteer's number, a series of its own per event (amending the volunteers' old series of 0203). One
-- nullable integer on event_volunteers, `volunteer_number`, unique per event and positive — written «V» and three digits at
-- least by the code. Expand only: the column, its partial unique index and its CHECK, and a backfill of the new column alone.
-- The backfill numbers, event by event, every volunteer confirmed now, in the order they were first confirmed (the trail's
-- `volunteer.state_changed` row that made them CONFIRMED), then the order they were added, then the id — a row with no such
-- trail row comes after those that have one. Nobody waiting or cancelled is numbered: they draw at their confirmation. The old
-- series (`event_volunteers.bib_number`, `events.volunteer_bib_start`) is left as it is.
ALTER TABLE "event_volunteers" ADD COLUMN "volunteer_number" integer;--> statement-breakpoint
WITH "confirmed" AS (
	SELECT "ev"."id", "ev"."event_id", "ev"."created_at", (
		SELECT min("a"."created_at") FROM "audit_logs" AS "a"
		WHERE "a"."entity_type" = 'event' AND "a"."entity_id" = "ev"."event_id" AND "a"."action" = 'volunteer.state_changed'
			AND "a"."metadata_json" ->> 'volunteerId' = "ev"."id"::text AND "a"."metadata_json" ->> 'to' = 'CONFIRMED'
	) AS "confirmed_at"
	FROM "event_volunteers" AS "ev"
	WHERE "ev"."state" = 'CONFIRMED' AND "ev"."volunteer_number" IS NULL
), "numbered" AS (
	SELECT "id", row_number() OVER (PARTITION BY "event_id" ORDER BY "confirmed_at" ASC NULLS LAST, "created_at" ASC, "id" ASC) AS "number"
	FROM "confirmed"
)
UPDATE "event_volunteers" SET "volunteer_number" = "numbered"."number" FROM "numbered" WHERE "numbered"."id" = "event_volunteers"."id";--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteers_event_volunteer_number_unique" ON "event_volunteers" USING btree ("event_id","volunteer_number") WHERE "event_volunteers"."volunteer_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_volunteer_number_positive" CHECK ("event_volunteers"."volunteer_number" IS NULL OR "event_volunteers"."volunteer_number" > 0);
