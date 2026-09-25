import type { RegistrationStatus } from "@/db/schema/registrations";
import { type AddressCap, addressHasRoom } from "./address-cap";
import { sameRunner } from "./name-key";
import { isActiveStatus } from "./state-machine";

/**
 * What one submission does on an address that may carry a family (§389) — the decision, apart
 * from the writing of it, so every branch is a unit test and the service reads as the rule.
 *
 * Three doors reach it:
 * - **the public form** (`form`): anybody may type any address into it, so it must never reveal
 *   whether the address is registered (§39's oracle rule, AGENTS.md §19.4). Whatever it decides, the
 *   screen is the same "check your inbox"; only the inbox learns which case it was;
 * - **the link emailed to the address** (`link`): whoever holds it has read that inbox, so here —
 *   and only here — a refusal may say "this person is already registered on this address" or "the
 *   address is at the club's limit";
 * - **a staff entry** (`staff`), which refuses a registered address out loud before calling in
 *   (`createRegistrationByStaff`) and reaches this only by racing another entry.
 *
 * Decided under the event's lock (`submitRegistration`), from every registration the address holds
 * at the event, so two submissions of one family cannot both find the address empty.
 */

/**
 * The two refusals the form behind the emailed link can give (§389), as the markers the page reads
 * from `?fields=` and turns into sentences: this runner is registered on the address already, and
 * the address is at the club's limit. Only ever sent to a page behind the token — the public form
 * never answers either (§39).
 */
export const ALREADY_ON_ADDRESS = "alreadyOnAddress";
export const ADDRESS_AT_CAP = "addressAtCap";
/** The link itself can no longer be used — spent, lapsed, or for another event — or the flow is not open yet. */
export const ANOTHER_LINK_INVALID = "anotherLink";
/**
 * The query parameter of the emailed link that opens the event's registration form for another
 * person on the same address: the token's secret (§389). Only the renderer writes it and only the
 * form reads it; nothing about a person travels in it.
 */
export const ANOTHER_PERSON_PARAM = "another";

export type FamilyRow = { id: string; status: RegistrationStatus; registeredName: string };

export type SubmissionDecision<R extends FamilyRow> =
  /** The same runner again, still registered: re-send what the state offers, create nothing (§199, §235). */
  | { kind: "resend"; registration: R }
  /** Another runner on a registered address, from the public form: create nothing, email the address (§389). */
  | { kind: "offerAnother"; about: R; atCap: boolean }
  /** A registration of this runner that is over (cancelled, lapsed), started again (AGENTS.md §10.5). */
  | { kind: "restart"; registration: R }
  /** A new registration for this runner. */
  | { kind: "insert" }
  /** From the emailed link: this runner is already registered on this address. */
  | { kind: "refuseAlreadyRegistered" }
  /** From the emailed link: the address already carries the club's limit at this event. */
  | { kind: "refuseAtCap" }
  /** From the emailed link, while the schema still holds one registration per address: nothing can be honoured. */
  | { kind: "refuseClosed" };

export function decideSubmission<R extends FamilyRow>(input: {
  rows: readonly R[];
  /** The runner's legal name as submitted (`composeLegalName`). */
  legalName: string;
  via: "form" | "link" | "staff";
  /**
   * Whether the schema allows a second runner on an address (`family-gate.ts`): false until the
   * contract release drops the one-per-address constraint. False, everything is as it was.
   */
  familyOpen: boolean;
  cap: AddressCap;
}): SubmissionDecision<R> {
  const { rows, legalName, via, familyOpen, cap } = input;
  const active = rows.filter((row) => isActiveStatus(row.status));

  if (!familyOpen) {
    /*
      One address, one registration, as before this section: whatever name was typed, the one row
      there is is the one this submission is about. The link cannot be honoured, so it is refused
      as a link that no longer works (the page never offers one while this holds).
    */
    if (via === "link") return { kind: "refuseClosed" };
    const existing = active[0] ?? rows[rows.length - 1];
    if (!existing) return { kind: "insert" };
    return isActiveStatus(existing.status) ? { kind: "resend", registration: existing } : { kind: "restart", registration: existing };
  }

  const same = rows.find((row) => sameRunner(row.registeredName, legalName));

  if (via === "link") {
    if (same && isActiveStatus(same.status)) return { kind: "refuseAlreadyRegistered" };
    // Under the lock, where the registration would be created: the one place the limit is enforced.
    if (!addressHasRoom(active.length, cap)) return { kind: "refuseAtCap" };
    return same ? { kind: "restart", registration: same } : { kind: "insert" };
  }

  if (same && isActiveStatus(same.status)) return { kind: "resend", registration: same };

  if (active.length > 0) {
    /*
      Another runner on an address that is registered. The public form creates nothing — a second
      registration from a form anybody can type an address into would be a way to fill an event
      from one inbox — and says nothing different on screen; the address is asked instead, with a
      link only its owner can press. A cancelled registration of this same runner changes nothing
      here: bringing it back would add a registration to the address as surely as a new one.
    */
    if (via === "form") return { kind: "offerAnother", about: active[0], atCap: !addressHasRoom(active.length, cap) };
    return { kind: "resend", registration: active[0] };
  }

  // Nobody on the address is registered now: this runner starts again, or starts.
  return same ? { kind: "restart", registration: same } : { kind: "insert" };
}
