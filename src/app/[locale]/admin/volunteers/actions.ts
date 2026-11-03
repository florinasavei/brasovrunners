"use server";

import { getDb } from "@/db/client";
import { requireStaff } from "@/modules/staff-identity/session";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
// The form's boxes, its event and the way back (§839), as the event card's verbs read them.
import { backToCard, eventIdOf, field } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Are kit» on a row of the «Voluntari» list (§904; the owner, 2026-11-03: «ar trebui să număr pe header câți au kit, deci trebuie
 * încă un field de „are kit"»): one press ticks or clears the organizers' mark that the person gets the volunteers' kit. The form
 * posts the state it wants (`hasKit=1|0`), never a toggle, so a second press before the page answers saves the same. The service asks
 * for the role again (`canManageVolunteers`: the Organizer and the Administrators, BR-REQ-060-01) and audits the change as every other
 * edit of a person's boxes; the press comes back to the page of the list it was made on, its refusal's code in the address.
 */
export async function setVolunteerKitAction(form: FormData): Promise<void> {
  const hasKit = field(form, "hasKit") === "1";
  try {
    const actor = await requireStaff();
    const result = await changeVolunteer(getDb(), actor, { kind: "setKit", eventId: eventIdOf(form), id: field(form, "volunteerId"), hasKit }, new Date());
    return backToCard(form, { saved: result.changed ? (hasKit ? "volunteerKitOn" : "volunteerKitOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}
