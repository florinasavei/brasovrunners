ALTER TYPE "public"."email_message_type" ADD VALUE 'RSVP_ASK';--> statement-breakpoint
ALTER TYPE "public"."newsletter_topic" ADD VALUE 'RSVP_ASK';--> statement-breakpoint
CREATE TABLE "event_rsvp_asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "event_rsvp_asks_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_rsvp_asks" ADD CONSTRAINT "event_rsvp_asks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;