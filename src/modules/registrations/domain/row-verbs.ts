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
  | "cancel";

export function rowVerbsFor(
  status: RegistrationStatus,
  role: StaffRole,
  options: { checkedIn: boolean },
): RowVerb[] {
  // The desk's own verbs are every staff session's (§103); the list itself is Administrator-only
  // (§10.2), so anybody reading this row already passed that gate. `canManageRegistrations` is
  // what separates "may see a name at the desk" from "may cancel somebody's place".
  const mayManage = canManageRegistrations(role);
  const verbs: RowVerb[] = ["open"];

  if (deriveAllowedResendMessageType(status)) verbs.push("resend");

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

  // Cancelling releases the place through the allocator and leaves an audit row (§67, §88).
  if (mayManage && canTransition(status, "CANCELLED")) verbs.push("cancel");

  return verbs;
}
