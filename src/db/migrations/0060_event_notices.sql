-- Expand only (AGENTS.md §7.6): two enum values, nothing else. The participants of an event are
-- told when the organizer changes its place, start or programme and asks for it
-- (EVENT_UPDATE_NOTICE), and when the event is cancelled, with the reason (EVENT_CANCELLED).
ALTER TYPE "public"."email_message_type" ADD VALUE 'EVENT_UPDATE_NOTICE';--> statement-breakpoint
ALTER TYPE "public"."email_message_type" ADD VALUE 'EVENT_CANCELLED';
