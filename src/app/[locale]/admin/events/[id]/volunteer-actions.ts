"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { typedPhone } from "@/modules/registrations/answers";
import {
  changeVolunteer,
  changeVolunteerCategory,
  changeVolunteerRole,
  changeVolunteerRoles,
  setAcceptsVolunteers,
  setVolunteersAccess,
  setVolunteersShirts,
  setVolunteersShowCounts,
  type VolunteerCategoryRequest,
  type VolunteerRequest,
  type VolunteerRoleRequest,
  VolunteerRoleRowError,
  type VolunteerRolesRequest,
} from "@/modules/volunteers/volunteers";
import { setVolunteersListPublic } from "@/modules/volunteers/public-list";
import { VOLUNTEER_NEEDED_MAX, VOLUNTEER_ROLE_DESCRIPTION_MAX, VOLUNTEER_ROLE_NAME_MAX, VOLUNTEER_ROLES_MAX } from "@/modules/volunteers/domain/volunteer";
import { postedRoleRows } from "@/modules/volunteers/role-rows";
import { recordPaperVolunteerAgreement, requestVolunteerAgreement } from "@/modules/volunteers/agreement";
import { recordPaperVolunteerGuardian, requestVolunteerGuardian } from "@/modules/volunteers/guardian";
import { readVolunteersAccess, VOLUNTEER_INVITATION_BATCH_MAX, VOLUNTEER_INVITATION_MESSAGE_MAX, VolunteerInvitationRefusal } from "@/modules/volunteers/domain/access";
import { resendVolunteerInvitation, sendVolunteerInvitations, withdrawVolunteerInvitation } from "@/modules/volunteers/invitations";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, keptValuesOf, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  An event's volunteers (§754): the Server Actions behind the editor's «Voluntari» card. Each is a plain
  form that works with scripts off; every one asks the service, which asserts the role again (the
  Organizer and the Administrators read and write, nobody else sees the card — BR-REQ-060-01), so the
  buttons the card draws are a courtesy.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * Back to the card, with the toast's word in the flash cookie (§384) or, for a one-button form that has
 * no boxes to keep, the refusal's code in the address for the card's banner.
 */
async function backToCard(form: FormData, outcome: { saved?: string; error?: string; count?: string }): Promise<never> {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  if (outcome.saved) await flashOutcome({ saved: outcome.saved, ...(outcome.count ? { count: outcome.count } : {}) });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } });
  revalidatePath(path);
  const query = outcome.error ? `?volunteerError=${encodeURIComponent(outcome.error)}` : "";
  redirect(`${path}${query}#box-volunteers`);
}

/**
 * The telephone as the staff box posts it, read by the parser an Administrator's correction of a registration
 * uses (`typedPhone`): typed with the country code, or as a Romanian number — one E.164, or what was typed for
 * the schema to refuse on `phone`.
 */
function phoneOf(form: FormData): string {
  return typedPhone(field(form, "phone").trim());
}

const staffFields = (form: FormData) => ({
  // What the person would do (§761): every box ticked, one name, several values; and the role given, or "".
  roleIds: form.getAll("roleIds").filter((value): value is string => typeof value === "string"),
  assignedRoleId: field(form, "assignedRoleId"),
  name: field(form, "name"),
  email: field(form, "email"),
  phone: phoneOf(form),
  note: field(form, "note"),
  // What the person told the organizers (§765), all optional: the boxes as typed, the two ticks true only when posted. The date of
  // birth is what the card's box posts (§773, the registration form's own box); the service reads it as typed, day first, and derives the age.
  birthDate: field(form, "birthDate"),
  sex: field(form, "sex"),
  city: field(form, "city"),
  shirtSize: field(form, "shirtSize"),
  // The parent or guardian of a person under eighteen (§768): the name, and the address when the organizer has it.
  guardianName: field(form, "guardianName"),
  guardianEmail: field(form, "guardianEmail"),
  volunteeredBefore: form.get("volunteeredBefore") === "on",
  clubMember: form.get("clubMember") === "on",
  // «Vreau să apar pe lista publică a voluntarilor» (§821): the organizers' record of the person's own tick, true only when posted.
  listOptIn: form.get("listOptIn") === "on",
});

