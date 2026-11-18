-- «Poze și hărți» of «Planul voluntarilor»: the plan's pictures and links, several of each, in two new tables.
-- `event_volunteer_plan_pictures` — a stored picture (media_assets) on one event's plan, in its order, once a plan;
-- `event_volunteer_plan_links` — an http(s) address and an optional label, in its order. Both cascade from the event.
-- Expand only: two tables, their keys and checks, and one copy. Each event's one picture of the release before
-- (`events.volunteer_plan_media_asset_id`) is copied in at position 1 when it names a stored picture that is no film
-- poster, so no plan loses its picture. The column stays, written by nobody from now on and still counted by the
-- pictures' reference check; dropping it is a later contract release.
CREATE TABLE "event_volunteer_plan_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_plan_links_url_length" CHECK (char_length("event_volunteer_plan_links"."url") <= 2000),
	CONSTRAINT "event_volunteer_plan_links_label_length" CHECK ("event_volunteer_plan_links"."label" IS NULL OR char_length("event_volunteer_plan_links"."label") <= 120),
	CONSTRAINT "event_volunteer_plan_links_position_positive" CHECK ("event_volunteer_plan_links"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "event_volunteer_plan_pictures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_volunteer_plan_pictures_event_asset_unique" UNIQUE("event_id","media_asset_id"),
	CONSTRAINT "event_volunteer_plan_pictures_position_positive" CHECK ("event_volunteer_plan_pictures"."position" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_volunteer_plan_links" ADD CONSTRAINT "event_volunteer_plan_links_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_plan_pictures" ADD CONSTRAINT "event_volunteer_plan_pictures_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_volunteer_plan_pictures" ADD CONSTRAINT "event_volunteer_plan_pictures_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteer_plan_links_event_position_idx" ON "event_volunteer_plan_links" USING btree ("event_id","position");--> statement-breakpoint
CREATE INDEX "event_volunteer_plan_pictures_event_position_idx" ON "event_volunteer_plan_pictures" USING btree ("event_id","position");--> statement-breakpoint
INSERT INTO "event_volunteer_plan_pictures" ("event_id", "media_asset_id", "position")
SELECT "events"."id", "events"."volunteer_plan_media_asset_id", 1
FROM "events"
JOIN "media_assets" ON "media_assets"."id" = "events"."volunteer_plan_media_asset_id"
WHERE "media_assets"."key_prefix" NOT LIKE 'yt-%';
