ALTER TABLE "email_outbox" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "recipient_count" integer;--> statement-breakpoint
CREATE INDEX "email_outbox_transport_sent_idx" ON "email_outbox" USING btree ("transport","sent_at");