const categoryFields = (form: FormData) => ({ nameRo: field(form, "nameRo"), nameEn: field(form, "nameEn") });

/**
 * «Persoana de contact» of a category (§774): the three boxes as posted — the telephone read by the parser a staff member's box uses
 * (`typedPhone`: with the country code, or as a Romanian number; anything it cannot read stays as typed, for the schema's bound).
 */
const contactFields = (form: FormData) => ({
  contactName: field(form, "contactName"),
  contactPhone: typedPhone(field(form, "contactPhone").trim()),
  contactEmail: field(form, "contactEmail"),
});

async function runCategory(request: VolunteerCategoryRequest) {
  const actor = await requireStaff();
  return changeVolunteerCategory(getDb(), actor, request, new Date());
}

/** The one thing left of the single-role verbs: «Șterge rolul». Everything else about the roles is `runRoles`. */
async function runRole(request: VolunteerRoleRequest) {
  const actor = await requireStaff();
  return changeVolunteerRole(getDb(), actor, request, new Date());
}

async function runRoles(request: VolunteerRolesRequest) {
  const actor = await requireStaff();
  return changeVolunteerRoles(getDb(), actor, request, new Date());
}

async function runVolunteer(request: VolunteerRequest) {
  const actor = await requireStaff();
  return changeVolunteer(getDb(), actor, request, new Date());
}

