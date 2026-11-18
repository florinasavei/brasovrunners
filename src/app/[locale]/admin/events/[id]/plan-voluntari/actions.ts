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
import { PLAN_LINK_BOXES, PlanMapsRefusal } from "@/modules/volunteers/domain/plan-link";
import { addVolunteerPlanLink, addVolunteerPlanPicture, removeVolunteerPlanLink, removeVolunteerPlanPicture } from "@/modules/volunteers/plan";
import { changePlanPoint, PlanPointGone, PlanPointRefusal } from "@/modules/volunteers/plan-points";
import { sendVolunteerPoints } from "@/modules/volunteers/point-mail";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";
// The form's boxes and its event, as every volunteers' verb reads them (§754).
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";
import { PLAN_SAVED, planAddress, type PlanView, planViewOf } from "./plan-address";

/**
 * The view a form of the page was posted from (§974): every form carries it (`view`), so every press — the ones that went
 * through and the refused — comes back to the view it was pressed in. A form that names none — a page opened before the
 * views — comes back to `fallback`: «Pe puncte» for a press on a point, the one view that draws points, «Tabel» otherwise.
 */
const viewOf = (form: FormData, fallback: PlanView = "table"): PlanView => (field(form, "view") === "" ? fallback : planViewOf(field(form, "view")));

/**
 * The way back of a refused press (§953): the page's alert, where the refusal's sentence is, in the view the press came from —
 * and a press made on a point (`point`) keeps that point and its group drawn open under the alert, one press from trying again;
 * an id that is no point of this plan any more opens nothing (the page reads only its own points).
 */
const refusedAt = (path: string, view: PlanView, code: string, point?: string) =>
  planAddress(path, { view, planError: code, open: point && isUuid(point) ? point : undefined, hash: "admin-alert" });

/** What a press made on a person's line of «Fără punct» posts as its `at` (§978): it comes back to that fold, open. */
const UNPLACED_AT = "unplaced";
/** The fold «Fără punct» (§978). */
const UNPLACED_ANCHOR = "plan-unplaced";

/**
 * «Pune aici» and «Scoate» on «Planul voluntarilor» (§949; the owner, 2026-11-16: «e foarte important sa avem planul de
 * voluntari si fiecare in ce punct ramane»): one press puts a volunteer at a point of the event's route, or takes them off the
 * one they stand at. The form posts the point it wants (`checkpointId`, empty to take the person off), never a toggle, so a second
 * press before the page answers saves the same. The service asks for the role again (`canManageVolunteers`: the Organizer and the
 * Administrators, BR-REQ-060-01), holds the point to the event and audits the change. A press that went through comes back to
 * the plan at the point it was made on (`at`) — in the view it was pressed in, that point and its group drawn open (`open=`,
 * §974) —, its outcome in the toast. A refusal — the person cancelled meanwhile, the point taken off the route meanwhile, a
 * role that may not — comes back to the page's alert (`#admin-alert`) with its code in the address (§953, the registrations
 * list's rule, §943): the alert is where the refusal's sentence is, at the top of a page that may be several screens long,
 * and a point deleted meanwhile has no anchor left to land on.
 *
 * «Pune» on a person's own line of «Fără punct» (§978, amending §949; the owner, 2026-11-18: «aici eu vreau sa pot asigna
 * voluntari la punct direct de aici») is the same press from the other side: the person is posted, the point chosen in the
 * line's select, and `at` is `unplaced` — it comes back to «Fără punct», drawn open (`PLAN_SAVED.unplaced`), the next person
 * one press away. A refusal comes back to the page's alert as every press does.
 * It emails nobody: only «Trimite fiecăruia punctul lui» below does.
 */
export async function placeVolunteerAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const checkpointId = field(form, "checkpointId");
  const at = field(form, "at");
  const view = viewOf(form, "points");
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

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
  redirect(
    refusal
      ? refusedAt(path, view, refusal, at)
      : at === UNPLACED_AT
        ? planAddress(path, { view, savedIn: PLAN_SAVED.unplaced, hash: UNPLACED_ANCHOR })
        : planAddress(path, isUuid(at) ? { view, open: at, hash: `point-${at}` } : { view }),
  );
}

/**
 * The code a refused press of «Poze și hărți» is said with (§978): the rule's own sentence — the thirteenth picture or link,
 * an address that is no web address, a label too long (`Admin.errors.<reason>`) — or the domain's code for everything else
 * (a role that may not, an event that is not there, an id that names no stored picture).
 */
function planMapsRefusalCode(error: DomainError): string {
  return error instanceof PlanMapsRefusal ? error.reason : error.code;
}

