import type { RegistrationSex, RegistrationStatus } from "@/db/schema/registrations";
import { type AddressCap, addressHasRoom } from "./address-cap";
import { sameRunner } from "./name-key";
import { isSexChoice } from "./sex";
import { isActiveStatus } from "./state-machine";

/**
 * What one submission does on an address that may carry a family (§389, §446) — the decision, apart
 * from the writing of it, so every branch is a unit test and the service reads as the rule.
 *
 * Three doors reach it:
 * - **the public form** (`form`): anybody may type any address into it, so it must never reveal
 *   whether the address is registered (§39's oracle rule, AGENTS.md §19.4). Whatever it decides, the
 *   screen is the same "check your inbox"; only the inbox learns which case it was;
 * - **the confirmation pressed from the email** (`link`): whoever holds it has read that inbox, so
 *   here — and only here — a refusal may say "this person is already registered on this address"
 *   or "the address is at the club's limit";
 * - **a staff entry** (`staff`): somebody at the desk typing a name, so another name on a registered
 *   address is another person, within the club's limit (§493) — and a refusal is said out loud, as
 *   behind the link, since the staff member can already read the whole list.
 *
 * Decided under the event's lock (`submitRegistration`), from every registration the address holds
 * at the event, so two submissions of one family cannot both find the address empty.
 */

/**
 * The two refusals the confirmation behind the emailed link can give (§389), as the markers the
 * page reads from `?fields=` and turns into sentences: this person is registered on the address
 * already, and the address is at the club's limit. Only ever sent to a page behind the token — the
 * public form never answers either (§39).
 */
export const ALREADY_ON_ADDRESS = "alreadyOnAddress";
export const ADDRESS_AT_CAP = "addressAtCap";
/** The link itself can no longer be used — spent, lapsed, or for another event — or the flow is not open yet. */
export const ANOTHER_LINK_INVALID = "anotherLink";
/**
 * The query parameter of the link §389 emailed before §446: the event's registration form opened
 * for another person on the same address. Retired — the email now carries one confirmation
 * (`/registrations/family/[token]`) — and read only so a link from an older email says that it no
 * longer works and what to do instead, never to open the old form.
 */
export const ANOTHER_PERSON_PARAM = "another";

export type FamilyRow = { id: string; status: RegistrationStatus; registeredName: string; birthDate: string | null; sex?: RegistrationSex | null };

/** The person a submission names: the legal name (`composeLegalName`), the birth date and the sex, as posted. */
export type PostedPerson = { legalName: string; birthDate?: string | null; sex?: RegistrationSex | null };

/** A birth date as the calendar day it is, `YYYY-MM-DD`, or null when there is none to compare. */
function dayOf(birthDate: string | null | undefined): string | null {
  const day = birthDate ? birthDate.slice(0, 10) : "";
  return day === "" ? null : day;
}

/**
 * Two answers to «Sex» that say two different people (§576): both given — «Feminin» or «Masculin»
 * (`isSexChoice`) — and not the same. A row stored without one (a staff entry, the retired
 * `UNSPECIFIED`) or a form without one says nothing either way.
 */
export function sexesDiffer(a: RegistrationSex | null | undefined, b: RegistrationSex | null | undefined): boolean {
  return isSexChoice(a) && isSexChoice(b) && a !== b;
}

/**
 * How the posted person compares with one registration on the address (§446; the owner,
 * 2026-09-26: "trebuie să verific că numele e diferit (ignorând whitespace) și data nașterii e
 * complet diferită — asta înseamnă că a înscris altă persoană intenționat").
 *
 * - the **name** by the runner's key (`sameRunner`, `foldName`): case, runs of whitespace,
 *   diacritics and an apostrophe's shape are forgiven, every letter and word is not;
 * - the **birth date** as the calendar day it is (`YYYY-MM-DD`). A registration without one — a
 *   staff entry may have none — differs from every posted date; a submission without one differs
 *   from nobody's, because nothing then says it is somebody else.
 *
 * `same`: both agree — the same person again. `different`: both differ — somebody else, on purpose.
 * `partial`: one agrees and the other does not — a slip, never a second registration.
 *
 * **The sex, beside the birth date (§576, amending §446 and §493; the owner, 2026-09-30: «asta cu
 * înscrierea cu același mail trebe să devină top prio!»).** Another name on a registered person's
 * birth date was always a slip — the owner's rule read literally, which §446 kept for twins. But a
 * slip changes one box: a mistyped name, or a birth date the browser filled in by itself
 * (`autocomplete="bday"` fills the owner of the device's own). Another name **and** the other sex
 * is two boxes changed on purpose, so it is another person — a brother and a sister born on the
 * same day included. The same sex, or a sex one side does not have, leaves the day to decide, as
 * before: same-sex twins still hear how they are registered (§493).
 */
