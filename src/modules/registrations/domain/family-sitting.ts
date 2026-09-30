import { comparePerson, type PostedPerson, sexesDiffer } from "./family";
import { sameRunner } from "./name-key";
import { isSexChoice, type SexChoice } from "./sex";

/**
 * A family registered in one sitting, with one email (§519; the owner, 2026-09-27: "niciun email
 * instant: unul singur, după ce apeși «Gata» sau după fereastra din Termene"; «asta cu wizzardul de
 * confirmare si claritate e top prio!»).
 *
 * The first form is an ordinary form (§536, amending §519; the owner, 2026-09-28: «sa inteleg ca nu
 * primesc mailu daca nu apas pe „Nu, gata, trimite mailul”?»): its email leaves on the club's
 * ordinary timing, and the screen that says to open the inbox says when it leaves, then asks one
 * question — «Mai înscrii pe cineva cu aceeași adresă?» — with one answer, «Da, încă o persoană».
 * Leaving the page is the no. That press opens the sitting: it holds the first form's email when it
 * has not left yet, and opens the form again with the address fixed.
 *
 * From «Da» on, §519 as it was: every message the sitting's forms queue waits
 * (`email_outbox.next_attempt_at`) until «Gata» or the club's window («Termene», from the last form
 * or press), and from the second person on, those messages are one — «Înscriere de familie: 3
 * persoane la …» — with one button that confirms the address and everybody at once and opens the
 * declarations as the wizard of §471. The screen after each of those forms is the sitting's own: the
 * people so far, «Gata — trimite-mi emailul» and the minutes left.
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
 * The refusal a sitting's next form meets when this browser's own people already fill the club's
 * limit per address (§543, amending §519): said at the form, because every person it counts was
 * typed on this browser (§39). A marker, never a value (§14.5).
 */
export const SITTING_AT_CAP = "sittingAtCap";

/**
 * The payload mark of a verification email a sitting held (§519): rendered, its link's life is
 * counted from that send (`extendHeldVerificationLink`), as the message states it. A marker, never a
 * value. Written only when the message is held — by a form after «Da», or by «Da» itself taking the
 * first form's still-waiting email in (§536, `continueFamilySitting`); a first form alone never
 * carries it (the review of 2026-09-28, nit F1).
 */
export const SITTING_HELD = "sittingHeld";

/**
 * The payload mark of a message a family holds that is not a verification email (§519, §529): the
 * queue panel (`notifications/queue.ts`) reads it, with `SITTING_HELD`, to count the row as the
 * family's hold and not as a retry. On a declaration request the renderer also reads it
 * (`render.ts`); on a kept form's `REGISTER_ANOTHER_PERSON`, which «Da» takes in (§536,
 * `continueFamilySitting`), nothing else does.
 */
export const FAMILY_HELD = "familyHeld";

/**
 * What the first form left for «Da» to open a sitting with (§536): the registration it created or
 * restarted, or the kept form of §446, and the message it queued for it. Written by the action into
 * the browser's sealed half, never read from the registrations table by the screen (§39).
 */
export type SittingSeed = { kind: "registration" | "entry"; id: string; outboxId: string | null };

/**
 * Which screen follows a form (§536): before any «Da», the inbox's screen with the one question
 * (`offer`); after a «Da» — from the second form on, or pressed and come back — §519's sitting screen
 * (`sitting`), with the people so far, «Gata» and the minutes left. No live half: the inbox's screen
 * alone.
 */
export function afterFormScreen(cookie: FamilySittingCookie | null): "offer" | "sitting" | null {
  if (!cookie) return null;
  return cookie.joined ? "sitting" : "offer";
}

/**
 * The one sentence under «Da, încă o persoană» on the screen after the first form (§536; the review
 * of 2026-09-28, nit F0: the sentence must be true of the email that screen names), chosen from what
 * the screen already knows — the club's window and when the first email leaves:
 *
 * - `addHintAtOnce` — a window of 0: nothing is held, «Fiecare persoană primește emailul ei.»;
 * - `addHint` — the email still waits for the scheduled pass (`leavesAt` still ahead of `now`): «Da»
 *   pressed before that pass holds it, and the address gets one email for everybody;
 * - `addHintLeft` — it leaves now (`immediate`, no instant), or the pass it was waiting for has come
 *   (the review of 2026-09-28: a reload after it must not promise to hold an email already sent): it
 *   cannot be held, so the next person's email is the one that names everybody.
 *
 * `leavesAt` is the instant the action stored when the form was sent (`FamilySittingCookie.emailLeavesAt`),
 * never one recomputed at render: a reload after the pass would name the pass after it.
 */
