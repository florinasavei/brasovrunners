"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { StaffUser } from "@/db/schema/staff-users";
import { getPathname } from "@/i18n/navigation";
import { CoordinatesRefusal } from "@/modules/event-checkpoints/domain/coordinates";
import { inEmailPress } from "@/modules/notifications/press";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { setVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { changePlanPoint, PlanPointGone, PlanPointRefusal } from "@/modules/volunteers/plan-points";
import { sendVolunteerPoints } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
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
 * It emails nobody: only «Trimite fiecăruia punctul lui» below does.
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

/** Where a press on the plan's picture that went through comes back to: the picture's own place on the page (`page.tsx`). */
const PICTURE_ANCHOR = "#plan-picture";

/**
 * A press on the plan's picture, start to finish (§952): the staff session and the capability, asked here by name at the door
 * of the action — whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators, BR-REQ-060-01) —
 * before the service asks it again; then `press`, whose outcome becomes the toast; the way back is the plan, at the picture —
 * or, refused, at the page's alert (`#admin-alert`) with the refusal's code in the address, where its sentence is (§953's rule
 * for every press of this page). A plain function of this file, never a verb a browser may call: only the two actions under
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
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}#admin-alert` : `${path}${PICTURE_ANCHOR}`);
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

/** Where a press on «Trimite fiecăruia punctul lui» that went through comes back to: its own place on the page (`page.tsx`); a refused one lands at the page's alert, like every press here (§953). */
const MAIL_ANCHOR = "#plan-mail";

/** The box the question's «Trimite din nou tuturor» fills (`ConfirmSpec.option`): `on` when ticked, empty otherwise. */
const AGAIN_FIELD = "again";

/**
 * «Trimite fiecăruia punctul lui» on «Planul voluntarilor» (§956; the owner, 2026-11-16: «…si sa ii pot distribui din
 * aplicatie, sa stie exact unde si cum» — «Email din site, la apăsarea ta»): one press emails each volunteer placed at a point
 * of the event's route their point — its number, its name, its kilometre —, what they do there and the plan's picture
 * (`VOLUNTEER_POINT`). Asked first on the page, with how many people are written to, how many already know their point, how
 * many have no address and how many stand at no point; «Trimite din nou tuturor», ticked in that question, writes to
 * everybody again.
 *
 * The capability is asked here by name, at the door (`canManageVolunteers`: the Organizer and the Administrators,
 * BR-REQ-060-01), before the service asks it again; the service queues the messages in one transaction and audits the press
 * with its counts, never a person. An email press (`notifications/press.ts`): every row it queues carries this cause, its
 * id and who pressed, and the toast after it says what left, to how many and when. The press comes back to the plan, at its
 * own section — the sentence saying how many messages were queued (and how many people have no address) in the toast, a
 * refusal's code in the address.
 */
export async function sendVolunteerPointsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  return inEmailPress("volunteers.sendPoints", async (press) => {
    const locale = localeOf(form);
    const eventId = eventIdOf(form);
    // A form with no event names no plan to come back to: the volunteers' own screen.
    if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
    const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

    let refusal: string | null = null;
    try {
      const actor = await requireStaffCapability(canManageVolunteers);
      press.by(actor.id);
      const sent = await sendVolunteerPoints(getDb(), actor, { eventId, again: field(form, AGAIN_FIELD) === "on" }, new Date());
      // The people with no address are said only when there are some: they are the organizers' to tell another way.
      if (sent.noAddress > 0) await flashOutcome({ saved: "planPointsSentSomeWithout", queued: sent.queued, noAddress: sent.noAddress });
      else await flashOutcome({ saved: "planPointsSent", queued: sent.queued });
    } catch (error) {
      if (!isDomainError(error)) throw error;
      refusal = error.code;
    }
    revalidatePath(path);
    redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}#admin-alert` : `${path}${MAIL_ANCHOR}`);
  });
}

/** Where «Adaugă punctul» that went through comes back to: the section it was pressed in (`page.tsx`), its form empty for the next point. */
const POINTS_ANCHOR = "#plan-points";

/** Where «Șterge punctul» that went through comes back to: the plan's list, where the point no longer is and its people stand under «Fără punct». */
const LIST_ANCHOR = "#plan-list";

/**
 * The code a refused press of the plan's points is said with (§961): the rule's own sentence — a name, a kilometre, the
 * coordinates, the forty-first point, an editor's point somebody tried to delete here, a point no longer on the plan
 * (`Admin.errors.<reason>`) — or the domain's code for everything else (a role that may not, an event that is not there).
 */
