ALTER TABLE "event_volunteers" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteers_show_counts" boolean DEFAULT false NOT NULL;