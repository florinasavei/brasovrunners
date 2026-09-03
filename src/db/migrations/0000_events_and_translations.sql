CREATE TYPE "public"."editorial_status" AS ENUM('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('COMMUNITY_RUN', 'TRAIL_RUN', 'INTERVAL_SESSION', 'LONG_RUN', 'MEETUP', 'RACE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('SCHEDULED', 'CANCELLED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ro', 'en');--> statement-breakpoint
CREATE TYPE "public"."registration_mode" AS ENUM('NONE', 'INTERNAL', 'EXTERNAL');--> statement-breakpoint
CREATE TABLE "event_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"body_json" jsonb,
	"location_name" text NOT NULL,
	"location_address" text,
	"difficulty_label" text,
	"cover_alt_text" text,
	"seo_title" text,
	"seo_description" text,
	"editorial_status" "editorial_status" DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_translations_event_locale_unique" UNIQUE("event_id","locale"),
	CONSTRAINT "event_translations_locale_slug_unique" UNIQUE("locale","slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_id" uuid,
	"kind" "event_kind" NOT NULL,
	"event_status" "event_status" DEFAULT 'SCHEDULED' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text DEFAULT 'Europe/Bucharest' NOT NULL,
	"latitude" numeric,
	"longitude" numeric,
	"distance_meters" integer,
	"elevation_gain_meters" integer,
	"capacity" integer,
	"registration_mode" "registration_mode" DEFAULT 'NONE' NOT NULL,
	"registration_opens_at" timestamp with time zone,
	"registration_closes_at" timestamp with time zone,
	"declaration_document_id" uuid,
	"external_provider" text,
	"external_registration_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_capacity_must_be_null_during_pilot" CHECK ("events"."capacity" IS NULL),
	CONSTRAINT "events_capacity_and_declaration_are_internal_only" CHECK (("events"."registration_mode" = 'INTERNAL') OR ("events"."capacity" IS NULL AND "events"."declaration_document_id" IS NULL)),
	CONSTRAINT "events_external_fields_external_only" CHECK (("events"."registration_mode" = 'EXTERNAL' AND "events"."external_registration_url" LIKE 'https://%')
          OR ("events"."registration_mode" <> 'EXTERNAL' AND "events"."external_registration_url" IS NULL AND "events"."external_provider" IS NULL)),
	CONSTRAINT "events_end_after_start" CHECK ("events"."ends_at" IS NULL OR "events"."ends_at" > "events"."starts_at"),
	CONSTRAINT "events_non_negative_measurements" CHECK (("events"."distance_meters" IS NULL OR "events"."distance_meters" >= 0)
          AND ("events"."elevation_gain_meters" IS NULL OR "events"."elevation_gain_meters" >= 0)),
	CONSTRAINT "events_registration_window_ordered" CHECK ("events"."registration_opens_at" IS NULL OR "events"."registration_closes_at" IS NULL
          OR "events"."registration_closes_at" >= "events"."registration_opens_at"),
	CONSTRAINT "events_race_id_implies_race_kind" CHECK ("events"."race_id" IS NULL OR "events"."kind" = 'RACE')
);
--> statement-breakpoint
ALTER TABLE "event_translations" ADD CONSTRAINT "event_translations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_translations_status_idx" ON "event_translations" USING btree ("locale","editorial_status");--> statement-breakpoint
CREATE INDEX "events_status_starts_at_idx" ON "events" USING btree ("event_status","starts_at");--> statement-breakpoint
CREATE INDEX "events_kind_starts_at_idx" ON "events" USING btree ("kind","starts_at");--> statement-breakpoint
CREATE INDEX "events_registration_mode_starts_at_idx" ON "events" USING btree ("registration_mode","starts_at");