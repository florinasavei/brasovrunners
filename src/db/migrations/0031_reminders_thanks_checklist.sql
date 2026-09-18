-- Expand only (AGENTS.md §7.6): two enum values and two nullable columns.
-- DECISIONS.md §81 (the reminder and the checklist line) and §82 (the thank-you).
ALTER TYPE "public"."email_message_type" ADD VALUE 'EVENT_REMINDER';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'EVENT_THANKS';--> statement-breakpoint
ALTER TABLE "event_translations" ADD COLUMN "checklist" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "thanks_sent_at" timestamp with time zone;
