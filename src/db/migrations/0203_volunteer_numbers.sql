ALTER TABLE "event_volunteers" ADD COLUMN "bib_number" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "volunteer_bib_start" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "event_volunteers_event_bib_number_unique" ON "event_volunteers" USING btree ("event_id","bib_number") WHERE "event_volunteers"."bib_number" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_bib_number_positive" CHECK ("event_volunteers"."bib_number" IS NULL OR "event_volunteers"."bib_number" > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_volunteer_bib_start_range" CHECK ("events"."volunteer_bib_start" IS NULL OR ("events"."volunteer_bib_start" >= 1 AND "events"."volunteer_bib_start" <= 99000));