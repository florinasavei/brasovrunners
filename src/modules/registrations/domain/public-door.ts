import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Înscrieri publice deschise» (§NNN; the owner, 2026-11-03: «cumva trebuie să pot controla mai bine»): the
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

/** Whether the public door is open by the switch: absent (a partial row, a fixture) is the column's default, on. */
export function publicDoorOpen(event: { publicRegistrationOpen?: boolean | null } | null | undefined): boolean {
  return event?.publicRegistrationOpen !== false;
}

/** The refusal: `VALIDATION_ERROR` like every refusal about the event, with its marker. */
export function publicRegistrationPausedError(): DomainError {
  return new DomainError("VALIDATION_ERROR", "PUBLIC_REGISTRATION_PAUSED: the organizers stopped registration from the site", [PUBLIC_REGISTRATION_PAUSED]);
}
