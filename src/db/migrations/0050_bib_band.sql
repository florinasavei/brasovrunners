ALTER TABLE "events" ADD COLUMN "bib_start_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "bib_colour" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_bib_start_number_positive" CHECK ("events"."bib_start_number" >= 1 AND "events"."bib_start_number" <= 99000);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_bib_colour_is_hex" CHECK ("events"."bib_colour" IS NULL OR "events"."bib_colour" ~ '^#[0-9a-fA-F]{6}$');