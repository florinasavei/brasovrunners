CREATE TYPE "public"."event_volunteer_source" AS ENUM('STAFF', 'PUBLIC');--> statement-breakpoint
CREATE TYPE "public"."event_volunteer_state" AS ENUM('REGISTERED', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_RECEIVED';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_CLUB_NOTICE';--> statement-breakpoint
CREATE TABLE "event_volunteer_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"needed" integer NOT NULL,
	"description_ro" text,
	"description_en" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_roles_needed_positive" CHECK ("event_volunteer_roles"."needed" >= 1),
	CONSTRAINT "event_volunteer_roles_name_length" CHECK (char_length("event_volunteer_roles"."name_ro") BETWEEN 1 AND 80 AND char_length("event_volunteer_roles"."name_en") BETWEEN 1 AND 80),
	CONSTRAINT "event_volunteer_roles_description_length" CHECK (("event_volunteer_roles"."description_ro" IS NULL OR char_length("event_volunteer_roles"."description_ro") BETWEEN 1 AND 200) AND ("event_volunteer_roles"."description_en" IS NULL OR char_length("event_volunteer_roles"."description_en") BETWEEN 1 AND 200))
);
--> statement-breakpoint
CREATE TABLE "event_volunteers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"phone" text NOT NULL,
	"locale" "locale" DEFAULT 'ro' NOT NULL,
	"state" "event_volunteer_state" DEFAULT 'REGISTERED' NOT NULL,
	"source" "event_volunteer_source" NOT NULL,
	"message" text,
	"note" text,
	"privacy_notice_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_staff_user_id" uuid,
	CONSTRAINT "event_volunteers_event_canonical_email_unique" UNIQUE("event_id","canonical_email"),
	CONSTRAINT "event_volunteers_name_length" CHECK (char_length("event_volunteers"."name") BETWEEN 1 AND 120),
	CONSTRAINT "event_volunteers_message_length" CHECK ("event_volunteers"."message" IS NULL OR char_length("event_volunteers"."message") BETWEEN 1 AND 300),
	CONSTRAINT "event_volunteers_note_length" CHECK ("event_volunteers"."note" IS NULL OR char_length("event_volunteers"."note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "accepts_volunteers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD CONSTRAINT "event_volunteer_roles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_role_id_event_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_volunteer_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_roles_event_idx" ON "event_volunteer_roles" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "event_volunteers_role_idx" ON "event_volunteers" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "event_volunteers_canonical_email_idx" ON "event_volunteers" USING btree ("canonical_email");