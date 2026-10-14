-- A volunteer ticks every role they would do; the organizers give each one a role (§761, amending §754 and §758).
-- Expand only: a new message type, a new table, and `event_volunteers.role_id` relaxed to accept NULL (an offer
-- nobody has placed yet) — dropping NOT NULL refuses nothing that was accepted before, so the code serving while
-- this runs is not broken by it. The backfill makes each existing volunteer's role both their one choice and their
-- assigned role (`role_id` itself is left as it is).
ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_ROLE_ASSIGNED';--> statement-breakpoint
CREATE TABLE "event_volunteer_role_choices" (
	"volunteer_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_role_choices_volunteer_id_role_id_pk" PRIMARY KEY("volunteer_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "event_volunteers" ALTER COLUMN "role_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_role_choices" ADD CONSTRAINT "event_volunteer_role_choices_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_role_choices" ADD CONSTRAINT "event_volunteer_role_choices_role_id_event_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_volunteer_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_role_choices_role_idx" ON "event_volunteer_role_choices" USING btree ("role_id");--> statement-breakpoint
INSERT INTO "event_volunteer_role_choices" ("volunteer_id", "role_id", "created_at")
SELECT "id", "role_id", "created_at" FROM "event_volunteers" WHERE "role_id" IS NOT NULL
ON CONFLICT DO NOTHING;
