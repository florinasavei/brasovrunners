ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_sent_at_matches_status";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_sent_at_matches_status" CHECK (("email_outbox"."status" <> 'SENT' OR "email_outbox"."sent_at" IS NOT NULL)
          AND ("email_outbox"."status" NOT IN ('PENDING', 'PROCESSING', 'FAILED') OR "email_outbox"."sent_at" IS NULL));