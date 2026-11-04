ALTER TABLE "event_elite_entries" ADD COLUMN "in_results" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_elite_entries" ADD COLUMN "on_site" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "elite_hidden_from_results" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "elite_hidden_from_site" boolean DEFAULT false NOT NULL;