import type { RegistrationStatus } from "@/db/schema/registrations";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { deriveAllowedResendMessageType } from "./resend";
import { canTransition } from "./state-machine";

/**
 * Which verbs a registration row offers, given its status and who is looking (§178).
 *
 * The owner, of the registrations list: "trebe sa pot face management de inscrieri mai eficient",
 * "CRUD participants", "and statuses should be drop-down". The last one is the sentence that
 * needed a decision. A literal status dropdown — pick a state, save — would be a second write
 * path into `registrations` straight past three rules that carry trust: the allocator holds the
 * event row while it decides who gets a place (`AGENTS.md` §10.6), a confirmation requires an
 * approved declaration somebody signed (§10.8), and §15.11 lists what staff may do and ends
 * "there is no fourth". So the dropdown is a **menu of the verbs that already exist**, each one
 * the same Server Action the registration's own page calls, and which of them appear is this
 * function.
 *
 * Pure, and tested as such: a table of (status, role) → verbs is something a reader can check
 * against `state-machine.ts` by eye, where the same logic spread across JSX is not.
 *
 * Every verb here is still authorized again in its service (BR-REQ-060-01). This decides what a
 * person is *shown*, which is a courtesy; it decides nothing about what they may do.
 */
export type RowVerb =
  | "open"
  | "resend"
  /** Confirm on the paper declaration the participant signed at the desk (§67, BR-REQ-037-06). */
  | "confirmOnPaper"
  /** Give a waiting-list entry a free place (BR-REQ-037-07). */
  | "givePlace"
  | "checkIn"
  | "undoCheckIn"
  | "cancel"
  /**
   * "This bib is on paper" — or is not, for a reprint (§264).
   *
   * Offered only where there is something to print: a confirmed, real registration with a
   * *settled* number. A provisional one (§214) is printed nowhere by design, so a row holding
   * one has nothing to mark.
   */
  | "markBibPrinted"
  | "unmarkBibPrinted"
  /**
   * Erase the registration, and the person behind it when it was their last (BR-REQ-037-06, §180).
   *
   * Last, always, and the only verb here that offers itself in *every* state. That is the point
   * §179 made on the registration's own page: erasure used to sit inside the cancel section,
   * which is shown only while a row can still be cancelled, so a cancelled or expired row could
   * never be erased — and that is exactly the row somebody asks to have removed. The list had
   * the same hole differently: no erase at all, so eighty test rows meant eighty trips into
   * eighty detail pages.
   *
   * It is not a one-press verb. What the menu opens is a panel that asks for a reason and for
   * the row's own name, typed (`erase-confirmation.ts`); the server refuses the erasure without
   * it.
   */
  | "erase";

export function rowVerbsFor(
  status: RegistrationStatus,
  role: StaffRole,
  options: { checkedIn: boolean; bib?: { settled: boolean; printed: boolean } },
): RowVerb[] {
  /*
    The desk's own verbs are every staff session's (§103). `canManageRegistrations` is what
    separates "may see a name at the desk" from "may cancel somebody's place".

    **This used to lean on the screen (§289).** The comment here said the list was
    Administrator-only, "so anybody reading this row already passed that gate" — which was true
    until the Organizer was given the list, and is exactly the kind of assumption that stops
    being true without anything breaking loudly. `resend` was the one verb it covered: an
    Organizer would have been offered a button whose service answers FORBIDDEN
    (`assertAdministrator`), which is the "I can press it and nothing happens" that started this.
  */
  const mayManage = canManageRegistrations(role);
  const verbs: RowVerb[] = ["open"];

  // Resending is a message to a participant, so it is the Administrator's (AGENTS.md §15.8).
  if (mayManage && deriveAllowedResendMessageType(status)) verbs.push("resend");

  // A place is given, never assigned: `promoteRegistrationByStaff` goes through the allocator,
  // which is why the verb exists at all rather than an UPDATE (§10.6).
  if (status === "WAITLISTED" && mayManage) verbs.push("givePlace");

  /*
    Confirming on paper is the one way a registration reaches CONFIRMED from this screen, and it
    means exactly what it says: a declaration the *participant* signed, on paper, recorded by the
    staff member named in the audit row (§67). It is offered only where the state machine already
    allows the transition, so a cancelled or expired row never shows it.
  */
  if (mayManage && canTransition(status, "CONFIRMED")) verbs.push("confirmOnPaper");

  if (status === "CONFIRMED") verbs.push(options.checkedIn ? "undoCheckIn" : "checkIn");

  /*
    The printing mark (§264). Only with a settled number, because a provisional one is never
    printed, and only for whoever may manage registrations: the sheet is a read that the
    Organizer has too (§289), and this is the club's record of having put it on paper.

    And only while CONFIRMED (§305). A cancelled registration keeps its settled number and its
    printed mark — that is what makes the bib *void* and worth listing — but `setBibPrinted`
    refuses any row the sheet would not print, so offering the mark here was §289's lesson over
    again: a menu item whose service answers NOT_FOUND. The void mark is read, on the list's
    bibs panel and on the row's own page; it is not a thing to toggle.
  */
  if (mayManage && status === "CONFIRMED" && options.bib?.settled) {
    verbs.push(options.bib.printed ? "unmarkBibPrinted" : "markBibPrinted");
  }

  // Cancelling releases the place through the allocator and leaves an audit row (§67, §88).
  if (mayManage && canTransition(status, "CANCELLED")) verbs.push("cancel");

  /*
    Erase: every state, and last (§180). Note the deliberate asymmetry with `cancel` on the line
    above — cancel is gated on `canTransition(status, "CANCELLED")` because cancelling an
    already-cancelled registration is meaningless, while erasing one is the commonest case there
    is. `deleteRegistrationByStaff` has always handled both: it releases a place only when there
    is a place to release, so a lapsed row erases cleanly and takes nothing from the queue.

    `mayManage` keeps it Administrator-only, and the service asserts that again
    (BR-REQ-060-01) — this line decides what is *shown*, never what may be done.
  */
  if (mayManage) verbs.push("erase");

  return verbs;
}
