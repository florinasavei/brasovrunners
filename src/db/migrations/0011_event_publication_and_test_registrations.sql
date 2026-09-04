CREATE TYPE "public"."registration_kind" AS ENUM('REAL', 'TEST');--> statement-breakpoint
DROP INDEX "event_translations_status_idx";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "editorial_status" "editorial_status" DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "kind" "registration_kind" DEFAULT 'REAL' NOT NULL;--> statement-breakpoint
CREATE INDEX "events_editorial_status_starts_at_idx" ON "events" USING btree ("editorial_status","starts_at");--> statement-breakpoint
CREATE INDEX "registrations_event_kind_idx" ON "registrations" USING btree ("event_id","kind");--> statement-breakpoint
/*
  Carry the per-locale publication state up to the event, before the columns holding it go.

  DECISIONS.md §28 settles what happens to a row published in one locale only, and the answer
  is deliberately the conservative one: the event becomes a DRAFT. A Romanian page that stayed
  public while its English half was a stub is exactly the state BR-REQ-040-02 exists to prevent,
  and it is now the state that cannot be reached — so a row already in it is unpublished here,
  and an organizer completes the other language and publishes again. Nothing is lost:
  `published_at` is carried across regardless of the resulting status, because it is what slug
  stability keys on and it is never cleared.

  PUBLISHED requires all four things the transition will require from now on: a translation row
  in each locale, every one of them PUBLISHED, and a first-publication date to record.
*/
UPDATE "events" SET
  "published_at" = "carried"."first_published_at",
  "editorial_status" = "carried"."event_editorial_status"
FROM (
  SELECT
    "t"."event_id",
    min("t"."published_at") AS "first_published_at",
    CASE
      WHEN count(*) FILTER (WHERE "t"."locale" = 'ro') = 1
       AND count(*) FILTER (WHERE "t"."locale" = 'en') = 1
       AND count(*) FILTER (WHERE "t"."editorial_status" <> 'PUBLISHED') = 0
       AND count(*) FILTER (WHERE "t"."published_at" IS NULL) = 0
        THEN 'PUBLISHED'
      WHEN count(*) FILTER (WHERE "t"."editorial_status" <> 'ARCHIVED') = 0
        THEN 'ARCHIVED'
      ELSE 'DRAFT'
    END::"public"."editorial_status" AS "event_editorial_status"
  FROM "event_translations" AS "t"
  GROUP BY "t"."event_id"
) AS "carried"
WHERE "events"."id" = "carried"."event_id";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "editorial_status";--> statement-breakpoint
ALTER TABLE "event_translations" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_required_fields_present" CHECK (length(btrim("event_translations"."title")) > 0
          AND length(btrim("event_translations"."slug")) > 0
          AND length(btrim("event_translations"."location_name")) > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" IS NULL OR "events"."capacity" > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_version_positive" CHECK ("events"."version" >= 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_published_has_a_publication_date" CHECK ("events"."editorial_status" <> 'PUBLISHED' OR "events"."published_at" IS NOT NULL);
