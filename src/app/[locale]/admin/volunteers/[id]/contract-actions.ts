"use server";

import { getDb } from "@/db/client";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { deleteSignedContract } from "@/modules/volunteers/signed-contract";
import { isDomainError } from "@/shared/errors/domain-error";
import type { FormOutcome } from "@/shared/forms/outcome";
// The «Voluntari» screen's own validated way back (§839): only a path of that screen, never anywhere else.
import { backToCard, eventIdOf, field } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Șterge» on a volunteer's «Contract semnat» card (§NNN), behind the house's question: the signed copy deleted, with any upload of
 * the person left half-sent. The coarse gate here (`requireStaffCapability(canManageVolunteers)`: the Tehnic role, the Redactor,
 * the volunteer and a member never reach the service), and the service asserts the role and the volunteer's event again
 * (BR-REQ-060-01). Back to the volunteer's page (`returnTo`, the screen's validated way back), the toast saying it is deleted — or,
 * when a colleague deleted it first, that there was none — and a refusal's code in the address. The upload and the download are
 * the route's (`/api/admin/events/<id>/volunteers/<volunteerId>/signed-contract`): a file does not go through a Server Action.
 */
export async function deleteSignedContractAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let deleted: boolean;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    ({ deleted } = await deleteSignedContract(getDb(), actor, { eventId: eventIdOf(form), volunteerId: field(form, "volunteerId") }, new Date()));
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: deleted ? "volunteerContractDeleted" : "volunteerContractNone" });
}
