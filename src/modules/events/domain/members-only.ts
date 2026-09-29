import { canOpenMembersZone, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * «Doar pentru membrii BVR» (§552; the owner, 2026-09-28): an event the club holds for its members
 * alone. Pure rules, so they are tested without a request; the session is read in
 * `events/members-only.ts`, the rows are withheld in SQL in `events/repository.ts`.
 *
 * **Who sees one.** Whoever may open the members' zone (§524, `canOpenMembersZone`): a signed-in
 * member, and every colleague, who is a member of the club first — the backoffice keeps its own
 * editor and previews. Nobody else: a visitor with no account, or an account the club removed,
 * meets the same 404 an unpublished page gives (§28), never a sentence that the event exists.
 */
export function mayViewMembersOnlyEvents(role: StaffRole | null | undefined): boolean {
  return role !== null && role !== undefined && canOpenMembersZone(role);
}

/** Whether an event is kept off every public surface (§552) — what the SQL reads as `members_only`. */
export function withheldFromPublic(event: { membersOnly: boolean }): boolean {
  return event.membersOnly;
}

/**
 * Whether this viewer may read this event (§552): every event that is not the members' alone, and
 * a members' event only for a members' session. The page's, the form's and the `.ics`'s one rule.
 */
export function mayViewEvent(event: { membersOnly: boolean }, role: StaffRole | null | undefined): boolean {
  return !withheldFromPublic(event) || mayViewMembersOnlyEvents(role);
}
