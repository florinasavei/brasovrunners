CREATE TABLE "event_volunteer_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name_ro" text NOT NULL,
	"name_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"contact_name" text,
	"contact_phone" text,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_categories_name_length" CHECK (char_length("event_volunteer_categories"."name_ro") BETWEEN 1 AND 80 AND char_length("event_volunteer_categories"."name_en") BETWEEN 1 AND 80),
	CONSTRAINT "event_volunteer_categories_contact_name_length" CHECK ("event_volunteer_categories"."contact_name" IS NULL OR char_length("event_volunteer_categories"."contact_name") BETWEEN 1 AND 120),
	CONSTRAINT "event_volunteer_categories_contact_phone_length" CHECK ("event_volunteer_categories"."contact_phone" IS NULL OR char_length("event_volunteer_categories"."contact_phone") BETWEEN 1 AND 40),
	CONSTRAINT "event_volunteer_categories_contact_email_length" CHECK ("event_volunteer_categories"."contact_email" IS NULL OR char_length("event_volunteer_categories"."contact_email") BETWEEN 3 AND 320)
);
--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteer_categories" ADD CONSTRAINT "event_volunteer_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_categories_event_idx" ON "event_volunteer_categories" USING btree ("event_id","sort");--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteer_categories_event_name_ro_unique" ON "event_volunteer_categories" USING btree ("event_id",lower("name_ro"));--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteer_categories_event_name_en_unique" ON "event_volunteer_categories" USING btree ("event_id",lower("name_en"));--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD CONSTRAINT "event_volunteer_roles_category_id_event_volunteer_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_volunteer_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_roles_category_idx" ON "event_volunteer_roles" USING btree ("category_id") WHERE "event_volunteer_roles"."category_id" IS NOT NULL;--> statement-breakpoint
-- Before the per-category uniqueness: a role name typed twice on one event (nothing enforced it until now) is told apart by a number, so the index below can never refuse the migration.
UPDATE "event_volunteer_roles" AS r SET "name_ro" = left(r."name_ro", 74) || ' (' || d."n" || ')' FROM (SELECT "id", row_number() OVER (PARTITION BY "event_id", lower("name_ro") ORDER BY "position", "created_at", "id") AS "n" FROM "event_volunteer_roles") AS d WHERE d."id" = r."id" AND d."n" > 1;--> statement-breakpoint
UPDATE "event_volunteer_roles" AS r SET "name_en" = left(r."name_en", 74) || ' (' || d."n" || ')' FROM (SELECT "id", row_number() OVER (PARTITION BY "event_id", lower("name_en") ORDER BY "position", "created_at", "id") AS "n" FROM "event_volunteer_roles") AS d WHERE d."id" = r."id" AND d."n" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteer_roles_category_name_ro_unique" ON "event_volunteer_roles" USING btree ("event_id",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name_ro"));--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteer_roles_category_name_en_unique" ON "event_volunteer_roles" USING btree ("event_id",coalesce("category_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name_en"));