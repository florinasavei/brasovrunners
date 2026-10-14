ALTER TABLE "event_volunteer_roles" ADD COLUMN "description_ro_json" jsonb;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD COLUMN "description_en_json" jsonb;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD COLUMN "description_words_ro" text;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD COLUMN "description_words_en" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "age" smallint;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "sex" "registration_sex";--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "volunteered_before" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "club_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "shirt_size" "registration_tshirt_size";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteers_shirts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD CONSTRAINT "event_volunteer_roles_description_words" CHECK (("event_volunteer_roles"."description_ro_json" IS NULL) = ("event_volunteer_roles"."description_words_ro" IS NULL) AND ("event_volunteer_roles"."description_en_json" IS NULL) = ("event_volunteer_roles"."description_words_en" IS NULL) AND ("event_volunteer_roles"."description_words_ro" IS NULL OR char_length("event_volunteer_roles"."description_words_ro") BETWEEN 1 AND 2000) AND ("event_volunteer_roles"."description_words_en" IS NULL OR char_length("event_volunteer_roles"."description_words_en") BETWEEN 1 AND 2000));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_age_range" CHECK ("event_volunteers"."age" IS NULL OR "event_volunteers"."age" BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_city_length" CHECK ("event_volunteers"."city" IS NULL OR char_length("event_volunteers"."city") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_shirt_is_a_size" CHECK ("event_volunteers"."shirt_size" IS NULL OR "event_volunteers"."shirt_size" <> 'NONE');--> statement-breakpoint
-- The role's one-line description becomes a one-paragraph document with its plain words (§NNN, amending §754): the
-- rich-text editor's own shape (`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":…}]}]}`),
-- per language, only for a value that has words. The old columns stay, untouched, until a later contract release;
-- nothing reads them after this one. Expand only: no column is dropped and no value is removed.
UPDATE "event_volunteer_roles"
SET "description_ro_json" = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim("description_ro")))))),
    "description_words_ro" = btrim("description_ro")
WHERE "description_ro" IS NOT NULL AND btrim("description_ro") <> '';--> statement-breakpoint
UPDATE "event_volunteer_roles"
SET "description_en_json" = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', btrim("description_en")))))),
    "description_words_en" = btrim("description_en")
WHERE "description_en" IS NOT NULL AND btrim("description_en") <> '';