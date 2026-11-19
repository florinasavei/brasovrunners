-- «Start» on «Cronometrare»: the moment an organizer pressed the gun at the start line, and who pressed it. The finish line counts
-- from it (`results.ts#gunOf`: `race_gun_at`, else `race_starts_at`, else `starts_at`); nothing public reads it. Expand only: two
-- nullable columns, the account's key (ON DELETE SET NULL: a removed account leaves the moment) and a CHECK that names nobody
-- without a moment. Nothing is backfilled, so every race counts from its planned gun until somebody presses «Start».
ALTER TABLE "events" ADD COLUMN "race_gun_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "race_gun_by_staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_race_gun_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("race_gun_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_race_gun_actor" CHECK ("events"."race_gun_by_staff_user_id" IS NULL OR "events"."race_gun_at" IS NOT NULL);
