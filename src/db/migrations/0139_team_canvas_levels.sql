ALTER TABLE "team_members" ADD COLUMN "level" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_level_range" CHECK ("team_members"."level" IS NULL OR ("team_members"."level" >= 1 AND "team_members"."level" <= 9));
