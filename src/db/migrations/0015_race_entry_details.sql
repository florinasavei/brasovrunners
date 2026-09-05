-- Race entry details (BR-REQ-031-04, BR-REQ-031-05, BR-REQ-039-02).
--
-- Additive only, so it may ship in the same release as the code that uses it (AGENTS.md §7.6).
-- The contract half — dropping `registrations.registered_name` once nothing composes from it —
-- belongs to a later release and is not attempted here.
--
-- `display_name` is the one column that cannot be null, because a start list with a blank row
-- publishes nothing useful and a start list that falls back to the legal name publishes exactly
-- what §10.10 forbids. A NOT NULL cannot simply be added to a table that already has rows, so
-- it arrives in three steps: add it nullable, derive it for every existing row the same way the
-- application derives it (`resolveDisplayName`), then tighten.

CREATE TYPE "public"."registration_sex" AS ENUM('FEMALE', 'MALE', 'UNSPECIFIED');--> statement-breakpoint
CREATE TYPE "public"."registration_tshirt_size" AS ENUM('NONE', 'XS', 'S', 'M', 'L', 'XL', 'XXL');--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "display_name" text;--> statement-breakpoint

-- The display name defaults to the legal name, exactly as `resolveDisplayName` does: a start
-- list says what people gave, and the field exists for whoever would rather it did not.
-- `COALESCE(NULLIF(...))` guards a registered name that is blank or whitespace, which the
-- CHECK at the foot of this file would otherwise refuse.
UPDATE "registrations"
SET "display_name" = COALESCE(NULLIF(btrim("registered_name"), ''), '-')
WHERE "display_name" IS NULL;--> statement-breakpoint

ALTER TABLE "registrations" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "sex" "registration_sex";--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "nationality" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "club_name" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "tshirt_size" "registration_tshirt_size";--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "health_notes" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "health_consent_version" integer;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "health_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_display_name_present" CHECK (length(btrim("registrations"."display_name")) > 0);--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_health_consent_present" CHECK ("registrations"."health_notes" IS NULL OR ("registrations"."health_consent_at" IS NOT NULL AND "registrations"."health_consent_version" IS NOT NULL));