export function offerHint(input: { atOnce: boolean; leavesAt: Date | null; now: Date }): "addHintAtOnce" | "addHint" | "addHintLeft" {
  if (input.atOnce) return "addHintAtOnce";
  return emailHasLeft(input.leavesAt, input.now) ? "addHintLeft" : "addHint";
}

/**
 * Whether the first form's email has left by now (§536): at once under `immediate` (no instant), else
 * once its scheduled pass has come. The short screen then says «a plecat» and promises no hold.
 */
export function emailHasLeft(leavesAt: Date | null, now: Date): boolean {
  return leavesAt === null || now.getTime() >= leavesAt.getTime();
}

/**
 * The first form's leaving instant as the browser's half keeps it (§536): one letter and an ISO
 * instant, always 25 characters — `s` and the scheduled pass, or `i` and the submit instant when the
 * request itself sent it (`immediate`; §540, the family re-review of 2026-09-28: the epoch it sealed
 * before let a reload an hour later still say «pleacă acum»). A club setting, never the address's:
 * the sealed length says nothing about what the address holds (§39).
 */
export function sealEmailLeavesAt(leavesAt: Date | null, submittedAt?: Date): string {
  return leavesAt === null ? `i${(submittedAt ?? new Date(0)).toISOString()}` : `s${leavesAt.toISOString()}`;
}

/** The instant back (`sealEmailLeavesAt`): null for `immediate`, undefined when absent or malformed (an older half). */
export function openEmailLeavesAt(text: string | undefined): Date | null | undefined {
  if (!text || text.length !== 25) return undefined;
  if (text[0] === "i") return null;
  if (text[0] !== "s") return undefined;
  const at = new Date(text.slice(1));
  return Number.isFinite(at.getTime()) ? at : undefined;
}

/**
 * Under `immediate`, the instant the form was sent (`sealEmailLeavesAt`'s `i`): undefined for a
 * scheduled pass, and for a half sealed before it was kept (the epoch), which keeps the old «pleacă acum».
 */
export function openEmailSubmittedAt(text: string | undefined): Date | undefined {
  if (!text || text.length !== 25 || text[0] !== "i") return undefined;
  const at = new Date(text.slice(1));
  return Number.isFinite(at.getTime()) && at.getTime() > 0 ? at : undefined;
}

/**
 * How long after the submit an email the request itself sends is taken to have left: the drain after
 * the response sends it within seconds (§68), so the redirect from the submit says «pleacă acum» and a
 * reload a minute later says it left.
 */
export const IMMEDIATE_EMAIL_LEFT_AFTER_MS = 60_000;

/**
 * Whether the first form's email has left by now, on the short screen (§540): a scheduled pass once it
 * has come (`emailHasLeft`); under `immediate`, a minute after the submit — never on the redirect from
 * it, and always on a reload an hour later. Without the submit instant (an older half), not yet.
 */
export function shortScreenEmailLeft(input: { leavesAt: Date | null; submittedAt?: Date; now: Date }): boolean {
  if (input.leavesAt !== null) return emailHasLeft(input.leavesAt, input.now);
  return input.submittedAt !== undefined && input.now.getTime() - input.submittedAt.getTime() >= IMMEDIATE_EMAIL_LEFT_AFTER_MS;
}

/**
 * The people this browser lists after «Da, încă o persoană» (§536; the review of 2026-09-28, nit F2 of
 * round two). The first «Da» that found nothing left to open from its seed — the first person
 * confirmed their address from the email that left before the press, or their kept form lapsed — did
 * not bring that person into the sitting: their email is not the sitting's. The names on the next
 * form and on the last screen then start without them, so they name only the people the sitting's
 * email covers (`seedSpent`). Only a seed this browser's own first form left: a form that left none
 * (a re-send, the address at its limit) keeps its name as it always did (§39: what the address held
 * before this browser is never read back). At a window of 0 (`holding` false) nothing is held for
 * anybody, and the list stays whole.
 */
