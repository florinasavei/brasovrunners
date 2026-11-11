CREATE TABLE "registration_reconfirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"send_id" uuid NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"reconfirmed_at" timestamp with time zone,
	CONSTRAINT "registration_reconfirmations_registration_send_unique" UNIQUE("registration_id","send_id")
);
--> statement-breakpoint
ALTER TABLE "registration_reconfirmations" ADD CONSTRAINT "registration_reconfirmations_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_reconfirmations" ADD CONSTRAINT "registration_reconfirmations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_reconfirmations_event_send_idx" ON "registration_reconfirmations" USING btree ("event_id","send_id");
