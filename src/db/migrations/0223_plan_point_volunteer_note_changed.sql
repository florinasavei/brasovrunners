-- When «Notă pentru voluntari» of a point of the volunteers' plan last changed: one nullable column on event_checkpoints, written
-- by the plan's own save when the note's words change. «Trimite fiecăruia punctul lui» tells again whoever was told the point
-- before it. Never public.
-- Adds a column only. Nothing is backfilled: a note written before this release has no moment, and nobody is told again for it.
ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_changed_at" timestamp with time zone;