export function peopleAfterYes(input: {
  holding: boolean;
  seed: SittingSeed | null;
  opened: string | null;
  people: readonly SittingPerson[];
}): { people: SittingPerson[]; seedSpent: boolean } {
  const seedSpent = input.holding && input.seed !== null && input.opened === null;
  return { people: seedSpent ? [] : [...input.people], seedSpent };
}

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
  /** The server's row, or null while there is none — before «Da» (§536), or a sitting that held nothing. */
  sittingId: string | null;
  /**
   * What the first form left for «Da» to open the sitting with (§536); null once «Da» was pressed,
   * and for a form that left nothing to hold (a re-send, the address at the club's limit).
   */
  seed: SittingSeed | null;
  /**
   * «Da, încă o persoană» was pressed on this browser (§536): the forms after it are the sitting's,
   * and the screen after each of them is §519's sitting screen (`afterFormScreen`).
   */
  joined?: boolean;
  eventId: string;
  email: string;
  /** Everybody the sitting's forms were sent for, as typed, the latest last (`withSittingPerson`). */
  people: SittingPerson[];
  /**
   * When the email leaves by itself: the club's window from the last form or the last «Da, încă o
   * persoană». Before «Da», how long the next form is offered with this address. With `atOnce`, only
   * how long this browser keeps the address for the next form.
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
   * When the first form's email leaves (§536; the review of 2026-09-28), computed once by the action
   * when the form was sent: the scheduled pass, or null when the request itself sent it. The short
   * screen reads this, never a time recomputed at render, so a reload after the pass says the email
   * has left instead of naming the next one. Absent on a half written before it was kept.
   */
  emailLeavesAt?: Date | null;
  /**
   * Under `immediate` (`emailLeavesAt` null), when the form was sent (§540): the short screen then says
   * the email left on a reload, not «pleacă acum» forever. Sealed in the same 25 characters.
   */
  emailSubmittedAt?: Date;
  /**
   * The facts the next form of the sitting starts with (`sittingSharedValues`): the city, the
   * country, the citizenship, the guardian, the emergency contact and the emails' language, as posted. Absent on a
   * cookie written before they were kept.
   */
  shared?: Readonly<Record<string, string>>;
  /** The last form named another person on the birth date of one typed before it (`withSittingPerson`). */
  sameBirthDate?: { typed: string; kept: string } | null;
  /**
   * Until when the sitting's places are reserved (§543): the sitting's fixed deadline — the first
   * form's instant, the club's window and hold, capped by the event — as the server wrote it at the
   * opening «Da», or at the form that opened a new sitting after it. Facts about this browser's forms,
   * the club's settings and the event, never the address's (§39). Absent before «Da» and on a half
   * written before it was kept. The screen reads it against the clock: past it, no place is reserved.
   */
  reservedUntil?: Date | null;
};

/**
 * The family marker's facts on the screen after a sitting's form (§543; the owner, 2026-09-28:
 * «trebuie un marker pentru familie... nu e clar cum rezervăm»): the first names this browser typed,
 * how many have a reserved place and how many will wait for one — all from the browser's own half.
 */
export function sittingReservationFacts(people: readonly SittingPerson[]): { firstNames: string[]; reserved: number; waiting: number } {
  return {
    firstNames: people.map((person) => person.name.trim().split(/\s+/)[0] || person.name),
    reserved: people.filter((person) => !person.waitlist).length,
    waiting: people.filter((person) => person.waitlist === true).length,
  };
}

/**
 * The person with the place their form got (§543): `reserved` or `waitlist`. Every form of a sitting
 * for a new person gets one of the two, whatever the address holds (the review of 2026-09-28, round
 * three; §39): a form that wrote no registration takes a counted hold (`family_place_holds`) as a
 * fresh address's form takes a reserved registration, and reads the same.
 */
export function withPlace(person: SittingPerson, place: "reserved" | "waitlist"): SittingPerson {
  const rest = { name: person.name, birthDate: person.birthDate };
  return place === "waitlist" ? { ...rest, waitlist: true } : rest;
}

