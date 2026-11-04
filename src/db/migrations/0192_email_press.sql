ALTER TABLE "email_outbox" ADD COLUMN "cause" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "press_id" uuid;--> statement-breakpoint
CREATE INDEX "email_outbox_press_idx" ON "email_outbox" USING btree ("press_id") WHERE "email_outbox"."press_id" is not null;