/** «Pornește formularul public» / «Oprește formularul public»: the form posts the state it wants, never a toggle. */
export async function switchVolunteersAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setAcceptsVolunteers(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersOn" : "volunteersOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Oferim tricouri voluntarilor» (§765): the card's own tick, the event's `volunteers_shirts`. Its submit is drawn as the
 * checkbox and posts `on=1|0`, the state it wants, never a toggle.
 */
export async function switchVolunteersShirtsAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setVolunteersShirts(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersShirtsOn" : "volunteersShirtsOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Arată public câți voluntari mai sunt necesari» (§773): the card's third tick, the event's `volunteers_show_counts`, the same
 * submit drawn as the checkbox as the two above — it posts `on=1|0`, the state it wants, never a toggle.
 */
export async function switchVolunteersCountsAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setVolunteersShowCounts(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersCountsOn" : "volunteersCountsOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Cine se poate oferi» (§820): the card's radio group and its «Salvează». It posts the choice wanted — one of the three, a forged
 * value is refused by name — and the service saves it, audits it and tells the public cache. Changing it deletes nothing.
 */
export async function switchVolunteersAccessAction(form: FormData): Promise<void> {
  const access = readVolunteersAccess(form.get("access"));
  // A value that is none of the three is a forged post: refused by name, nothing saved.
  if (access === null) return backToCard(form, { error: "VALIDATION_ERROR" });
  try {
    const actor = await requireStaff();
    const result = await setVolunteersAccess(getDb(), actor, { eventId: eventIdOf(form), access }, new Date());
    return backToCard(form, { saved: result.changed ? "volunteersAccessSaved" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * The boxes a refusal points at: a line too long, both boxes of the pair; a line written in one language only, the empty one (§354, as the
 * other pairs of the editor name the language still owed); anything else, the addresses.
 */
function invitationRefusalFields(error: VolunteerInvitationRefusal, form: FormData): string[] {
  if (error.refusal === "VINVITE_MESSAGE_LONG") return ["messageRo", "messageEn"];
  if (error.refusal === "VINVITE_MESSAGE_ONE_LANGUAGE") return [field(form, "messageRo").trim() === "" ? "messageRo" : "messageEn"];
  return ["addresses"];
}

/** The refusals of the invitations' presses that say something to the person who pressed, with their sentence in `Admin.errors`. */
function invitationRefusalOutcome(error: VolunteerInvitationRefusal, form: FormData): FormOutcome {
  return {
    error: error.refusal,
    // The sentences' numbers and pieces: the lines that could not be read, and the bound the refusal names (`{max}`).
    errorValues: {
      ...(error.unread.length > 0 ? { addresses: error.unread.join(", ") } : {}),
      max: String(error.refusal === "VINVITE_TOO_MANY" ? VOLUNTEER_INVITATION_BATCH_MAX : VOLUNTEER_INVITATION_MESSAGE_MAX),
    },
    fields: invitationRefusalFields(error, form),
    values: keptValuesOf(form),
  };
}

/**
 * «Trimite invitațiile» (§820): the addresses typed, one per line, the club's optional line and the email's language. The service
 * asserts the role (the Organizer and the Administrators) and the choice «Doar cu invitație de la club»; a refusal comes back to the
 * form with what was typed, a send redirects to the card with the toast (how many went).
 */
export async function sendVolunteerInvitationsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let sent: { sent: number; alreadyInvited: number; alreadyOffered: number };
  try {
    const actor = await requireStaff();
    sent = await sendVolunteerInvitations(
      getDb(),
      actor,
      { eventId: eventIdOf(form), addresses: field(form, "addresses"), messageRo: field(form, "messageRo"), messageEn: field(form, "messageEn"), locale: field(form, "inviteLocale") === "en" ? "en" : "ro" },
      new Date(),
    );
  } catch (error) {
    if (error instanceof VolunteerInvitationRefusal) return invitationRefusalOutcome(error, form);
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "FORBIDDEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, sent.sent > 0 ? { saved: "volunteerInvitationsSent", count: String(sent.sent) } : { saved: "volunteerInvitationsNone" });
}

/** «Retrimite» (§820): another email with a new link; the earlier link stops working. A refusal is the card's banner. */
export async function resendVolunteerInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  try {
    const actor = await requireStaff();
    await resendVolunteerInvitation(getDb(), actor, field(form, "invitationId"), new Date());
  } catch (error) {
    if (error instanceof VolunteerInvitationRefusal) return backToCard(form, { error: error.refusal });
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerInvitationResent" });
}

/** «Retrage» (§820): the invitation ends now and its link says so. */
export async function withdrawVolunteerInvitationAction(_previous: unknown, form: FormData): Promise<null> {
  try {
    const actor = await requireStaff();
    await withdrawVolunteerInvitation(getDb(), actor, field(form, "invitationId"), new Date());
  } catch (error) {
    if (error instanceof VolunteerInvitationRefusal) return backToCard(form, { error: error.refusal });
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerInvitationWithdrawn" });
}

/**
 * «Lista voluntarilor e publică pe pagina evenimentului» (§821): the card's fourth tick, the event's `volunteers_list_public`, the same submit
 * drawn as the checkbox (`TickButton`) — it posts `on=1|0`, the state it wants, never a toggle.
 */
export async function switchVolunteersListAction(form: FormData): Promise<void> {
  const on = field(form, "on") === "1";
  try {
    const actor = await requireStaff();
    const result = await setVolunteersListPublic(getDb(), actor, { eventId: eventIdOf(form), on }, new Date());
    return backToCard(form, { saved: result.changed ? (on ? "volunteersListOn" : "volunteersListOff") : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Adaugă o categorie» (§774): both names. A refusal keeps what was typed (§315). */
export async function addVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runCategory({ kind: "add", eventId: eventIdOf(form), fields: categoryFields(form) });
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_NAME_TAKEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerCategoryAdded" });
}

/** «Salvează» under a category's «Modifică»: both names. */
export async function editVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runCategory({ kind: "edit", eventId: eventIdOf(form), id: field(form, "categoryId"), fields: categoryFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_NAME_TAKEN")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerCategorySaved" : "volunteerUnchanged" });
}

/** «Salvează» under a category's «Persoana de contact»: its own form, its own press. */
export async function saveVolunteerCategoryContactAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runCategory({ kind: "contact", eventId: eventIdOf(form), id: field(form, "categoryId"), fields: contactFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerCategoryContactSaved" : "volunteerUnchanged" });
}

/** The arrows on a category: one step up or down in the club's order. */
export async function moveVolunteerCategoryAction(form: FormData): Promise<void> {
  const direction = field(form, "direction") === "up" ? "up" : "down";
  try {
    const result = await runCategory({ kind: "move", eventId: eventIdOf(form), id: field(form, "categoryId"), direction });
    return backToCard(form, { saved: result.changed ? "volunteerCategoryMoved" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/** «Șterge categoria»: asks first (§384); a category with roles under it is refused, naming why (`VOLUNTEER_CATEGORY_HAS_ROLES`). */
export async function deleteVolunteerCategoryAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runCategory({ kind: "delete", eventId: eventIdOf(form), id: field(form, "categoryId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerCategoryDeleted" });
}

/**
 * What a refused row of «Salvează toate rolurile» says (§791): the role and its category in the sentence's placeholders, and the problem in
 * the club's words — computed here, in the language of the page the form came from, because only the action knows which row and why.
 */
async function rowRefusal(error: VolunteerRoleRowError, form: FormData): Promise<FormOutcome> {
  const locale = localeOf(form);
  const t = await getTranslations({ locale, namespace: "Admin.volunteers" });
  const max = { nameRoLong: VOLUNTEER_ROLE_NAME_MAX, nameEnLong: VOLUNTEER_ROLE_NAME_MAX, description: VOLUNTEER_ROLE_DESCRIPTION_MAX, tooMany: VOLUNTEER_ROLES_MAX, needed: VOLUNTEER_NEEDED_MAX } as const;
  const limit = (max as Record<string, number>)[error.problem] ?? 0;
  const category = (locale === "en" ? error.row.categoryEn : error.row.categoryRo) ?? t("otherCategory");
  return {
    ...refused(error, form),
    errorValues: {
      role: error.row.name === "" ? t("role.newRowName") : error.row.name,
      category,
      problem: t(`role.problems.${error.problem}`, { max: String(limit) }),
    },
  };
}

/**
 * «Salvează toate rolurile» (§791; the owner, 2026-10-16: «să pot face batch edit la roluri, nu să dau save de fiecare dată, ci un Save All»): every
 * role of the card — each category's rows and the blank row at its end — in one post, saved in one transaction (`changeVolunteerRoles`) or, when any
 * row is refused, none: the sentence names the role and its category, the boxes name what to correct, and every box keeps what was typed (§315).
 * The toast counts the roles saved.
 */
export async function saveVolunteerRolesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let saved: { changed: boolean; edited: number; created: number };
  try {
    saved = await runRoles({ eventId: eventIdOf(form), rows: postedRoleRows(form.entries()) });
  } catch (error) {
    if (error instanceof VolunteerRoleRowError) return rowRefusal(error, form);
    // A role another session deleted meanwhile is a refusal that keeps the boxes, like a name left empty.
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "NOT_FOUND")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, saved.changed ? { saved: "volunteerRolesSaved", count: String(saved.edited + saved.created) } : { saved: "volunteerRolesUnchanged" });
}

/** «Șterge rolul»: asks first (§384); a role with people on it is refused, naming why (`VOLUNTEER_ROLE_HAS_PEOPLE`). */
export async function deleteVolunteerRoleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runRole({ kind: "delete", eventId: eventIdOf(form), id: field(form, "roleId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerRoleDeleted" });
}

/** «Adaugă voluntarul»: a person the club enters by hand. */
export async function addVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runVolunteer({ kind: "add", eventId: eventIdOf(form), fields: staffFields(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backToCard(form, { saved: "volunteerAdded" });
}

/** «Salvează» under a volunteer's «Modifică»: every box, the role included. */
export async function editVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await runVolunteer({ kind: "edit", eventId: eventIdOf(form), id: field(form, "volunteerId"), fields: staffFields(form) })).changed;
  } catch (error) {
    if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "VOLUNTEER_ALREADY_LISTED")) return refused(error, form);
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: changed ? "volunteerSaved" : "volunteerUnchanged" });
}

/** «Confirmă», «Anulează» and «Reactivează»: the form posts the state it wants, never a toggle, so two presses end where the second aimed. */
export async function setVolunteerStateAction(form: FormData): Promise<void> {
  const state = field(form, "state");
  try {
    const result = await runVolunteer({ kind: "setState", eventId: eventIdOf(form), id: field(form, "volunteerId"), state });
    const saved = state === "CONFIRMED" ? "volunteerConfirmed" : state === "CANCELLED" ? "volunteerCancelled" : "volunteerReopened";
    return backToCard(form, { saved: result.changed ? saved : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Dă-i rolul …» (§761): one press gives a volunteer one role of the event — one of those they ticked, or another from
 * the select beside them. The form posts the role it wants, never a toggle; the service checks the role is this
 * event's, refuses a cancelled person, audits the change and emails the person the role.
 */
export async function assignVolunteerAction(form: FormData): Promise<void> {
  try {
    const result = await runVolunteer({ kind: "assign", eventId: eventIdOf(form), id: field(form, "volunteerId"), roleId: field(form, "roleId") });
    return backToCard(form, { saved: result.changed ? "volunteerAssigned" : "volunteerUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
}

/**
 * «Trimite linkul contractului» (§758): one email with the volunteer agreement and a single-use link to accept it,
 * for a person entered by hand. The service refuses while no agreement is in force, and for a person who has
 * accepted or was cancelled — each said in the card's banner.
 */
export async function requestVolunteerAgreementAction(form: FormData): Promise<void> {
  try {
    const actor = await requireStaff();
    await requestVolunteerAgreement(getDb(), actor, { eventId: eventIdOf(form), id: field(form, "volunteerId") }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerAgreementRequested" });
}

/**
 * «Semnat pe hârtie» (§758): asks first (§384), then records that the person signed the printed agreement at the
 * desk — the version in force, and who recorded it. A staff member records the person's signature, never gives one.
 */
export async function recordPaperVolunteerAgreementAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    await recordPaperVolunteerAgreement(
      getDb(),
      actor,
      {
        eventId: eventIdOf(form),
        id: field(form, "volunteerId"),
        // What the card's «PDF de semnat» printed: the service refuses when either changed since (§758).
        printed: { documentId: field(form, "agreementDocumentId"), roles: field(form, "agreementRoles") },
      },
      new Date(),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerAgreementRecorded" });
}

/**
 * «Trimite linkul părintelui» (§768): one email with the volunteer agreement and a single-use link to accept it in the
 * guardian's name, to the guardian's address. The service refuses while the club may not take minors, for a volunteer
 * who is not under eighteen, was cancelled, has no guardian address or whose guardian has accepted — each said in the
 * card's banner.
 */
export async function requestVolunteerGuardianAction(form: FormData): Promise<void> {
  try {
    const actor = await requireStaff();
    await requestVolunteerGuardian(getDb(), actor, { eventId: eventIdOf(form), id: field(form, "volunteerId") }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerGuardianRequested" });
}

/**
 * «Acordul părintelui pe hârtie» (§768): asks first (§384), then records that the guardian signed the printed agreement at
 * the desk — the version in force, and who recorded it. A staff member records the guardian's signature, never gives one.
 */
export async function recordPaperVolunteerGuardianAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaff();
    await recordPaperVolunteerGuardian(
      getDb(),
      actor,
      {
        eventId: eventIdOf(form),
        id: field(form, "volunteerId"),
        // What the card's «PDF de semnat de părinte» printed: the service refuses when either changed since.
        printed: { documentId: field(form, "agreementDocumentId"), roles: field(form, "agreementRoles") },
      },
      new Date(),
    );
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerGuardianRecorded" });
}

/** «Șterge»: asks first (§384) — a deleted volunteer is gone, and the audit row keeps no name. */
export async function deleteVolunteerAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    await runVolunteer({ kind: "delete", eventId: eventIdOf(form), id: field(form, "volunteerId") });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return backToCard(form, { error: error.code });
  }
  return backToCard(form, { saved: "volunteerDeleted" });
}
