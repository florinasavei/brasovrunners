import { comparePerson, type PostedPerson } from "./family";
import { sameRunner } from "./name-key";

/**
 * A family registered in one sitting, with one email (§519; the owner, 2026-09-27: "niciun email
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
/**
 * The field the open screen's own press at the window's end posts as "1" (`PressWhenWindowEnds`): a
 * press by hand posts it empty. With the browser's half gone, the automatic press does nothing.
 */
export const AUTO_PRESS_FIELD = "autoPress";
/** The screen after «Gata»: `?submitted=1&sent=1`. */
export const SITTING_SENT_PARAM = "sent";

/**
 * The payload mark of a verification email a sitting held (§519): rendered, its link's life is counted
 * from that send (`extendHeldVerificationLink`), as the message states it. A marker, never a value.
 */
export const SITTING_HELD = "sittingHeld";

/** At most this many names are kept in the browser's half: the club's limit per address is at most ten. */
export const SITTING_NAMES_MAX = 10;

/**
 * How long this browser keeps the address for the next form when the club's window is 0 (§519):
 * nothing is held then, so the cookie's life is only the screen's offer of another person.
 */
export const SITTING_AT_ONCE_MINUTES = 30;

/**
 * How long the browser keeps its half past the window's end (§519, the review of 2026-09-27): the open
 * screen presses «Gata» at that instant, and a slow phone must still send the cookie with the press.
 * The screen and the form read the window's end (`heldUntil`), never this; the server's `held_until`
 * stays the truth of when the email leaves.
 */
export const SITTING_COOKIE_GRACE_MINUTES = 2;

/** The browser's half's life in seconds: to the window's end, plus the grace. */
export function sittingCookieMaxAgeSeconds(heldUntil: Date, now: Date): number {
  return Math.max(1, Math.ceil((heldUntil.getTime() - now.getTime()) / 1000) + SITTING_COOKIE_GRACE_MINUTES * 60);
}

/**
 * Until when this browser's half lives after a form or a «Da, încă o persoană» (§519): the club's
 * window from now — the instant the server's row is moved to as well — or, at 0, the at-once offer's.
 */
export function sittingCookieUntil(now: Date, windowMinutes: number): Date {
  return new Date(now.getTime() + (windowMinutes > 0 ? windowMinutes : SITTING_AT_ONCE_MINUTES) * 60_000);
}

/**
 * The whole minutes left until the email leaves by itself (§519, the review's nit: the screen says the
 * time left, not the club's whole window), rounded up so "1" is said until the last second; 0 once due.
 */
export function sittingMinutesLeft(releaseInMs: number): number {
  return releaseInMs <= 0 ? 0 : Math.ceil(releaseInMs / 60_000);
}

/**
 * The screen after the last form of a sitting says one sentence about its emails (§519, the review of
 * 2026-09-27), from the browser's own half: with the window held, «Un singur email, pentru toți: …»
 * (`family`); at a window of 0, where each person's email already left on its own, «Fiecare persoană
 * primește emailul ei.» (`familyEach`). One person, or no half: nothing.
 */
export function doneFamilySentence(facts: { names?: readonly string[]; atOnce?: boolean } | null): "family" | "familyEach" | null {
  if ((facts?.names?.length ?? 0) < 2) return null;
  return facts?.atOnce ? "familyEach" : "family";
}

/**
 * The order a family's people are named in (§519): the order the forms were sent, everywhere — the
 * family's confirmed email, «Declarațiile de pe această adresă» and the wizard. Registered earlier is
 * first; people registered at one instant — the one press that confirmed a family creates every kept
 * form's registration at the same `created_at` — go in the sitting's own order (`familyRank`, the
 * index in `family_sittings.registration_ids`, written in the kept forms' own sequence), then by id.
 */
export type FamilyOrdered = { id: string; createdAt: Date; familyRank?: number | null };

export function compareFamilyOrder(a: FamilyOrdered, b: FamilyOrdered): number {
  const rank = (row: FamilyOrdered) => row.familyRank ?? Number.MAX_SAFE_INTEGER;
  return a.createdAt.getTime() - b.createdAt.getTime() || rank(a) - rank(b) || a.id.localeCompare(b.id);
}

/** The rows with their place in the sitting's order (`compareFamilyOrder`); a row outside it has none. */
export function withFamilyRank<R extends { id: string }>(rows: readonly R[], order: readonly string[]): (R & { familyRank: number | null })[] {
  return rows.map((row) => {
    const index = order.indexOf(row.id);
    return { ...row, familyRank: index < 0 ? null : index };
  });
}

/**
 * A family confirmed in one press (§519): the declaration request waits for the wizard until
 * `releaseAt`, so the place must still be held when it leaves — a hold counts from the moment its
 * message can leave, never before. The hold is the one the allocator would give at `releaseAt`
 * (`computeHold`, the club's minutes capped by the close and the start, or the participation window's
 * deadline), never shorter than the one it gave now. When even that ends at or before `releaseAt` —
 * the close or the start comes first — the request is not held at all: it leaves now.
 */
export function familyHeldDeclaration(params: {
  holdExpiresAt: Date | null;
  releaseAt: Date;
  now: Date;
  computeHold: (at: Date) => Date;
}): { holdExpiresAt: Date | null; notBefore: Date } {
  const { holdExpiresAt, releaseAt, now } = params;
  if (holdExpiresAt === null) return { holdExpiresAt, notBefore: releaseAt };
  const atRelease = params.computeHold(releaseAt);
  const held = atRelease.getTime() > holdExpiresAt.getTime() ? atRelease : holdExpiresAt;
  if (held.getTime() <= releaseAt.getTime()) return { holdExpiresAt, notBefore: now };
  return { holdExpiresAt: held, notBefore: releaseAt };
}

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
  /**
   * When the email leaves by itself: the club's window from the last form or the last «Da, încă o
   * persoană». With `atOnce`, only how long this browser keeps the address for the next form.
   */
  heldUntil: Date;
  /**
   * The club's window is 0 (§519, «Termene»): nothing is held, every form's email left at once. The
   * screen still offers the next person, and says the email has already left.
   */
  atOnce?: boolean;
  /**
   * The club's window («Termene») as the action read it when it wrote this half (§519): the screen's
   * sentence names this one, never the public cache's, which may still hold the value before a save.
   * Absent on a cookie written before it was kept.
   */
  windowMinutes?: number;
  /**
   * The facts the next form of the sitting starts with (`sittingSharedValues`): the city, the
   * country, the citizenship, the guardian, the emergency contact and the emails' language, as posted. Absent on a
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
 * 2026-09-27: «claritate»; a parent does not retype the town, the country, the citizenship, the
 * guardian and the emergency contact for every child). The country beside the town since §NNN: the
 * country box became required, and a family's second form started it back at the default. Everything else — the name, the birth date, the sex, the
 * phone, the health note, the socials, every consent — belongs to the one person and starts empty.
 * The phone's country and digits are the posted pair `PhoneField` reads back.
 */
export const SITTING_SHARED_FIELDS = [
  "city",
  "country",
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
 * The kept form of this sitting a new form is about (§519), and what to do with it:
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
 * How long the family link lives (§519): until the last thing it can still act on lapses — the new
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
