import { comparePerson, type PostedPerson } from "./family";

/**
 * A family registered in one sitting, with one email (§NNN; the owner, 2026-09-27: "niciun email
 * instant: unul singur, după ce apeși «Gata» sau după fereastra din Termene"; «asta cu wizzardul de
 * confirmare si claritate e top prio!»).
 *
 * The public form, sent, now asks one question before anything is mailed: «Mai înscrii pe cineva cu
 * aceeași adresă?». «Încă o persoană» opens the form again with the address fixed; «Gata» sends the
 * email. Nothing is mailed in between: every message the sitting's forms would have queued waits
 * (`email_outbox.next_attempt_at`) until «Gata» or the club's window («Termene», from the last form),
 * and from the second person on, those messages are one — «Înscriere de familie: 3 persoane la …» —
 * with one button that confirms the address and everybody at once and opens the declarations as the
 * wizard of §471.
 *
 * Pure: what the browser's half of the sitting holds, and the decisions about it. The database's
 * half is `registrations/family-sitting.ts`; the rows are `family_sittings`.
 */

/** The hidden field the next form of a sitting carries: its address is the sitting's, not a box on it. */
export const FAMILY_SITTING_FIELD = "familySitting";
/** The address of the next form of a sitting: `?family=1`. A marker, never a value (§14.5). */
export const FAMILY_SITTING_PARAM = "family";
/** The screen after «Gata»: `?submitted=1&sent=1`. */
export const SITTING_SENT_PARAM = "sent";

/** At most this many names are kept in the browser's half: the club's limit per address is at most ten. */
export const SITTING_NAMES_MAX = 10;

/**
 * The browser's half (a sealed cookie on the form's own path): which sitting, for which event, the
 * address typed in its first form — the one the next forms are sent with — and the names typed so
 * far, which the screen after the form lists back. Everything in it came from this browser's own
 * forms, so showing it back tells nobody anything about an address (§39, AGENTS.md §19.4).
 */
export type FamilySittingCookie = {
  /** The server's row, or null while the sitting has held nothing (a re-send about a registration outside it). */
  sittingId: string | null;
  eventId: string;
  email: string;
  names: string[];
  /** When the email leaves by itself: the club's window from the last form. */
  heldUntil: Date;
};

/** Whether the cookie still stands for a sitting of this event: the email has not left by itself yet. */
export function sittingCookieLive(cookie: FamilySittingCookie | null, eventId: string, now: Date): cookie is FamilySittingCookie {
  return cookie !== null && cookie.eventId === eventId && cookie.heldUntil.getTime() > now.getTime() && cookie.email !== "";
}

/** The names after one more form: the new one last, the same name typed again not twice. */
export function withSittingName(names: readonly string[], name: string): string[] {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (trimmed === "") return [...names];
  const folded = trimmed.toLocaleLowerCase("ro-RO");
  const kept = names.filter((existing) => existing.toLocaleLowerCase("ro-RO") !== folded);
  return [...kept, trimmed].slice(-SITTING_NAMES_MAX);
}

/**
 * Whether the sitting's messages become the one family message: two people or more waiting for the
 * address's confirmation — its new registrations and its kept forms. One person keeps the message
 * that person always had (the verification link, or the confirmation of another person, §446).
 */
export function isFamilySitting(people: number): boolean {
  return people >= 2;
}

/**
 * The kept form of this sitting a new form is about (§NNN): the same person, or a slip on one of
 * the two (§446's rule, `comparePerson`) — then the new form replaces it, so a parent who corrects a
 * date by sending the form again is not registering one more child. Null for a different person.
 */
export function sittingEntryFor<E extends { registeredName: string; birthDate: string | null }>(
  entries: readonly E[],
  posted: PostedPerson,
): E | null {
  return entries.find((entry) => comparePerson(entry, posted) !== "different") ?? null;
}

/**
 * How long the family link lives (§NNN): until the last thing it can still act on lapses — the new
 * registrations' email links and the kept forms, each written with the club's email-link window
 * («Termene», §377) when its form was sent. Null when nothing is ahead of `now`.
 */
export function sittingLinkExpiresAt(lapses: readonly (Date | null | undefined)[], now: Date): Date | null {
  let latest: number | null = null;
  for (const lapse of lapses) {
    const at = lapse?.getTime();
    if (at === undefined || at <= now.getTime()) continue;
    latest = latest === null ? at : Math.max(latest, at);
  }
  return latest === null ? null : new Date(latest);
}
