CREATE TYPE "public"."volunteer_agreement_method" AS ENUM('FORM', 'LINK', 'PAPER');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_AGREEMENT_REQUEST';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_AGREEMENT_ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."legal_document_key" ADD VALUE 'VOLUNTEER_AGREEMENT';--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_document_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_method" "volunteer_agreement_method";--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_locale" "locale";--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_text_hash" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_facts" jsonb;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_recorded_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "declared_adult" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_token_hash" text;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "agreement_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_document_id_legal_documents_id_fk" FOREIGN KEY ("agreement_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_recorded_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("agreement_recorded_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteers_agreement_document_idx" ON "event_volunteers" USING btree ("agreement_document_id") WHERE "event_volunteers"."agreement_document_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_token_hash_unique" UNIQUE("agreement_token_hash");--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_complete" CHECK (("event_volunteers"."agreement_document_id" IS NULL) = ("event_volunteers"."agreement_accepted_at" IS NULL) AND ("event_volunteers"."agreement_document_id" IS NULL) = ("event_volunteers"."agreement_method" IS NULL) AND ("event_volunteers"."agreement_document_id" IS NULL) = ("event_volunteers"."agreement_locale" IS NULL));--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_text_hash_sha256" CHECK ("event_volunteers"."agreement_text_hash" IS NULL OR "event_volunteers"."agreement_text_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_token_sha256" CHECK ("event_volunteers"."agreement_token_hash" IS NULL OR "event_volunteers"."agreement_token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_agreement_token_expiry" CHECK (("event_volunteers"."agreement_token_hash" IS NULL) = ("event_volunteers"."agreement_token_expires_at" IS NULL));