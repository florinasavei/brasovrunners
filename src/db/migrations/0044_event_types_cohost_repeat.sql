ALTER TYPE "public"."event_type" ADD VALUE 'GEAR_TEST';--> statement-breakpoint
ALTER TYPE "public"."event_type" ADD VALUE 'EXTERNAL';--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "co_host_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "co_host_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "repeat_rule" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "repeat_of" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_repeat_of_events_id_fk" FOREIGN KEY ("repeat_of") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_repeat_rule_idx" ON "events" USING btree ("id") WHERE "events"."repeat_rule" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "events_repeat_of_starts_at_idx" ON "events" USING btree ("repeat_of","starts_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_co_host_url_is_https" CHECK ("events"."co_host_url" IS NULL OR "events"."co_host_url" LIKE 'https://%');