ALTER TABLE "event_volunteer_roles" ADD COLUMN "colour" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "badge_design" jsonb;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD CONSTRAINT "event_volunteer_roles_colour_is_hex" CHECK ("event_volunteer_roles"."colour" IS NULL OR "event_volunteer_roles"."colour" ~ '^#[0-9a-fA-F]{6}$');