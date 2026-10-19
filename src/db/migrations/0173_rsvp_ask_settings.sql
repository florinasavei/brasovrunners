CREATE TABLE "rsvp_ask_refusals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"series_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvp_ask_refusals_email_series_unique" UNIQUE("canonical_email","series_key")
);
--> statement-breakpoint
CREATE TABLE "rsvp_refuse_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"series_key" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rsvp_refuse_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "rsvp_refuse_tokens_hash_is_sha256_hex" CHECK ("rsvp_refuse_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "rsvp_refuse_tokens_expiry_after_creation" CHECK ("rsvp_refuse_tokens"."expires_at" > "rsvp_refuse_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "asked_basis" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp_ask_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "rsvp_refuse_tokens" ADD CONSTRAINT "rsvp_refuse_tokens_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rsvp_refuse_tokens_canonical_email_idx" ON "rsvp_refuse_tokens" USING btree ("canonical_email");--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_asked_basis_known" CHECK ("event_rsvps"."asked_basis" IS NULL OR "event_rsvps"."asked_basis" IN ('SUBSCRIBER', 'ANSWERER'));