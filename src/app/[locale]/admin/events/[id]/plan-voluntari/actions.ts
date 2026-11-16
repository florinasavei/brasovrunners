"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { StaffUser } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { setVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";
// The form's boxes and its event, as every volunteers' verb reads them (§754).
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/**
 * «Pune aici» and «Scoate» on «Planul voluntarilor» (§949; the owner, 2026-11-16: «e foarte important sa avem planul de
 * voluntari si fiecare in ce punct ramane»): one press puts a volunteer at a point of the event's route, or takes them off the
 * one they stand at. The form posts the point it wants (`checkpointId`, empty to take the person off), never a toggle, so a second
 * press before the page answers saves the same. The service asks for the role again (`canManageVolunteers`: the Organizer and the
 * Administrators, BR-REQ-060-01), holds the point to the event and audits the change. A press that went through comes back to
 * the plan at the point it was made on (`at`), its outcome in the toast. A refusal — the person cancelled meanwhile, the point
 * taken off the route meanwhile, a role that may not — comes back to the page's alert (`#admin-alert`) with its code in the
 * address (§953, the registrations list's rule, §943): the alert is where the refusal's sentence is, at the top of a page that
 * may be several screens long, and a point deleted meanwhile has no anchor left to land on.
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
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}#admin-alert` : `${path}${anchor}`);
}

/** Where a press on the plan's picture comes back to: the picture's own place on the page (`page.tsx`). */
const PICTURE_ANCHOR = "#plan-picture";

/**
 * A press on the plan's picture, start to finish (§952): the staff session and the capability, asked here by name at the door
 * of the action — whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators, BR-REQ-060-01) —
 * before the service asks it again; then `press`, whose outcome becomes the toast; the way back is the plan, at the picture, a
 * refusal's code in the address. A plain function of this file, never a verb a browser may call: only the two actions under
 * it are exported.
 */
async function pressOnPlanPicture(form: FormData, press: (actor: Pick<StaffUser, "id" | "role">, eventId: string) => Promise<void>): Promise<never> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await press(actor, eventId);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(path);
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}${PICTURE_ANCHOR}` : `${path}${PICTURE_ANCHOR}`);
}

/**
 * «Încarcă poza planului» and «Schimbă poza» on «Planul voluntarilor» (§952; the owner, 2026-11-16, with a picture of the route
 * and its volunteers' points numbered on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul [pozei]»): the
 * picture the browser has just stored through the backoffice's one upload (`/api/admin/media`, which answers its id) becomes
 * the event's plan picture — the first, or another in the place of the one before. The island on the page posts this form the
 * moment its upload answers (`volunteers/ui/PlanPictureUpload.tsx`). The service holds the id to a stored picture and audits
 * the change; a form with no picture in it is refused here, so taking the picture off is only ever «Șterge poza», which asks.
 */
export async function setPlanPictureAction(form: FormData): Promise<void> {
  await pressOnPlanPicture(form, async (actor, eventId) => {
    const assetId = field(form, "assetId").trim();
    if (assetId === "") throw new DomainError("VALIDATION_ERROR", "the plan's picture: no picture was posted", ["assetId"]);
    const result = await setVolunteerPlanPicture(getDb(), actor, { eventId, assetId }, new Date());
    if (!result.changed) await flashOutcome({ saved: "volunteerUnchanged" });
    else if (result.outcome === "replaced") await flashOutcome({ saved: "planPictureReplaced" });
    else await flashOutcome({ saved: "planPictureSet" });
  });
}

/**
 * «Șterge poza» on «Planul voluntarilor» (§952): the plan's picture taken off the event — asked first on the page, since only
 * uploading it again brings it back. The points and the people are untouched; the stored picture, used nowhere else, is the
 * sweep's after its week (§73). The service audits it; a plan that has no picture answers «nimic de schimbat».
 */
export async function removePlanPictureAction(form: FormData): Promise<void> {
  await pressOnPlanPicture(form, async (actor, eventId) => {
    const result = await setVolunteerPlanPicture(getDb(), actor, { eventId, assetId: null }, new Date());
    await flashOutcome({ saved: result.changed ? "planPictureRemoved" : "volunteerUnchanged" });
  });
}
