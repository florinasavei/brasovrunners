CREATE TYPE "public"."volunteers_access" AS ENUM('ANYONE', 'MEMBERS', 'INVITED');--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_INVITATION';--> statement-breakpoint
CREATE TABLE "event_volunteer_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"delivery_email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"locale" "locale" DEFAULT 'ro' NOT NULL,
	"token_hash" text,
	"message_ro" text,
	"message_en" text,
	"invited_by_staff_user_id" uuid,
	"sent_at" timestamp with time zone NOT NULL,
	"resent_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"volunteer_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_staff_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_volunteer_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "event_volunteer_invitations_event_canonical_email_unique" UNIQUE("event_id","canonical_email"),
	CONSTRAINT "event_volunteer_invitations_message_length" CHECK ("event_volunteer_invitations"."message_ro" IS NULL OR char_length("event_volunteer_invitations"."message_ro") BETWEEN 1 AND 500),
	CONSTRAINT "event_volunteer_invitations_message_en_length" CHECK ("event_volunteer_invitations"."message_en" IS NULL OR char_length("event_volunteer_invitations"."message_en") BETWEEN 1 AND 500),
	CONSTRAINT "event_volunteer_invitations_message_both_languages" CHECK (("event_volunteer_invitations"."message_ro" IS NULL) = ("event_volunteer_invitations"."message_en" IS NULL)),
	CONSTRAINT "event_volunteer_invitations_used_has_moment" CHECK ("event_volunteer_invitations"."volunteer_id" IS NULL OR "event_volunteer_invitations"."used_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteers_access" "volunteers_access" DEFAULT 'ANYONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_invitations" ADD CONSTRAINT "event_volunteer_invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_invitations" ADD CONSTRAINT "event_volunteer_invitations_invited_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("invited_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_invitations" ADD CONSTRAINT "event_volunteer_invitations_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_invitations" ADD CONSTRAINT "event_volunteer_invitations_withdrawn_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("withdrawn_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_invitations_canonical_email_idx" ON "event_volunteer_invitations" USING btree ("canonical_email");--> statement-breakpoint
CREATE INDEX "event_volunteer_invitations_volunteer_idx" ON "event_volunteer_invitations" USING btree ("volunteer_id") WHERE "event_volunteer_invitations"."volunteer_id" IS NOT NULL;