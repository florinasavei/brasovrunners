CREATE TABLE "pending_family_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"participant_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"action_token_id" uuid,
	"locale" "locale" NOT NULL,
	"fields" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_family_entries" ADD CONSTRAINT "pending_family_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_family_entries" ADD CONSTRAINT "pending_family_entries_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_family_entries" ADD CONSTRAINT "pending_family_entries_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_family_entries" ADD CONSTRAINT "pending_family_entries_action_token_id_email_action_tokens_id_fk" FOREIGN KEY ("action_token_id") REFERENCES "public"."email_action_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_family_entries_action_token_unique" ON "pending_family_entries" USING btree ("action_token_id");--> statement-breakpoint
CREATE INDEX "pending_family_entries_expires_at_idx" ON "pending_family_entries" USING btree ("expires_at");