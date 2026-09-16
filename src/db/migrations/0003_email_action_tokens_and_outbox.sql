CREATE TYPE "public"."email_action_token_purpose" AS ENUM('VERIFY_REGISTRATION_EMAIL', 'COMPLETE_DECLARATION', 'MANAGE_REGISTRATION', 'WAITLIST_OFFER', 'MANAGE_PROFILE');--> statement-breakpoint
CREATE TYPE "public"."email_message_type" AS ENUM('VERIFY_REGISTRATION_EMAIL', 'COMPLETE_DECLARATION', 'WAITLIST_JOINED', 'WAITLIST_SPOT_OFFER', 'REGISTRATION_CONFIRMED', 'REGISTRATION_CANCELLED', 'WAITLIST_OFFER_EXPIRED', 'REGISTRATION_MANAGE_LINK', 'PROFILE_MANAGE_LINK', 'REGISTRATION_STATE_NOTICE');--> statement-breakpoint
CREATE TYPE "public"."email_outbox_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'BOUNCED', 'COMPLAINED');--> statement-breakpoint
CREATE TABLE "email_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"registration_id" uuid,
	"purpose" "email_action_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_action_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_action_tokens_hash_is_sha256_hex" CHECK ("email_action_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_action_tokens_expiry_after_creation" CHECK ("email_action_tokens"."expires_at" > "email_action_tokens"."created_at"),
	CONSTRAINT "email_action_tokens_registration_scope_matches_purpose" CHECK (("email_action_tokens"."purpose" = 'MANAGE_PROFILE') = ("email_action_tokens"."registration_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid,
	"registration_id" uuid,
	"message_type" "email_message_type" NOT NULL,
	"locale" "locale" NOT NULL,
	"recipient_email" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by_staff_user_id" uuid,
	"is_manual_resend" boolean DEFAULT false NOT NULL,
	"status" "email_outbox_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "email_outbox_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "email_outbox_attempt_count_non_negative" CHECK ("email_outbox"."attempt_count" >= 0),
	CONSTRAINT "email_outbox_sent_at_matches_status" CHECK (("email_outbox"."status" = 'SENT') = ("email_outbox"."sent_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD CONSTRAINT "email_action_tokens_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_tokens_one_active_per_registration_purpose" ON "email_action_tokens" USING btree ("registration_id","purpose") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_tokens_one_active_per_participant_purpose" ON "email_action_tokens" USING btree ("participant_id","purpose") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NULL;--> statement-breakpoint
CREATE INDEX "email_action_tokens_participant_purpose_expiry_idx" ON "email_action_tokens" USING btree ("participant_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "email_action_tokens_registration_purpose_expiry_idx" ON "email_action_tokens" USING btree ("registration_id","purpose","expires_at");--> statement-breakpoint
CREATE INDEX "email_outbox_status_next_attempt_created_idx" ON "email_outbox" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "email_outbox_registration_created_idx" ON "email_outbox" USING btree ("registration_id","created_at");