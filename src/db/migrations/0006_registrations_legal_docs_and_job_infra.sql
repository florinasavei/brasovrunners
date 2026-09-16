CREATE TYPE "public"."legal_document_key" AS ENUM('PRIVACY_NOTICE', 'TERMS', 'EVENT_DECLARATION');--> statement-breakpoint
CREATE TYPE "public"."registration_cancellation_source" AS ENUM('PARTICIPANT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."registration_expiry_reason" AS ENUM('EMAIL_CONFIRMATION_LAPSED', 'DECLARATION_HOLD_LAPSED', 'WAITLIST_OFFER_LAPSED', 'EVENT_STARTED');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('PENDING_EMAIL_CONFIRMATION', 'PENDING_DECLARATION', 'WAITLISTED', 'WAITLIST_OFFERED', 'CONFIRMED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "declaration_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"declaration_version" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"locale" "locale" NOT NULL,
	"typed_name" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "declaration_acceptances_version_positive" CHECK ("declaration_acceptances"."declaration_version" >= 1),
	CONSTRAINT "declaration_acceptances_hash_is_sha256_hex" CHECK ("declaration_acceptances"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"items_processed" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "job_runs_items_processed_non_negative" CHECK ("job_runs"."items_processed" >= 0),
	CONSTRAINT "job_runs_error_count_non_negative" CHECK ("job_runs"."error_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "legal_document_translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_document_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"body_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_document_translations_document_locale_unique" UNIQUE("legal_document_id","locale")
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "legal_document_key" NOT NULL,
	"version" integer NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"content_sha256" text NOT NULL,
	"created_by_staff_user_id" uuid,
	"approved_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_documents_key_version_unique" UNIQUE("key","version"),
	CONSTRAINT "legal_documents_version_positive" CHECK ("legal_documents"."version" >= 1),
	CONSTRAINT "legal_documents_hash_is_sha256_hex" CHECK ("legal_documents"."content_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"window_starts_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_key_window_starts_at_pk" PRIMARY KEY("scope","key","window_starts_at"),
	CONSTRAINT "rate_limit_buckets_count_non_negative" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"status" "registration_status" NOT NULL,
	"locale" "locale" NOT NULL,
	"registered_name" text NOT NULL,
	"privacy_notice_version" integer NOT NULL,
	"privacy_acknowledged_at" timestamp with time zone NOT NULL,
	"race_id" uuid,
	"results_name_consent" boolean NOT NULL,
	"results_consent_version" integer NOT NULL,
	"bib_number" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_confirmed_at" timestamp with time zone,
	"waitlisted_at" timestamp with time zone,
	"offer_created_at" timestamp with time zone,
	"hold_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"expiry_reason" "registration_expiry_reason",
	"cancellation_source" "registration_cancellation_source",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_event_participant_unique" UNIQUE("event_id","participant_id"),
	CONSTRAINT "registrations_bib_number_not_assigned_in_m1" CHECK ("registrations"."bib_number" IS NULL),
	CONSTRAINT "registrations_cancellation_fields_together" CHECK (("registrations"."cancellation_source" IS NULL) = ("registrations"."cancelled_at" IS NULL)),
	CONSTRAINT "registrations_expiry_fields_together" CHECK (("registrations"."expiry_reason" IS NULL) = ("registrations"."expired_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "declaration_acceptances" ADD CONSTRAINT "declaration_acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_translations" ADD CONSTRAINT "legal_document_translations_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_approved_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("approved_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "declaration_acceptances_registration_accepted_at_idx" ON "declaration_acceptances" USING btree ("registration_id","accepted_at");--> statement-breakpoint
CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_race_participant_active_unique" ON "registrations" USING btree ("race_id","participant_id") WHERE "registrations"."race_id" IS NOT NULL AND "registrations"."status" IN ('PENDING_EMAIL_CONFIRMATION', 'PENDING_DECLARATION', 'WAITLISTED', 'WAITLIST_OFFERED', 'CONFIRMED');--> statement-breakpoint
CREATE INDEX "registrations_event_status_idx" ON "registrations" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "registrations_participant_status_idx" ON "registrations" USING btree ("participant_id","status");--> statement-breakpoint
CREATE INDEX "registrations_event_waitlisted_at_id_idx" ON "registrations" USING btree ("event_id","waitlisted_at","id");--> statement-breakpoint
CREATE INDEX "registrations_event_hold_expires_at_idx" ON "registrations" USING btree ("event_id","hold_expires_at");--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD CONSTRAINT "email_action_tokens_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_requested_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("requested_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_declaration_document_id_legal_documents_id_fk" FOREIGN KEY ("declaration_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;