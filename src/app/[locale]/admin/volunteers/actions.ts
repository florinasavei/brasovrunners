"use server";

import { getDb } from "@/db/client";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { raceDayDecisionFrom } from "@/modules/volunteers/domain/volunteer";
import { editVolunteerNote } from "@/modules/volunteers/volunteer-notes";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
// The form's boxes, its event and the way back (§839), as the event card's verbs read them.
import { backToCard, eventIdOf, field } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Decizie pentru ziua cursei» (§954; the owner, 2026-11-16, of the «Voluntari» list: «si la voluntar trebuie sa am si decizie pt
 * ziua cursei»): the one short line the organizers keep about what THEY decided for a volunteer on race day — written, changed
 * or, by an empty box, cleared — from the dialog on the list's row and from the same form on the person's page.
 *
 * The coarse gate here (`canManageVolunteers`: the Organizer and the Administrators), and the service asks for the role again
 * (BR-REQ-060-01: a control drawn only on those two screens is a courtesy, never the permission). A refusal — too long, a person
 * deleted meanwhile, another role, a session that ended — comes back as the form's own state, the words still in the box (§315),
 * with scripts off too. A save comes back to the address the form was on (`returnTo`: this page of the list with its filters,
 * sort and page, or the person's page) through the volunteers' one validated return — which takes only a path of the «Voluntari»
 * screen, so a forged `returnTo` sends nobody anywhere else — with the toast saying saved, cleared or nothing to change. The
 * words go in neither the address nor the flash. It asks nothing first (§384): it tells nobody and moves nothing else of the
 * person.
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

/**
 * «Participă la tombolă» on a row of the «Voluntari» list (§949; the owner, 2026-11-16: «coloană peste tot de „participă la
 * tombolă"»): one press takes a volunteer off the raffle's list of their event, or puts them back. The form posts the state it
 * wants (`inRaffle=1|0`), never a toggle, so a second press before the page answers saves the same. The service asks for the role
 * again (`canManageVolunteers`: the Organizer and the Administrators, BR-REQ-060-01) and audits the change as every other edit of a
 * person's boxes; nobody is told. The press comes back to the page of the list it was made on, its refusal's code in the address.
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

/**
 * «Prezent» on a row of the «Voluntari» list and on the person's page (§NNN; the owner, 2026-11-18, three days before the race: «La
 * voluntari trebuie să trec prezent/absent ca să pot face tombola doar pentru cei prezenți»): one press ticks a volunteer present on
 * the day, or clears the tick — unticked is absent, and there is no third state. The form posts the state it wants (`present=1|0`),
 * never a toggle, so a second press before the page answers saves the same. The coarse gate here (`canManageVolunteers`: the Organizer
 * and the Administrators), and the service asks for the role again (BR-REQ-060-01: a tick drawn only on those two screens is a
 * courtesy, never the permission); the change is audited as every edit of a person's boxes, nobody is told, and no public page is
 * expired — no visitor reads it. The press comes back to the page it was made on — this page of the list with its filters, or the
 * person's page — through the volunteers' one validated return, with the toast, or the refusal's code in the address.
 */
export async function setVolunteerPresentAction(form: FormData): Promise<void> {
  const present = field(form, "present") === "1";
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    const result = await changeVolunteer(getDb(), actor, { kind: "setPresent", eventId: eventIdOf(form), id: field(form, "volunteerId"), present }, new Date());
    return backToCard(form, { saved: result.changed ? (present ? "volunteerPresentOn" : "volunteerPresentOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Modifică nota» on a row of the «Voluntari» list (§964; the owner, 2026-11-17, of that list: «lasă-mă să editez și nota
 * internă»): new words for the row's newest internal note, from the dialog over the list (`RowNoteDialog`, opened on the note's
 * words). The coarse gate here (`canManageVolunteers`: the Organizer and the Administrators), and the service asks again — and
 * whose note it is: its author's, or any for an Administrator (BR-REQ-060-01: the press drawn only for those is a courtesy). A
 * refusal — empty, too long, a note deleted meanwhile, another role, a session that ended — comes back as the form's own state, the
 * words still in the box (§315). A save comes back to the address the form was on (`returnTo`: this page of the list, its filters,
 * sort and page) through the volunteers' one validated return, which takes only a path of the «Voluntari» screen — a forged one
 * lands on the event's own «Voluntari» card, as the row's other two dialogs do — with the toast saying changed or nothing to
 * change. The words go in neither the address nor the flash. It asks nothing first (§384): it changes one of the organizers' own
 * notes, emails nobody and moves nothing else of the person.
 */
export async function editVolunteerNoteFromListAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    ({ changed } = await editVolunteerNote(getDb(), actor, field(form, "noteId"), form.get("body"), new Date()));
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: changed ? "noteEdited" : "volunteerUnchanged" });
}
