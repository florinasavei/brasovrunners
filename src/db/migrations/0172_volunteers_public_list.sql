ALTER TABLE "event_volunteers" ADD COLUMN "list_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD COLUMN "list_opt_in_notice_version" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteers_list_public" boolean DEFAULT false NOT NULL;