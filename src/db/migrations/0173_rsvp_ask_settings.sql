ALTER TYPE "public"."event_rsvp_token_purpose" ADD VALUE 'RSVP_REFUSE';--> statement-breakpoint
CREATE TABLE "rsvp_ask_refusals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"series_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvp_ask_refusals_email_series_unique" UNIQUE("canonical_email","series_key")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp_ask_enabled" boolean DEFAULT true NOT NULL;