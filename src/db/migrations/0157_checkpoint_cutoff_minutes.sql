ALTER TABLE "event_checkpoints" ADD COLUMN "cutoff_minutes" integer;--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_cutoff_minutes_range" CHECK ("event_checkpoints"."cutoff_minutes" IS NULL OR "event_checkpoints"."cutoff_minutes" BETWEEN 1 AND 10080);--> statement-breakpoint
-- The cut-off as a time limit from the start (§NNN): a time of day typed under §757 becomes the minutes after the
-- event's start, the gun on a race that has one, else the event's start, both on the event's own clock — the
-- converter `domain/start.ts#minutesFromClock` in SQL. A cut-off earlier than the start's time of day is the
-- next day's only when the event runs past midnight (its end, counted from the start, says so); otherwise it
-- is before the start and left empty, as is every cut-off of an event whose start has no date or hour. The old
-- `cutoff_time` is kept, unread, until a later contract release. Safe to run twice: it fills only an empty value.
UPDATE "event_checkpoints" AS c
SET "cutoff_minutes" = r."minutes"
FROM (
  SELECT t."id",
    CASE
      WHEN t."crosses" THEN (((t."cut" - t."start_min") % 1440) + 1440) % 1440
      ELSE t."cut" - t."start_min"
    END AS "minutes"
  FROM (
    SELECT cp."id",
      (EXTRACT(HOUR FROM cp."cutoff_time")::int * 60 + EXTRACT(MINUTE FROM cp."cutoff_time")::int) AS "cut",
      (EXTRACT(HOUR FROM (g."gun" AT TIME ZONE ev."timezone"))::int * 60 + EXTRACT(MINUTE FROM (g."gun" AT TIME ZONE ev."timezone"))::int) AS "start_min",
      (
        ev."ends_at" IS NOT NULL
        AND (EXTRACT(HOUR FROM (g."gun" AT TIME ZONE ev."timezone"))::int * 60 + EXTRACT(MINUTE FROM (g."gun" AT TIME ZONE ev."timezone"))::int)
          + ROUND(EXTRACT(EPOCH FROM (ev."ends_at" - g."gun")) / 60) >= 1440
      ) AS "crosses"
    FROM "event_checkpoints" cp
    JOIN "events" ev ON ev."id" = cp."event_id"
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN ev."race_starts_at" IS NOT NULL THEN ev."race_starts_at"
        WHEN (ev."starts_at" AT TIME ZONE ev."timezone")::date <> DATE '9999-01-01'
          AND EXTRACT(SECOND FROM (ev."starts_at" AT TIME ZONE 'UTC')) <> 1 THEN ev."starts_at"
      END AS "gun"
    ) g
    WHERE cp."cutoff_time" IS NOT NULL AND cp."cutoff_minutes" IS NULL AND g."gun" IS NOT NULL
  ) t
) r
WHERE c."id" = r."id" AND r."minutes" BETWEEN 1 AND 10080;
