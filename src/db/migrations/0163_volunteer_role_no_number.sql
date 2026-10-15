ALTER TABLE "event_volunteer_roles" DROP CONSTRAINT "event_volunteer_roles_needed_positive";--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ALTER COLUMN "needed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteer_roles" ADD CONSTRAINT "event_volunteer_roles_needed_positive" CHECK ("event_volunteer_roles"."needed" IS NULL OR "event_volunteer_roles"."needed" >= 1);