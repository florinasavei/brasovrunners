ALTER TABLE "events" ADD COLUMN "date_to_be_announced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "time_to_be_announced" boolean DEFAULT false NOT NULL;