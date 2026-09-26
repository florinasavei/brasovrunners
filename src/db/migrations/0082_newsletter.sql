CREATE TYPE "public"."newsletter_send_kind" AS ENUM('MESSAGE', 'EVENT_ALERT');--> statement-breakpoint
CREATE TYPE "public"."newsletter_token_purpose" AS ENUM('CONFIRM', 'MANAGE');--> statement-breakpoint
CREATE TYPE "public"."newsletter_topic" AS ENUM('ALL', 'NEW_EVENTS', 'BIG_EVENTS', 'SPECIAL_EVENTS', 'GEAR_TESTING', 'DISCOUNTS', 'VOLUNTEERING', 'CLUB_NEWS');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'NEWSLETTER_CONFIRM';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'NEWSLETTER';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'NEW_EVENT_ALERT';--> statement-breakpoint
CREATE TABLE "newsletter_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "newsletter_send_kind" NOT NULL,
	"topics" "newsletter_topic"[] NOT NULL,
	"event_id" uuid,
	"subject" jsonb,
	"body" jsonb,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_sends_recipients_non_negative" CHECK ("newsletter_sends"."recipients" >= 0)
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"locale" "locale" NOT NULL,
	"topics" "newsletter_topic"[] NOT NULL,
	"privacy_notice_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "newsletter_subscribers_canonical_email_unique" UNIQUE("canonical_email"),
	CONSTRAINT "newsletter_subscribers_topics_not_empty" CHECK (cardinality("newsletter_subscribers"."topics") >= 1)
);
--> statement-breakpoint
CREATE TABLE "newsletter_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"purpose" "newsletter_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "newsletter_tokens_hash_is_sha256_hex" CHECK ("newsletter_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "newsletter_tokens_expiry_after_creation" CHECK ("newsletter_tokens"."expires_at" > "newsletter_tokens"."created_at")
);
--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_sent_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("sent_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_tokens" ADD CONSTRAINT "newsletter_tokens_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_sends_one_alert_per_event" ON "newsletter_sends" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "newsletter_sends_created_idx" ON "newsletter_sends" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "newsletter_subscribers_confirmed_idx" ON "newsletter_subscribers" USING btree ("confirmed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_tokens_one_active_confirm" ON "newsletter_tokens" USING btree ("subscriber_id") WHERE "purpose" = 'CONFIRM' AND "used_at" IS NULL AND "invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "newsletter_tokens_subscriber_purpose_expiry_idx" ON "newsletter_tokens" USING btree ("subscriber_id","purpose","expires_at");