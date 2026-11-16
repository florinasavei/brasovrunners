import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Înscrieri publice deschise» (§906; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»): the
 * public form's own door, beside its dates. Off, the public form — and its emailed link for another person on
 * the same address (§389) — is refused on the server whatever the dates say, before anything is spent and
 * again under the event's lock; every staff verb keeps working, an invitation's form included (its door is
 * the invitation, §647). A registration already sent goes on as it would have: its address confirmation is
 * not a new entry.
 *
 * The marker the refusal carries, read by the form's page like the waiting list's (§348): not a field, a
 * rule about the event.
 */
export const PUBLIC_REGISTRATION_PAUSED = "publicRegistrationPaused";

/** The longest «Mesaj cât înscrierile pe site sunt oprite» (§NNN): one sentence for a card, as the discount note's. */
export const MAX_PAUSED_NOTE = 200;

/**
 * The club's own sentence for an event whose door the switch shut (§NNN; the owner, of the card's «Înscrierile pe
 * site sunt oprite de organizatori.»: «vreau să scrie mai frumos sau să pot customiza mesajul»), in the reader's
 * language: the row's `paused_note` when it says something, null otherwise — the surface then says the platform's
 * sentence. Never the other language's words (§28): the row read is the reader's own translation.
 */
export function pausedNoteOf(event: { pausedNote?: string | null } | null | undefined): string | null {
  const own = event?.pausedNote?.trim();
  return own ? own : null;
}

/** Whether the public door is open by the switch: absent (a partial row, a fixture) is the column's default, on. */
export function publicDoorOpen(event: { publicRegistrationOpen?: boolean | null } | null | undefined): boolean {
  return event?.publicRegistrationOpen !== false;
}

/** The refusal: `VALIDATION_ERROR` like every refusal about the event, with its marker. */
export function publicRegistrationPausedError(): DomainError {
  return new DomainError("VALIDATION_ERROR", "PUBLIC_REGISTRATION_PAUSED: the organizers stopped registration from the site", [PUBLIC_REGISTRATION_PAUSED]);
}
