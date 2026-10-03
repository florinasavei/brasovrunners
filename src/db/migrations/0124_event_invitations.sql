CREATE TABLE "event_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"locale" "locale" DEFAULT 'ro' NOT NULL,
	"member_staff_user_id" uuid,
	"invited_by_staff_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"outside_capacity" boolean DEFAULT false NOT NULL,
	"supplementary_raise" boolean DEFAULT false NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_registration_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by_staff_user_id" uuid,
	"expired_at" timestamp with time zone,
	"resend_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_action_tokens" DROP CONSTRAINT "email_action_tokens_registration_scope_matches_purpose";--> statement-breakpoint
DROP INDEX "email_action_tokens_one_active_per_participant_purpose";--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD COLUMN "invitation_id" uuid;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_member_staff_user_id_staff_users_id_fk" FOREIGN KEY ("member_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_invited_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("invited_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_accepted_registration_id_registrations_id_fk" FOREIGN KEY ("accepted_registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_withdrawn_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("withdrawn_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_invitations_live_address_unique" ON "event_invitations" USING btree ("event_id","canonical_email") WHERE "event_invitations"."accepted_at" IS NULL AND "event_invitations"."withdrawn_at" IS NULL AND "event_invitations"."expired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_invitations_event_expires_idx" ON "event_invitations" USING btree ("event_id","expires_at");--> statement-breakpoint
CREATE INDEX "event_invitations_participant_idx" ON "event_invitations" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "event_invitations_accepted_registration_idx" ON "event_invitations" USING btree ("accepted_registration_id");--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD CONSTRAINT "email_action_tokens_invitation_id_event_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."event_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_tokens_one_active_per_invitation" ON "email_action_tokens" USING btree ("invitation_id") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL AND "invitation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "email_action_tokens_one_active_per_participant_purpose" ON "email_action_tokens" USING btree ("participant_id","purpose") WHERE "used_at" IS NULL AND "invalidated_at" IS NULL AND "registration_id" IS NULL AND "invitation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD CONSTRAINT "email_action_tokens_invitation_scope_matches_purpose" CHECK (("email_action_tokens"."purpose"::text = 'ACCEPT_INVITATION') = ("email_action_tokens"."invitation_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "email_action_tokens" ADD CONSTRAINT "email_action_tokens_registration_scope_matches_purpose" CHECK (("email_action_tokens"."purpose"::text in ('MANAGE_PROFILE', 'ACCEPT_INVITATION')) = ("email_action_tokens"."registration_id" IS NULL));