-- «Planul voluntarilor»: one nullable `checkpoint_id` on event_volunteers — the point of the event's route a volunteer stands at,
-- none meaning not placed. Expand only: the column, its foreign key (a point deleted frees its people) and the index that key reads.
-- Nothing is backfilled; no row reads differently until the organizers place somebody.
ALTER TABLE "event_volunteers" ADD COLUMN "checkpoint_id" uuid;--> statement-breakpoint
ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_checkpoint_id_event_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."event_checkpoints"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_volunteers_checkpoint_idx" ON "event_volunteers" USING btree ("checkpoint_id") WHERE "event_volunteers"."checkpoint_id" IS NOT NULL;