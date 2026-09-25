-- contract: registrations_event_participant_unique held one registration per address per event
-- until migration 0072 added registrations_event_participant_name_unique beside it (AGENTS.md
-- §7.6). This ships in the release right after the one that carried 0072, once no deployed code
-- still reads "one row per address" (registrations/family-gate.ts) — dropping it is what opens
-- the family flow, with no deploy of its own.
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_event_participant_unique";