/**
 * A press of «Poze și hărți», start to finish (§978, amending §952): the staff session and the capability, asked here by name
 * at the door of the action — whoever works the volunteers (`canManageVolunteers`: the Organizer and the Administrators,
 * BR-REQ-060-01) — before the service asks it again; then `press`, whose outcome becomes the toast; the way back is the
 * plan, in the view the press came from, at the fold «Poze și hărți», drawn open (`saved=`, §974) — or, refused, at the
 * page's alert (`#admin-alert`) with the refusal's code in the address, where its sentence is (§953's rule for every press
 * of this page). A plain function of this file, never a verb a browser may call.
 */
async function pressOnPlanMaps(form: FormData, press: (actor: Pick<StaffUser, "id" | "role">, eventId: string) => Promise<void>): Promise<never> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const view = viewOf(form);
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await press(actor, eventId);
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = planMapsRefusalCode(error);
  }
  revalidatePath(path);
  redirect(refusal ? refusedAt(path, view, refusal) : planAddress(path, { view, savedIn: PLAN_SAVED.maps, hash: MAPS_ANCHOR }));
}

/** The fold «Poze și hărți» (§978), where its presses come back to. */
const MAPS_ANCHOR = "plan-maps";

/**
 * «Adaugă o poză» in «Poze și hărți» on «Planul voluntarilor» (§978, amending §952's one picture; the owner, 2026-11-18:
 * «sa pot pune mai multe poze»): the picture the browser has just stored through the backoffice's one upload
 * (`/api/admin/media`, which answers its id) goes last among the plan's pictures. The island on the page posts this form the
 * moment its upload answers (`volunteers/ui/PlanPictureUpload.tsx`). The service holds the id to a stored picture, the
 * plan to twelve pictures, and audits the change; a form with no picture in it is refused naming the box.
 */
export async function addPlanPictureAction(form: FormData): Promise<void> {
  await pressOnPlanMaps(form, async (actor, eventId) => {
    const result = await addVolunteerPlanPicture(getDb(), actor, { eventId, assetId: field(form, "assetId") }, new Date());
    await flashOutcome({ saved: result.changed ? "planPictureAdded" : "volunteerUnchanged" });
  });
}

/**
 * «Șterge poza» under one picture of «Poze și hărți» (§978): that picture taken off the plan — asked first on the page, since
 * only uploading it again brings it back. The other pictures, the links, the points and the people are untouched; the stored
 * picture, used nowhere else, is the sweep's after its week (§73). A picture already gone answers «nimic de schimbat».
 */
export async function removePlanPictureAction(form: FormData): Promise<void> {
  await pressOnPlanMaps(form, async (actor, eventId) => {
    const result = await removeVolunteerPlanPicture(getDb(), actor, { eventId, id: field(form, "pictureId") }, new Date());
    await flashOutcome({ saved: result.changed ? "planPictureRemoved" : "volunteerUnchanged" });
  });
}

/**
 * «Adaugă linkul» in «Poze și hărți» on «Planul voluntarilor» (§978; the owner, 2026-11-18: «am facut spre exemplu un google
 * maps custom map si vreau sa pot pune url-ul»): an address and its optional label go last among the plan's links.
 *
 * The capability is asked here by name, at the door, before the service asks it again and holds what was typed to the rules.
 * A refusal does not redirect: it comes back as the form's own state (§315), so a wrong address names its box and what was
 * typed stays. A press that went through comes back to the fold, open, in the view it was pressed in, its outcome in the toast
 * and the form empty for the next link. It emails nobody and no public page reads the link.
 */
export async function addPlanLinkAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const view = viewOf(form);
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let changed: boolean;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    changed = (await addVolunteerPlanLink(getDb(), actor, { eventId, url: field(form, PLAN_LINK_BOXES.url), label: field(form, PLAN_LINK_BOXES.label) }, new Date())).changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const outcome = refused(error, form);
    return error instanceof PlanMapsRefusal ? { ...outcome, error: error.reason, errorValues: error.values } : outcome;
  }
  await flashOutcome({ saved: changed ? "planLinkAdded" : "volunteerUnchanged" });
  revalidatePath(path);
  redirect(planAddress(path, { view, savedIn: PLAN_SAVED.maps, hash: MAPS_ANCHOR }));
}

/**
 * «Șterge linkul» under one link of «Poze și hărți» (§978): that link taken off the plan — asked first on the page, naming it.
 * A link already gone answers «nimic de schimbat».
 */
