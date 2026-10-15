ALTER TYPE "public"."email_message_type" ADD VALUE 'CONTACT_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'FEEDBACK_MESSAGE';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'RELAY_NOTICE';--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "road" text;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "road_failures" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "body_deleted_at" timestamp with time zone;