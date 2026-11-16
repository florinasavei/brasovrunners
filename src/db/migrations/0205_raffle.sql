-- «Avem tombolă» and «Participă la tombolă»: one boolean on events — the club draws a raffle at this event, off by default — and one on
-- registrations and on event_volunteers — the person is on the raffle's list, on by default, so everybody from before is in.
-- Expand only: three columns, each NOT NULL with its default; no row reads differently until an organizer unticks somebody.
ALTER TABLE "event_volunteers" ADD COLUMN "in_raffle" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "has_raffle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "in_raffle" boolean DEFAULT true NOT NULL;