export async function removePlanLinkAction(form: FormData): Promise<void> {
  await pressOnPlanMaps(form, async (actor, eventId) => {
    const result = await removeVolunteerPlanLink(getDb(), actor, { eventId, id: field(form, "linkId") }, new Date());
    await flashOutcome({ saved: result.changed ? "planLinkRemoved" : "volunteerUnchanged" });
  });
}

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
 * id and who pressed, and the toast after it says what left, to how many and when. The press comes back to the plan, in the
 * view it was pressed in, at its own fold, drawn open (`saved=`, §974) — the sentence saying how many messages were queued
 * (and how many people have no address) in the toast — or, refused, to the page's alert with the code in the address.
 */
export async function sendVolunteerPointsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  return inEmailPress("volunteers.sendPoints", async (press) => {
    const locale = localeOf(form);
    const eventId = eventIdOf(form);
    // A form with no event names no plan to come back to: the volunteers' own screen.
    if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
    const view = viewOf(form);
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
    redirect(refusal ? refusedAt(path, view, refusal) : planAddress(path, { view, savedIn: PLAN_SAVED.sent, hash: "plan-mail" }));
  });
}

/** Where «Șterge punctul» that went through comes back to: the plan's list, where the point no longer is and its people stand under «Fără punct». */
const LIST_ANCHOR = "plan-list";

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
 * went through comes back to its fold «Adaugă un punct», in the view it was pressed in, drawn open (`saved=`, §974), its
 * outcome in the toast and the form empty — the organizers add their points one after another; on «Pe puncte» the new point
 * is drawn open too, in its group (`open=`). It emails nobody and no public page reads the point.
 */
export async function addPlanPointAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const view = viewOf(form);
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let added: string;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    added = (await changePlanPoint(getDb(), actor, { kind: "add", eventId, ...planPointBoxes(form) }, new Date())).id;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const outcome = refused(error, form);
    return error instanceof PlanPointRefusal ? { ...outcome, error: error.reason, errorValues: error.values } : { ...outcome, error: planPointRefusalCode(error) };
  }
  await flashOutcome({ saved: "planPointAdded" });
  revalidatePath(path);
  redirect(planAddress(path, { view, open: added, savedIn: PLAN_SAVED.added, hash: "plan-points" }));
}

/**
 * «Salvează punctul» in a point's «Modifică punctul» on «Planul voluntarilor» (§961): a point of the plan's own changed —
 * its name, its kilometre, its coordinates, and whether it is on the route or at the start–finish — or, for one of the
 * event's «Puncte pe traseu», its coordinates alone: whatever else such a form posts is never read (its name and kilometre
 * are public, and are the editor's). The capability is asked here by name, at the door, and the service asks it again.
 *
 * A press that went through comes back to its point, in the view it was pressed in, the point and its group drawn open
 * (`open=`, §974), its outcome in the toast; a refused one — a name left empty, a kilometre that is no number, coordinates in
 * no shape read, the point deleted meanwhile, a role that may not — comes back to the page's alert (`#admin-alert`) with its
 * code in the address, as every press of this page does (§953). It emails nobody, and the people who stand at the point stay
 * there.
 */
export async function editPlanPointAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const view = viewOf(form, "points");
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
  redirect(refusal ? refusedAt(path, view, refusal, pointId) : planAddress(path, isUuid(pointId) ? { view, open: pointId, hash: `point-${pointId}` } : { view, hash: LIST_ANCHOR }));
}

/**
 * «Șterge punctul» on a point of the plan's own (§961) — asked first on the page, with the point's name and how many people
 * stand there: they stay on the plan, at no point. One of the event's «Puncte pe traseu» is not deleted here (the service
 * refuses it: it is deleted in the editor, where the event's page and the race number follow). The capability is asked here
 * by name, at the door, and the service asks it again and audits the removal with how many people it freed — never who.
 *
 * A press that went through comes back to the plan's list, in the view it was pressed in, where the point no longer is; a
 * refused one to the page's alert with its code (§953). It emails nobody: a person told that point by an earlier «Trimite
 * fiecăruia punctul lui» is told their new one by the next press, once they stand at one.
 */
export async function removePlanPointAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const eventId = eventIdOf(form);
  // A form with no event names no plan to come back to: the volunteers' own screen.
  if (!eventId) redirect(getPathname({ locale, href: "/admin/volunteers" }));
  const view = viewOf(form, "points");
  const pointId = field(form, "pointId");
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]/plan-voluntari", params: { id: eventId } } });

  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canManageVolunteers);
    await changePlanPoint(getDb(), actor, { kind: "remove", eventId, id: pointId }, new Date());
    await flashOutcome({ saved: "planPointRemoved" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = planPointRefusalCode(error);
  }
  revalidatePath(path);
  redirect(refusal ? refusedAt(path, view, refusal, pointId) : planAddress(path, { view, hash: LIST_ANCHOR }));
}
