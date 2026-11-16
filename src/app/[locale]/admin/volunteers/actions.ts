"use server";

import { getDb } from "@/db/client";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { raceDayDecisionFrom } from "@/modules/volunteers/domain/volunteer";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
// The form's boxes, its event and the way back (§839), as the event card's verbs read them.
import { backToCard, eventIdOf, field } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Are kit» on a row of the «Voluntari» list (§904; the owner, 2026-11-03: «ar trebui să număr pe header câți au kit, deci trebuie
 * încă un field de „are kit"»): one press ticks or clears the organizers' mark that the person gets the volunteers' kit. The form
 * posts the state it wants (`hasKit=1|0`), never a toggle, so a second press before the page answers saves the same. The service asks
 * for the role again (`canManageVolunteers`: the Organizer and the Administrators, BR-REQ-060-01) and audits the change as every other
 * edit of a person's boxes; the press comes back to the page of the list it was made on, its refusal's code in the address.
 */
/**
 * «Participă la tombolă» on a row of the «Voluntari» list (§949; the owner, 2026-11-16: «coloană peste tot de „participă la
 * tombolă"»): one press takes a volunteer off the raffle's list of their event, or puts them back. The form posts the state it
 * wants (`inRaffle=1|0`), never a toggle. The service asks for the role again (`canManageVolunteers`, BR-REQ-060-01) and audits
 * the change as every other edit of a person's boxes; the press comes back to the page of the list it was made on.
 */
export async function setVolunteerRaffleAction(form: FormData): Promise<void> {
  const inRaffle = field(form, "inRaffle") === "1";
  try {
    const actor = await requireStaff();
    const result = await changeVolunteer(getDb(), actor, { kind: "setRaffle", eventId: eventIdOf(form), id: field(form, "volunteerId"), inRaffle }, new Date());
    return backToCard(form, { saved: result.changed ? (inRaffle ? "volunteerRaffleOn" : "volunteerRaffleOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

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

/**
 * «Decizie pentru ziua cursei» (§NNN; the owner, 2026-11-16, of the «Voluntari» list: «si la voluntar trebuie sa am si decizie pt
 * ziua cursei»): the one short line the organizers keep about what THEY decided for a volunteer on race day — written, changed
 * or, by an empty box, cleared — from the dialog on the list's row and from the same form on the person's page.
 *
 * The coarse gate here (`canManageVolunteers`: the Organizer and the Administrators), and the service asks for the role again
 * (BR-REQ-060-01: a control drawn only on those two screens is a courtesy, never the permission). A refusal — too long, a person
 * deleted meanwhile, another role — comes back as the form's own state, the words still in the box (§315), with scripts off too.
 * A save comes back to the address the form was on (`returnTo`: this page of the list with its filters, sort and page, or the
 * person's page) through the volunteers' one validated return — which takes only a path of the «Voluntari» screen, so a forged
 * `returnTo` sends nobody anywhere else — with the toast saying saved, cleared or nothing to change. The words go in neither the
 * address nor the flash. It asks nothing first (§384): it tells nobody and moves nothing else of the person.
 */
export async function setVolunteerDecisionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const decision = form.get("decision");
  let changed: boolean;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    ({ changed } = await changeVolunteer(getDb(), actor, { kind: "setDecision", eventId: eventIdOf(form), id: field(form, "volunteerId"), decision }, new Date()));
  } catch (error) {
    return refused(error, form);
  }
  // What the service accepted, read the way it read it: nothing left of the box is a decision cleared.
  const cleared = raceDayDecisionFrom(decision) === null;
  return backToCard(form, { saved: changed ? (cleared ? "volunteerDecisionCleared" : "volunteerDecisionSaved") : "volunteerUnchanged" });
}