/** The last person of the list with the place their form got (§543), the others as they were; `undefined` changes nobody. */
export function withLatestPlace(people: readonly SittingPerson[], place: "reserved" | "waitlist" | undefined): SittingPerson[] {
  if (place === undefined || people.length === 0) return [...people];
  return [...people.slice(0, -1), withPlace(people.at(-1)!, place)];
}

/**
 * Whether the form just typed is a new person of the sitting (§543): its name joins the list, rather
 * than correcting a name typed before or being set aside as another name on a typed birth date
 * (`withSittingPerson`). Only a new person takes a place; a correction keeps the one it had.
 */
export function isNewSittingPerson(before: readonly SittingPerson[], after: { people: readonly SittingPerson[]; sameBirthDate: unknown }): boolean {
  if (after.sameBirthDate) return false;
  const last = after.people.at(-1);
  return last !== undefined && !before.some((person) => sameRunner(person.name, last.name));
}

/**
 * One person of the sitting, as this browser typed them: the name, and the birth date ("YYYY-MM-DD",
 * or ""). `waitlist` (§543): no place was free when their form was sent, so they join the waiting
 * list when the address is confirmed — a fact about the event, never about the address (§39).
 */
export type SittingPerson = {
  name: string;
  birthDate: string;
  waitlist?: boolean;
  /** «Feminin» or «Masculin» as typed (§NNN): on a shared birth date, the other sex is another person. Absent from a cookie written before it. */
  sex?: SexChoice;
};

/** The names, in the order the screen lists them. */
export function sittingNames(people: readonly SittingPerson[]): string[] {
  return people.map((person) => person.name);
}

/**
 * The boxes a family shares, which the next form of a sitting starts filled with (the owner,
 * 2026-09-27: «claritate»; a parent does not retype the town, the country, the citizenship, the
 * guardian and the emergency contact for every child). The country beside the town since §520: the
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
 *   sentence — unless the sex typed is the other one (§NNN, `sexesDiffer`): another name and the other
 *   sex are another person, as the server reads them (`comparePerson`);
 * - anybody else: added, last.
 *
 * Decided from this browser's own forms alone, never from what the address holds, so the screen reads
 * the same whether the earlier form registered somebody, was kept, or re-sent a registration the
 * address had already (§39, AGENTS.md §19.4).
 */
export function withSittingPerson(
  people: readonly SittingPerson[],
  typed: { name: string; birthDate: string | null | undefined; sex?: string | null },
): { people: SittingPerson[]; sameBirthDate: { typed: string; kept: string } | null } {
  const name = typed.name.replace(/\s+/g, " ").trim();
  const birthDate = (typed.birthDate ?? "").slice(0, 10);
  // Only an answer the form offers is kept (`isSexChoice`): anything else says nothing about who this is.
  const sexKept = isSexChoice(typed.sex) ? { sex: typed.sex } : {};
  if (name === "") return { people: [...people], sameBirthDate: null };
  const sameName = people.find((person) => sameRunner(person.name, name));
  if (sameName) {
    // A correction keeps the place the person had (§543): only a new person takes one.
    const place = sameName.waitlist ? { waitlist: true } : {};
    return { people: [...people.filter((person) => person !== sameName), { name, birthDate, ...sexKept, ...place }].slice(-SITTING_NAMES_MAX), sameBirthDate: null };
  }
  const sameDay = birthDate !== "" ? people.find((person) => person.birthDate === birthDate && !sexesDiffer(person.sex, sexKept.sex)) : undefined;
  if (sameDay) return { people: [...people], sameBirthDate: { typed: name, kept: sameDay.name } };
  return { people: [...people, { name, birthDate, ...sexKept }].slice(-SITTING_NAMES_MAX), sameBirthDate: null };
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
 *   Not when the sex posted is the other one (§NNN): that is another person, as `comparePerson` reads it.
 *
 * Null for a different person (both differ, `comparePerson`).
 */
export type SittingEntryMatch<E> = { kind: "replace"; entry: E } | { kind: "sameBirthDate"; entry: E } | null;

export function sittingEntryFor<E extends { registeredName: string; birthDate: string | null; sex?: PostedPerson["sex"] }>(
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
