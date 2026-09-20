ALTER TYPE "public"."email_message_type" ADD VALUE 'REGISTRATION_OPENED';--> statement-breakpoint
CREATE TABLE "registration_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"delivery_email" text NOT NULL,
	"canonical_email" text NOT NULL,
	"canonicalization_version" integer NOT NULL,
	"locale" "locale" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registration_interests_event_canonical_email_unique" UNIQUE("event_id","canonical_email")
);
--> statement-breakpoint
ALTER TABLE "registration_interests" ADD CONSTRAINT "registration_interests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;