export type PersonMatch = "same" | "partial" | "different";

export function comparePerson(row: Pick<FamilyRow, "registeredName" | "birthDate" | "sex">, posted: PostedPerson): PersonMatch {
  const nameDiffers = !sameRunner(row.registeredName, posted.legalName);
  const posting = dayOf(posted.birthDate);
  const dateDiffers = posting !== null && dayOf(row.birthDate) !== posting;
  /*
    The sex weighs only beside a posted birth date (§576, the review's nit): it is the second box
    changed on a shared day. With no date posted there is no day to share, and the sex alone never
    makes another person — the form is a slip, as before.
  */
  const sexDecides = posting !== null && sexesDiffer(row.sex, posted.sex);
  if (nameDiffers && (dateDiffers || sexDecides)) return "different";
  if (!nameDiffers && !dateDiffers) return "same";
  return "partial";
}

/**
 * Whether the posted birth date is this registration's own day: a real day on both sides, and the
 * same one. What the twins' sentence (§493) needs to be true before the email says it — a form
 * with no date to compare is never "born on the same day" as anybody.
 */
export function sameBirthDay(row: Pick<FamilyRow, "birthDate">, posted: PostedPerson): boolean {
  const posting = dayOf(posted.birthDate);
  return posting !== null && dayOf(row.birthDate) === posting;
}

/**
 * The rule the owner asked for, whole: the posted person is another person than **every**
 * registration given — the name differs from each one's, and so does the birth date (or, on a
 * shared birth date, the sex, §576). No rows, no one to be the same as.
 */
export function isDifferentPerson(posted: PostedPerson, rows: readonly Pick<FamilyRow, "registeredName" | "birthDate" | "sex">[]): boolean {
  return rows.every((row) => comparePerson(row, posted) === "different");
}

export type SubmissionDecision<R extends FamilyRow> =
  /**
   * The same person again, still registered: re-send what the state offers, create nothing (§199,
   * §235). `notAnotherPerson` when only one of the name and the birth date matched (§446): the
   * re-sent message then says how to register somebody else — in the inbox, never on the screen.
   */
  | {
      kind: "resend";
      registration: R;
      notAnotherPerson?: true;
      /**
       * The slip matched a registration's birth date under another name (§493) — twins, perhaps: the
       * re-sent message says how two people born on one day are registered (another address, or the club).
       */
      sameBirthDate?: true;
    }
  /**
   * Another person on a registered address, from the public form: nothing registered; the posted
   * form is kept for the address to confirm from its inbox (§446), or — at the club's limit — the
   * address is told so (§389).
   */
  | { kind: "offerAnother"; about: R; atCap: boolean }
  /** A registration of this runner that is over (cancelled, lapsed), started again (AGENTS.md §10.5). */
  | { kind: "restart"; registration: R }
  /** A new registration for this runner. */
  | { kind: "insert" }
  /** From the confirmation or a staff entry: this person is already registered on this address. */
  | { kind: "refuseAlreadyRegistered" }
  /** From the confirmation or a staff entry: the address already carries the club's limit at this event. */
  | { kind: "refuseAtCap" }
  /** From the confirmation, while the schema still holds one registration per address: nothing can be honoured. */
  | { kind: "refuseClosed" };

