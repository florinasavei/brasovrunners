ALTER TABLE "events" ADD COLUMN "co_hosts" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_special" boolean DEFAULT false NOT NULL;