-- A volunteer may be given several roles (§837, amending §761): `event_volunteer_role_assignments`, one row per role
-- given, the shape and the cascades of the choices' table. Expand only: a new table and a backfill — every existing
-- volunteer's `role_id` becomes their one assignment. `event_volunteers.role_id` itself stays, untouched here and mirrored
-- by every later write as the first role given, until a later contract release drops it; nothing reads it after this one.
CREATE TABLE "event_volunteer_role_assignments" (
	"volunteer_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_role_assignments_volunteer_id_role_id_pk" PRIMARY KEY("volunteer_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "event_volunteer_role_assignments" ADD CONSTRAINT "event_volunteer_role_assignments_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_role_assignments" ADD CONSTRAINT "event_volunteer_role_assignments_role_id_event_volunteer_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."event_volunteer_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_role_assignments_role_idx" ON "event_volunteer_role_assignments" USING btree ("role_id");--> statement-breakpoint
INSERT INTO "event_volunteer_role_assignments" ("volunteer_id", "role_id", "created_at")
SELECT "id", "role_id", "updated_at" FROM "event_volunteers" WHERE "role_id" IS NOT NULL
ON CONFLICT DO NOTHING;
