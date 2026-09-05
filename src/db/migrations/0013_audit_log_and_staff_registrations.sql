/*
  Staff-entered registrations, and the trail that says who did what (BR-REQ-037-03,
  BR-REQ-037-05, DECISIONS.md §33).

  `audit_logs` is the table AGENTS.md §12.12 has described since the first baseline and nothing
  ever created. It arrives now because the backoffice starts changing registrations rather than
  only reading them, and "an administrator corrected a name" is a fact somebody will ask about
  after the event.

  Additive only: a new table, and two columns whose defaults describe every row that already
  exists — every registration in the database arrived through the public form.
*/
CREATE TYPE "public"."registration_source" AS ENUM('PUBLIC', 'STAFF');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_staff_user_id" uuid,
	"participant_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "source" "registration_source" DEFAULT 'PUBLIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "created_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_staff_user_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_staff_user_id","created_at");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_created_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("created_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
