-- contract: event_invitations_live_address_unique held one open invitation per address per event
-- (§647). Nothing deployed relies on it: every release since §647 refuses a second open invitation
-- per address in code, under the event lock, before the insert (registrations/service.ts,
-- inviteToEventByStaff), so the release still serving while this runs never writes two. Dropping
-- it is what lets one inbox hold an invitation per person of a family (§NNN).
DROP INDEX "event_invitations_live_address_unique";
