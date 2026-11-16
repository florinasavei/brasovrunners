"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { requireStaff } from "@/modules/staff-identity/session";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";
// The form's boxes and its event, as every volunteers' verb reads them (§754).
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Pune aici» and «Scoate» on «Planul voluntarilor» (§949; the owner, 2026-11-16: «e foarte important sa avem planul de
 * voluntari si fiecare in ce punct ramane»): one press puts a volunteer at a point of the event's route, or takes them off the
 * one they stand at. The form posts the point it wants (`checkpointId`, empty to take the person off), never a toggle, so a second
 * press before the page answers saves the same. The service asks for the role again (`canManageVolunteers`: the Organizer and the
 * Administrators, BR-REQ-060-01), holds the point to the event and audits the change; the press comes back to the plan, at the
 * point it was made on (`at`), a refusal's code in the address.
 */
export async function placeVolunteerAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const checkpointId = field(form, "checkpointId");
  const at = field(form, "at");
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });
  const anchor = isUuid(at) ? `#point-${at}` : "";

  let refusal: string | null = null;
  try {
    const actor = await requireStaff();
    const result = await changeVolunteer(getDb(), actor, { kind: "setCheckpoint", eventId, id: field(form, "volunteerId"), checkpointId }, new Date());
    await flashOutcome({ saved: result.changed ? (checkpointId ? "volunteerPlaced" : "volunteerUnplaced") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(path);
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}${anchor}` : `${path}${anchor}`);
}