function planPointRefusalCode(error: DomainError): string {
  return error instanceof PlanPointRefusal || error instanceof CoordinatesRefusal || error instanceof PlanPointGone ? error.reason : error.code;
}

/** The form's boxes of one point, as the service takes them: it reads them, this only hands them over. */
function planPointBoxes(form: FormData) {
  return { place: field(form, "place"), name: field(form, "name"), km: field(form, "km"), coordinates: field(form, "coordinates") };
}

/**
 * «Adaugă punctul» in «Punctele planului» on «Planul voluntarilor» (§961; the owner, 2026-11-17: «vreau să pot defini
 * punctele de mână, să pun nume punct și la ce km e și coordonate punct» — «Practic voluntarii sunt de 2 tipuri: start-finish
 * și pe traseu»): a point of the plan's own, on the route — with its kilometre — or at the start–finish, with its name and,
 * when the organizers know them, its coordinates.
 *
 * The capability is asked here by name, at the door (`canManageVolunteers`: the Organizer and the Administrators,
 * BR-REQ-060-01), before the service asks it again and holds what was typed to the rules. A refusal does not redirect: it
 * comes back as the form's own state (§315), so a wrong kilometre names its box and costs none of the others. A press that
 * went through comes back to the section, its outcome in the toast and the form empty — the organizers add their points
 * one after another. It emails nobody and no public page reads the point.
 */
export async function addPlanPointAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await changePlanPoint(getDb(), actor, { kind: "add", eventId, ...planPointBoxes(form) }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const outcome = refused(error, form);
    return error instanceof PlanPointRefusal ? { ...outcome, error: error.reason, errorValues: error.values } : { ...outcome, error: planPointRefusalCode(error) };
  }
  await flashOutcome({ saved: "planPointAdded" });
  revalidatePath(path);
  redirect(`${path}${POINTS_ANCHOR}`);
}

/**
 * «Salvează punctul» in a point's «Modifică punctul» on «Planul voluntarilor» (§961): a point of the plan's own changed —
 * its name, its kilometre, its coordinates, and whether it is on the route or at the start–finish — or, for one of the
 * event's «Puncte pe traseu», its coordinates alone: whatever else such a form posts is never read (its name and kilometre
 * are public, and are the editor's). The capability is asked here by name, at the door, and the service asks it again.
 *
 * A press that went through comes back to its point, its outcome in the toast; a refused one — a name left empty, a
 * kilometre that is no number, coordinates in no shape read, the point deleted meanwhile, a role that may not — comes back
 * to the page's alert (`#admin-alert`) with its code in the address, as every press of this page does (§953). It emails
 * nobody, and the people who stand at the point stay there.
 */
export async function editPlanPointAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });
  const pointId = field(form, "pointId");

  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    const result = await changePlanPoint(getDb(), actor, { kind: "edit", eventId, id: pointId, ...planPointBoxes(form) }, new Date());
    await flashOutcome({ saved: result.changed ? "planPointSaved" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = planPointRefusalCode(error);
  }
  revalidatePath(path);
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}#admin-alert` : `${path}${isUuid(pointId) ? `#point-${pointId}` : LIST_ANCHOR}`);
}

/**
 * «Șterge punctul» on a point of the plan's own (§961) — asked first on the page, with the point's name and how many people
 * stand there: they stay on the plan, at no point. One of the event's «Puncte pe traseu» is not deleted here (the service
 * refuses it: it is deleted in the editor, where the event's page and the race number follow). The capability is asked here
 * by name, at the door, and the service asks it again and audits the removal with how many people it freed — never who.
 *
 * A press that went through comes back to the plan's list, where the point no longer is; a refused one to the page's alert
 * with its code (§953). It emails nobody: a person told that point by an earlier «Trimite fiecăruia punctul lui» is told
 * their new one by the next press, once they stand at one.
 */
export async function removePlanPointAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await changePlanPoint(getDb(), actor, { kind: "remove", eventId, id: field(form, "pointId") }, new Date());
    await flashOutcome({ saved: "planPointRemoved" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = planPointRefusalCode(error);
  }
  revalidatePath(path);
  redirect(refusal ? `${path}?planError=${encodeURIComponent(refusal)}#admin-alert` : `${path}${LIST_ANCHOR}`);
}
