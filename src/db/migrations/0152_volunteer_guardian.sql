CREATE TYPE "public"."volunteer_guardian_method" AS ENUM('LINK', 'PAPER');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_GUARDIAN_REQUEST';--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_email" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_document_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_method" "volunteer_guardian_method";--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_locale" "locale";--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_text_hash" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_facts" jsonb;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_typed_name" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_recorded_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_token_hash" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "guardian_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_document_id_legal_documents_id_fk" FOREIGN KEY ("guardian_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_recorded_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("guardian_recorded_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteers_guardian_document_idx" ON "event_volunteers" USING btree ("guardian_document_id") WHERE "event_volunteers"."guardian_document_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_token_hash_unique" UNIQUE("guardian_token_hash");--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_name_length" CHECK ("event_volunteers"."guardian_name" IS NULL OR char_length("event_volunteers"."guardian_name") BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_email_length" CHECK ("event_volunteers"."guardian_email" IS NULL OR ("event_volunteers"."guardian_name" IS NOT NULL AND char_length("event_volunteers"."guardian_email") BETWEEN 3 AND 320));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_complete" CHECK (("event_volunteers"."guardian_document_id" IS NULL) = ("event_volunteers"."guardian_accepted_at" IS NULL) AND ("event_volunteers"."guardian_document_id" IS NULL) = ("event_volunteers"."guardian_method" IS NULL) AND ("event_volunteers"."guardian_document_id" IS NULL) = ("event_volunteers"."guardian_locale" IS NULL) AND ("event_volunteers"."guardian_accepted_at" IS NULL OR "event_volunteers"."guardian_name" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_typed_name_length" CHECK ("event_volunteers"."guardian_typed_name" IS NULL OR char_length("event_volunteers"."guardian_typed_name") BETWEEN 1 AND 120);--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_text_hash_sha256" CHECK ("event_volunteers"."guardian_text_hash" IS NULL OR "event_volunteers"."guardian_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_token_sha256" CHECK ("event_volunteers"."guardian_token_hash" IS NULL OR "event_volunteers"."guardian_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_guardian_token_expiry" CHECK (("event_volunteers"."guardian_token_hash" IS NULL) = ("event_volunteers"."guardian_token_expires_at" IS NULL));