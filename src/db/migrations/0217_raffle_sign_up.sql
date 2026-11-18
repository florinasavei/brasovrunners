CREATE TYPE "public"."raffle_entry_method" AS ENUM('LINK', 'FORM', 'DESK', 'STAFF');--> statement-breakpoint
CREATE TABLE "event_raffle_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid,
	"volunteer_id" uuid,
	"elite_entry_id" uuid,
	"method" "raffle_entry_method" NOT NULL,
	"rules_document_id" uuid NOT NULL,
	"rules_accepted_at" timestamp with time zone NOT NULL,
	"rules_locale" "locale" NOT NULL,
	"rules_text_hash" text NOT NULL,
	"rules_facts" jsonb NOT NULL,
	"typed_name" text,
	"ip" text,
	"user_agent" text,
	"recorded_by_staff_user_id" uuid,
	"privacy_notice_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_raffle_entries_registration_unique" UNIQUE("registration_id"),
	CONSTRAINT "event_raffle_entries_volunteer_unique" UNIQUE("volunteer_id"),
	CONSTRAINT "event_raffle_entries_elite_entry_unique" UNIQUE("elite_entry_id"),
	CONSTRAINT "event_raffle_entries_one_person" CHECK (num_nonnulls("event_raffle_entries"."registration_id", "event_raffle_entries"."volunteer_id", "event_raffle_entries"."elite_entry_id") = 1),
	CONSTRAINT "event_raffle_entries_rules_hash_sha256" CHECK ("event_raffle_entries"."rules_text_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "event_raffle_entries_typed_name_form" CHECK ("event_raffle_entries"."typed_name" IS NULL OR ("event_raffle_entries"."method" = 'FORM' AND char_length("event_raffle_entries"."typed_name") BETWEEN 1 AND 120)),
	CONSTRAINT "event_raffle_entries_trace_electronic" CHECK (("event_raffle_entries"."ip" IS NULL AND "event_raffle_entries"."user_agent" IS NULL) OR "event_raffle_entries"."method" IN ('LINK', 'FORM')),
	CONSTRAINT "event_raffle_entries_recorder_staff" CHECK ("event_raffle_entries"."recorded_by_staff_user_id" IS NULL OR "event_raffle_entries"."method" IN ('DESK', 'STAFF')),
	CONSTRAINT "event_raffle_entries_notice_version_positive" CHECK ("event_raffle_entries"."privacy_notice_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD COLUMN "in_raffle" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD COLUMN "present" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raffle_runners" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raffle_elites" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raffle_volunteers" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raffle_sign_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "raffle_sign_up_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_elite_entry_id_event_elite_entries_id_fk" FOREIGN KEY ("elite_entry_id") REFERENCES "public"."event_elite_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_rules_document_id_legal_documents_id_fk" FOREIGN KEY ("rules_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_raffle_entries" ADD CONSTRAINT "event_raffle_entries_recorded_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("recorded_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_raffle_entries_event_idx" ON "event_raffle_entries" USING btree ("event_id");