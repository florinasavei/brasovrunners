CREATE TABLE "family_place_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"sitting_key" uuid NOT NULL,
	"slot" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"holds_place" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_sittings" ADD COLUMN "reserved_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "family_place_holds" ADD CONSTRAINT "family_place_holds_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "family_place_holds_key_slot_unique" ON "family_place_holds" USING btree ("sitting_key","slot");--> statement-breakpoint
CREATE INDEX "family_place_holds_event_expires_idx" ON "family_place_holds" USING btree ("event_id","expires_at");