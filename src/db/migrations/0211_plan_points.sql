-- «Punctele planului», the volunteers' points typed by hand on «Planul voluntarilor»: four columns on event_checkpoints.
-- `plan_only` marks a point of the volunteers' plan alone (never on the event's page, the chart, a race number, the event's
-- file or a copy); `start_finish` a point at the start–finish, which has no kilometre and no number — only a plan-only
-- point may be one; `latitude` and `longitude` say where a point is, both or neither, each within its range.
-- Adds columns and CHECK constraints only. Nothing is backfilled: every row from before is the editor's own point
-- (plan_only false, start_finish false) and has no coordinates until somebody types them.
ALTER TABLE "event_checkpoints" ADD COLUMN "plan_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD COLUMN "start_finish" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD COLUMN "latitude" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_start_finish_plan_only" CHECK (NOT "event_checkpoints"."start_finish" OR "event_checkpoints"."plan_only");--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_coordinates_pair" CHECK (("event_checkpoints"."latitude" IS NULL) = ("event_checkpoints"."longitude" IS NULL));--> statement-breakpoint
ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_coordinates_range" CHECK (("event_checkpoints"."latitude" IS NULL OR "event_checkpoints"."latitude" BETWEEN -90 AND 90) AND ("event_checkpoints"."longitude" IS NULL OR "event_checkpoints"."longitude" BETWEEN -180 AND 180));
