-- «La confirmare primește un BIB gol» on an invitation (§NNN; the owner, 2026-11-19: «când invit pe cineva, trebuie să pot
-- să-i dau unul dintre locurile de rezervă» — «Ambele»): the registration the invitation becomes wears, once confirmed, the
-- lowest of the desk's spares (§444) free at that moment, under the event row's lock (`service.ts#bibAtConfirmation`).
-- Expand only: one boolean, false by default, so every invitation already sent keeps the allocator's number.
ALTER TABLE "event_invitations" ADD COLUMN "blank_bib" boolean DEFAULT false NOT NULL;
