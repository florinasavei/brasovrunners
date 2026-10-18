CREATE TYPE "public"."event_rsvp_token_purpose" AS ENUM('RSVP_CONFIRM', 'RSVP_WITHDRAW');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'RSVP_CONFIRM';--> statement-breakpoint
CREATE TABLE "event_rsvp_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rsvp_id" uuid NOT NULL,
	"purpose" "event_rsvp_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvp_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "event_rsvp_tokens_hash_is_sha256_hex" CHECK ("event_rsvp_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "event_rsvp_tokens_expiry_after_creation" CHECK ("event_rsvp_tokens"."expires_at" > "event_rsvp_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"delivery_email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"display_name" text,
	"show_name" boolean DEFAULT false NOT NULL,
	"locale" "locale" NOT NULL,
	"privacy_notice_version" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_event_canonical_email_unique" UNIQUE("event_id","canonical_email"),
	CONSTRAINT "event_rsvps_display_name_length" CHECK ("event_rsvps"."display_name" IS NULL OR char_length("event_rsvps"."display_name") <= 80)
);
--> statement-breakpoint
CREATE TABLE "person_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_email" text NOT NULL,
	"delivery_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"display_name" text,
	"secret_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "person_sessions_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "person_sessions_secret_hash_is_sha256_hex" CHECK ("person_sessions"."secret_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "person_sessions_display_name_length" CHECK ("person_sessions"."display_name" IS NULL OR char_length("person_sessions"."display_name") <= 80)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_rsvp_tokens" ADD CONSTRAINT "event_rsvp_tokens_rsvp_id_event_rsvps_id_fk" FOREIGN KEY ("rsvp_id") REFERENCES "public"."event_rsvps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_rsvp_tokens_one_active_per_purpose" ON "event_rsvp_tokens" USING btree ("rsvp_id","purpose") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_rsvps_canonical_email_idx" ON "event_rsvps" USING btree ("canonical_email");--> statement-breakpoint
CREATE INDEX "person_sessions_canonical_email_idx" ON "person_sessions" USING btree ("canonical_email");--> statement-breakpoint
CREATE INDEX "person_sessions_expires_at_idx" ON "person_sessions" USING btree ("expires_at");