export function decideSubmission<R extends FamilyRow>(input: {
  rows: readonly R[];
  /** The runner's legal name as submitted (`composeLegalName`). */
  legalName: string;
  /** The runner's birth date as submitted; absent only on a staff entry that was not told it. */
  birthDate?: string | null;
  /** The runner's sex as submitted (§576): on a registered birth date, another name and the other sex are another person. */
  sex?: RegistrationSex | null;
  via: "form" | "link" | "staff";
  /**
   * Whether the schema allows a second runner on an address (`family-gate.ts`): false until the
   * contract release drops the one-per-address constraint. False, everything is as it was.
   */
  familyOpen: boolean;
  cap: AddressCap;
}): SubmissionDecision<R> {
  const { rows, legalName, birthDate, sex, via, familyOpen, cap } = input;
  const posted: PostedPerson = { legalName, birthDate, sex };
  const active = rows.filter((row) => isActiveStatus(row.status));

  if (!familyOpen) {
    /*
      One address, one registration, as before §389: whatever name was typed, the one row there is
      is the one this submission is about. The confirmation cannot be honoured, so it is refused as
      a link that no longer works (no email offers one while this holds).
    */
    if (via === "link") return { kind: "refuseClosed" };
    const existing = active[0] ?? rows[rows.length - 1];
    if (!existing) return { kind: "insert" };
    return isActiveStatus(existing.status) ? { kind: "resend", registration: existing } : { kind: "restart", registration: existing };
  }

  // This runner's own earlier row, cancelled or lapsed: the one a new registration restarts.
  const same = rows.find((row) => sameRunner(row.registeredName, legalName));

  if (via === "link") {
    /*
      Under the lock, where the registration is created (§446): the address confirmed a different
      person when the email was rendered, and the address may have changed since — another link of
      the same family pressed first, or the same person entered twice. Somebody who is not a
      different person from everybody registered here now is refused, and the limit is counted here,
      the one place it is enforced.
    */
    if (!isDifferentPerson(posted, active)) return { kind: "refuseAlreadyRegistered" };
    if (!addressHasRoom(active.length, cap)) return { kind: "refuseAtCap" };
    return same ? { kind: "restart", registration: same } : { kind: "insert" };
  }

  // Nobody on the address is registered now: this runner starts again, or starts.
  if (active.length === 0) return same ? { kind: "restart", registration: same } : { kind: "insert" };

  if (via === "staff") {
    /*
      A staff member entering another person on a registered address (§493). The public form cannot
      tell a second person from a slip without the owner's two-part rule, and asks the inbox; the
      person at the desk has no such doubt — they typed the name of somebody standing in front of
      them, or relayed a request (the tick `createRegistrationByStaff` requires). So the name alone
      decides here: the same runner again is refused, anybody else is registered, within the club's
      limit per address. It is also the one way twins of one sex reach one address: the public form
      reads the second as a slip of the first, by the birth date they share (§446; a brother and a
      sister are two people there too since §576).
    */
    if (active.some((row) => sameRunner(row.registeredName, legalName))) return { kind: "refuseAlreadyRegistered" };
    if (!addressHasRoom(active.length, cap)) return { kind: "refuseAtCap" };
    return same ? { kind: "restart", registration: same } : { kind: "insert" };
  }

  const exact = active.find((row) => comparePerson(row, posted) === "same");
  if (exact) return { kind: "resend", registration: exact };

  /*
    One of the two matches a registration and the other does not (§446): the same name with another
    birth date, or another name with somebody's birth date. The owner's rule reads that as a slip,
    not as a second person — nothing is created, and the registration it resembles is re-sent, the
    name before the date. The message says how to register somebody else; the screen, as always,
    says nothing.
  */
  const byName = active.find((row) => sameRunner(row.registeredName, legalName));
  const partial = byName ?? active.find((row) => comparePerson(row, posted) === "partial");
  if (partial) {
    if (via !== "form") return { kind: "resend", registration: partial };
    /*
      Another name on a registered birth date (§493): possibly twins — whom the owner's rule reads
      as a slip, and whom "send the form with that person's name and birth date" cannot help, since
      that is what they did. The re-sent message says what can: another address, or the club.
      Only on a birth date that truly is the registration's own day (§576): a form with no date to
      compare is never told it names a twin.
    */
    if (byName || !sameBirthDay(partial, posted)) return { kind: "resend", registration: partial, notAnotherPerson: true };
    return { kind: "resend", registration: partial, notAnotherPerson: true, sameBirthDate: true };
  }

  if (via === "form") {
    /*
      A different person on an address that is registered (§389, §446). The public form registers
      nobody — a second registration from a form anybody can type an address into would be a way to
      fill an event from one inbox — and says nothing different on screen; the posted form is kept
      and the address is asked to confirm it, with a link only its owner can press. A cancelled
      registration of this same runner changes nothing here: bringing it back would add a
      registration to the address as surely as a new one.
    */
    return { kind: "offerAnother", about: active[0], atCap: !addressHasRoom(active.length, cap) };
  }
  return { kind: "resend", registration: active[0] };
}
