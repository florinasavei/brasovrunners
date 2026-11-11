-- «Note interne» for volunteers (amending §754's single organizers' line, after §777 and §785): `event_volunteer_notes`, one row
-- per note, the shape and the cascades of `registration_notes`. Expand only: a new table and a carry — every volunteer whose
-- `event_volunteers.note` holds words gets that line as one note, the words verbatim. `event_volunteers.note` and its CHECK
-- stay, untouched here, until a later contract release carries what is left in it and drops it; nothing new writes it.
CREATE TABLE "event_volunteer_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"volunteer_id" uuid NOT NULL,
	"author_staff_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_volunteer_notes_body_length" CHECK (char_length("event_volunteer_notes"."body") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "event_volunteer_notes" ADD CONSTRAINT "event_volunteer_notes_volunteer_id_event_volunteers_id_fk" FOREIGN KEY ("volunteer_id") REFERENCES "public"."event_volunteers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_notes" ADD CONSTRAINT "event_volunteer_notes_author_staff_user_id_staff_users_id_fk" FOREIGN KEY ("author_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_notes_volunteer_idx" ON "event_volunteer_notes" USING btree ("volunteer_id","created_at");--> statement-breakpoint
-- The carry. Who wrote the line and when, where the trail knows it: the latest «Modifică» of that volunteer whose audit row names the
-- field `note` (entity `event`, the event's id, `metadata_json` → `volunteerId` and `fields`, matched by containment); with none, the
-- row's own creator and moment — a person the club typed with the note at the add; otherwise no author (the card says «autor necunoscut»).
INSERT INTO "event_volunteer_notes" ("volunteer_id", "author_staff_user_id", "body", "created_at", "updated_at")
SELECT
	"v"."id",
	CASE WHEN "trail"."at" IS NULL THEN "v"."created_by_staff_user_id" ELSE "trail"."actor" END,
	"v"."note",
	COALESCE("trail"."at", "v"."created_at"),
	COALESCE("trail"."at", "v"."created_at")
FROM "event_volunteers" AS "v"
LEFT JOIN LATERAL (
	SELECT "a"."actor_staff_user_id" AS "actor", "a"."created_at" AS "at"
	FROM "audit_logs" AS "a"
	WHERE "a"."action" = 'volunteer.edited'
		AND "a"."entity_type" = 'event'
		AND "a"."entity_id" = "v"."event_id"
		AND "a"."metadata_json" @> jsonb_build_object('volunteerId', "v"."id"::text, 'fields', jsonb_build_array('note'))
	ORDER BY "a"."created_at" DESC, "a"."id" DESC
	LIMIT 1
) AS "trail" ON true
WHERE "v"."note" IS NOT NULL AND btrim("v"."note") <> '';
