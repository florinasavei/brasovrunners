import { comparePerson, type PostedPerson } from "./family";
import { sameRunner } from "./name-key";

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
  /** Everybody the sitting's forms were sent for, as typed, the latest last (`withSittingPerson`). */
  people: SittingPerson[];
  /** When the email leaves by itself: the club's window from the last form. */
  heldUntil: Date;
  /**
   * The facts the next form of the sitting starts with (`sittingSharedValues`): the city, the
   * citizenship, the guardian, the emergency contact and the emails' language, as posted. Absent on a
   * cookie written before they were kept.
   */
  shared?: Readonly<Record<string, string>>;
  /** The last form named another person on the birth date of one typed before it (`withSittingPerson`). */
  sameBirthDate?: { typed: string; kept: string } | null;
};

/** One person of the sitting, as this browser typed them: the name, and the birth date ("YYYY-MM-DD", or ""). */
export type SittingPerson = { name: string; birthDate: string };

/** The names, in the order the screen lists them. */
export function sittingNames(people: readonly SittingPerson[]): string[] {
  return people.map((person) => person.name);
}

/**
 * The boxes a family shares, which the next form of a sitting starts filled with (the owner,
 * 2026-09-27: «claritate»; a parent does not retype the town, the citizenship, the guardian and the
 * emergency contact for every child). Everything else — the name, the birth date, the sex, the
 * phone, the health note, the socials, every consent — belongs to the one person and starts empty.
 * The phone's country and digits are the posted pair `PhoneField` reads back.
 */
export const SITTING_SHARED_FIELDS = [
  "city",
  "nationality",
  "guardianName",
  "emergencyContactName",
  "emergencyContactPhoneCountry",
  "emergencyContactPhone",
  "preferredLocale",
] as const;

/**
 * The shared boxes after one more form: what this form posted, and — for a box it left blank (an
 * adult's form has no guardian) — what an earlier form of the sitting posted. Never a value read
 * from the registrations table: only what this browser typed (§39).
 */
export function sittingSharedValues(
  prior: Readonly<Record<string, string>> | undefined,
  posted: (name: string) => string,
): Record<string, string> {
  const shared: Record<string, string> = {};
  for (const name of SITTING_SHARED_FIELDS) {
    const value = posted(name).trim();
    const kept = prior?.[name]?.trim() ?? "";
    if (value !== "") shared[name] = value;
    else if (kept !== "") shared[name] = kept;
  }
  return shared;
}

/** Whether the cookie still stands for a sitting of this event: the email has not left by itself yet. */
export function sittingCookieLive(cookie: FamilySittingCookie | null, eventId: string, now: Date): cookie is FamilySittingCookie {
  return cookie !== null && cookie.eventId === eventId && cookie.heldUntil.getTime() > now.getTime() && cookie.email !== "";
}

/**
 * The people after one more form, by the rule the server keeps for the sitting's own people
 * (`sittingEntryFor`, `decideSubmission`) — so the list on the screen is the list the email and its
 * page will name:
 *
 * - the **same name** (`sameRunner`) as somebody typed before: that person again, with the date as
 *   now typed — a corrected birth date replaces, never adds; the new spelling moves to the end;
 * - **another name on a birth date** typed before (§493: twins, or a corrected name): nobody is added
 *   and nobody is replaced — the form is not kept, and `sameBirthDate` names the two for the screen's
 *   sentence;
 * - anybody else: added, last.
 *
 * Decided from this browser's own forms alone, never from what the address holds, so the screen reads
 * the same whether the earlier form registered somebody, was kept, or re-sent a registration the
 * address had already (§39, AGENTS.md §19.4).
 */
export function withSittingPerson(
  people: readonly SittingPerson[],
  typed: { name: string; birthDate: string | null | undefined },
): { people: SittingPerson[]; sameBirthDate: { typed: string; kept: string } | null } {
  const name = typed.name.replace(/\s+/g, " ").trim();
  const birthDate = (typed.birthDate ?? "").slice(0, 10);
  if (name === "") return { people: [...people], sameBirthDate: null };
  const sameName = people.find((person) => sameRunner(person.name, name));
  if (sameName) {
    return { people: [...people.filter((person) => person !== sameName), { name, birthDate }].slice(-SITTING_NAMES_MAX), sameBirthDate: null };
  }
  const sameDay = birthDate !== "" ? people.find((person) => person.birthDate === birthDate) : undefined;
  if (sameDay) return { people: [...people], sameBirthDate: { typed: name, kept: sameDay.name } };
  return { people: [...people, { name, birthDate }].slice(-SITTING_NAMES_MAX), sameBirthDate: null };
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
 * The kept form of this sitting a new form is about (§NNN), and what to do with it:
 *
 * - `replace` — the **same name** (`sameRunner`), whatever the date: the same person again, or a
 *   corrected birth date. The new form replaces the kept one, so a parent who corrects a date is not
 *   registering one more child.
 * - `sameBirthDate` — **another name on a kept form's birth date** (§493): twins, whom the owner's
 *   rule reads as a slip, or a corrected name. Neither replaced nor added: overwriting would lose the
 *   first person without a word. The screen says what to do (`withSittingPerson` keeps the same rule).
 *
 * Null for a different person (both differ, `comparePerson`).
 */
export type SittingEntryMatch<E> = { kind: "replace"; entry: E } | { kind: "sameBirthDate"; entry: E } | null;

export function sittingEntryFor<E extends { registeredName: string; birthDate: string | null }>(
  entries: readonly E[],
  posted: PostedPerson,
): SittingEntryMatch<E> {
  const byName = entries.find((entry) => sameRunner(entry.registeredName, posted.legalName));
  if (byName) return { kind: "replace", entry: byName };
  const byDate = entries.find((entry) => comparePerson(entry, posted) === "partial");
  return byDate ? { kind: "sameBirthDate", entry: byDate } : null;
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
