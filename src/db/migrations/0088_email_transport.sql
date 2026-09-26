ALTER TABLE "email_outbox" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "recipient_count" integer;