import { z } from "zod";
import type { EventVolunteerSource, EventVolunteerState } from "@/db/schema/event-volunteers";
import { composePhone, E164_PHONE } from "@/modules/registrations/phone";
import { isValidEmail } from "@/modules/participants/domain/canonical-email";
import { refuseOneLanguage } from "@/shared/forms/both-languages";

/**
 * Volunteers for a race (§NNN; the owner, 2026-10-13: «I want to register volunteers for a race and
 * be able to define custom roles») — the pure part: the states, what a form may post, how a role
 * stands («N din M»), and the three conditions that open the public form.
 *
 * Pure and free of the database, so every rule here is unit-tested without one; `volunteers.ts`
 * beside this folder is the writer, the public read (`readPublicVolunteerRoles`) and the public sign-up.
 */

export const VOLUNTEER_STATES = ["REGISTERED", "CONFIRMED", "CANCELLED"] as const satisfies readonly EventVolunteerState[];
export type VolunteerState = EventVolunteerState;

export const VOLUNTEER_SOURCES = ["STAFF", "PUBLIC"] as const satisfies readonly EventVolunteerSource[];

/** The bounds the database holds too (`event_volunteer_roles` and `event_volunteers` checks). */
export const VOLUNTEER_ROLE_NAME_MAX = 80;
export const VOLUNTEER_ROLE_DESCRIPTION_MAX = 200;
export const VOLUNTEER_NEEDED_MAX = 1000;
export const VOLUNTEER_NAME_MAX = 120;
export const VOLUNTEER_MESSAGE_MAX = 300;
export const VOLUNTEER_NOTE_MAX = 500;
/** How many roles one event may define: a list a person can read, and a bound on a forged form. */
export const VOLUNTEER_ROLES_MAX = 30;

/** «Înscris» and «Confirmat» count against a role; «Anulat» never does. */
export function countsAgainstRole(state: VolunteerState): boolean {
  return state !== "CANCELLED";
}

// ---------------------------------------------------------------------------------------------
// Who may read and who may write (BR-REQ-060-01: asserted by the service, not by a hidden button)
// ---------------------------------------------------------------------------------------------
// `canManageVolunteers` lives with every other role predicate, in `staff-identity/domain/roles.ts`.

// ---------------------------------------------------------------------------------------------
// What a form posts
// ---------------------------------------------------------------------------------------------

/** A plain box: whitespace folded, trimmed. */
const line = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1).max(max));

/** An optional line: empty is null. */
const optionalLine = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/**
 * A role as the club types it: both names (the bilingual rule, §352 — never one language's name under the
 * other's page), how many people it needs, and optionally what the person would do, in both languages or
 * neither. The field names are the form's own `name`s, so a refusal's summary links to the box.
 */
export const volunteerRoleInputSchema = z
  .object({
    nameRo: line(VOLUNTEER_ROLE_NAME_MAX),
    nameEn: line(VOLUNTEER_ROLE_NAME_MAX),
    needed: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().regex(/^\d+$/))
      .transform((value) => Number(value))
      .pipe(z.number().int().min(1).max(VOLUNTEER_NEEDED_MAX)),
    descriptionRo: optionalLine(VOLUNTEER_ROLE_DESCRIPTION_MAX),
    descriptionEn: optionalLine(VOLUNTEER_ROLE_DESCRIPTION_MAX),
  })
  .superRefine((value, ctx) => {
    refuseOneLanguage(
      ctx,
      { ro: value.descriptionRo, en: value.descriptionEn },
      { ro: ["descriptionRo"], en: ["descriptionEn"] },
      "the role's description",
    );
  });

export type VolunteerRoleInput = z.infer<typeof volunteerRoleInputSchema>;

const uuidField = z.uuid();

/** A person as an organizer types them: the same boxes as the public form, plus the organizers' own note. */
export const volunteerStaffInputSchema = z.object({
  roleId: z.string().transform((value) => value.trim()).pipe(uuidField),
  name: line(VOLUNTEER_NAME_MAX),
  email: z
    .string()
    .trim()
    .max(320)
    .refine((value) => isValidEmail(value)),
  /** E.164, composed from the country and the national number by the action (`composePhone`). */
  phone: z.string().regex(E164_PHONE),
  note: optionalLine(VOLUNTEER_NOTE_MAX),
});

export type VolunteerStaffInput = z.infer<typeof volunteerStaffInputSchema>;

/** The public form: a person offering, with the consent tick that names the privacy notice. */
export const volunteerPublicInputSchema = z.object({
  roleId: z.string().transform((value) => value.trim()).pipe(uuidField),
  name: line(VOLUNTEER_NAME_MAX),
  email: z
    .string()
    .trim()
    .max(320)
    .refine((value) => isValidEmail(value)),
  phone: z.string().regex(E164_PHONE),
  message: optionalLine(VOLUNTEER_MESSAGE_MAX),
  locale: z.enum(["ro", "en"]),
  /** The one consent tick, naming the privacy notice: the person's own act, required (art. 7 GDPR). */
  consent: z.literal(true),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
});

export type VolunteerPublicInput = z.infer<typeof volunteerPublicInputSchema>;

/**
 * A telephone number as the organizers' boxes post it (no country list there): typed with its country code
 * (`+44 7911 123456`, `0044 …`) it is that country's; typed without one it is a Romanian number, as
 * `composePhone` reads it (the trunk zero dropped). One E.164 string, or "" for what cannot be dialled — which
 * the schema then refuses on `phone`. The public form has its country box and composes through the same function.
 */
export function composeVolunteerPhone(typed: string): string {
  const compact = typed.replace(/[\s().-]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  if (international.startsWith("+")) return E164_PHONE.test(international) ? international : "";
  return composePhone("RO", typed) ?? "";
}

/** The field names a Zod refusal is about, in the form's own words (names only, never values). */
export function refusedFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "")).filter((name) => name !== ""))];
}

// ---------------------------------------------------------------------------------------------
// How a role stands
// ---------------------------------------------------------------------------------------------

/** One role with the people counted against it: «N din M», what is still needed, and who is already confirmed. */
export type RoleStanding = {
  roleId: string;
  needed: number;
  /** «Înscris» + «Confirmat»: the people the role counts. */
  taken: number;
  confirmed: number;
  /** How many more the role needs; never below zero (an organizer may enter more than it asked). */
  free: number;
};

export function standingOf(role: { id: string; needed: number }, volunteers: readonly { roleId: string; state: VolunteerState }[]): RoleStanding {
  const mine = volunteers.filter((volunteer) => volunteer.roleId === role.id);
  const taken = mine.filter((volunteer) => countsAgainstRole(volunteer.state)).length;
  const confirmed = mine.filter((volunteer) => volunteer.state === "CONFIRMED").length;
  return { roleId: role.id, needed: role.needed, taken, confirmed, free: Math.max(0, role.needed - taken) };
}

/** Whether at least one role still needs people (the form's condition (b)). */
export function someRoleNeedsPeople(standings: readonly Pick<RoleStanding, "free">[]): boolean {
  return standings.some((standing) => standing.free > 0);
}

// ---------------------------------------------------------------------------------------------
// The three conditions of the public form
// ---------------------------------------------------------------------------------------------

export type VolunteerOfferInputs = {
  /** (a) The event's tick «Primește voluntari». */
  acceptsVolunteers: boolean;
  /** (b) The standing of each of the event's roles. */
  standings: readonly Pick<RoleStanding, "free">[];
  /** (c) The privacy notice in force names `{{volunteers}}` in every language. */
  noticeDescribes: boolean;
  /** The event is neither cancelled nor over: nobody offers to help at a race that is gone. */
  eventAhead: boolean;
};

/** Why the form is not offered, in the order the page checks; null when it is. */
export type VolunteerOfferClosed = "off" | "eventOver" | "noRoleNeeds" | "noNotice";

/**
 * The form's conditions as one pure rule, so the page, the action and the tests read the same: the
 * event offers volunteering (a), at least one role still needs people (b), and the privacy notice in
 * force describes volunteers (c) — plus the event still being ahead. The page draws the form only when
 * this says null; the action asks it again before it keeps a name.
 */
export function volunteerOfferClosedFor(inputs: VolunteerOfferInputs): VolunteerOfferClosed | null {
  if (!inputs.acceptsVolunteers) return "off";
  if (!inputs.eventAhead) return "eventOver";
  if (!someRoleNeedsPeople(inputs.standings)) return "noRoleNeeds";
  if (!inputs.noticeDescribes) return "noNotice";
  return null;
}

/**
 * Which roles the page's box lists, or null for no box at all: the roles that still need people while the form
 * is open; and, when the form closed only because the last place has just gone, an empty list for a person
 * whose page is the answer to their own post («am primit», or «the role filled») — that answer is still owed to
 * them, with no form to fill. Every other closed form draws nothing.
 */
export function volunteerBoxRoles<R extends Pick<RoleStanding, "free">>(
  closed: VolunteerOfferClosed | null,
  roles: readonly R[],
  answer: "done" | "full" | "invalid" | "captcha" | "limited" | null,
): R[] | null {
  if (closed === null) return roles.filter((role) => role.free > 0);
  return closed === "noRoleNeeds" && (answer === "done" || answer === "full") ? [] : null;
}

/**
 * Whether an event is still ahead: scheduled, and not past its end (or its start, with no end). An event
 * whose date is still to be announced (§533) has neither, and is ahead.
 */
export function volunteerEventAhead(event: { eventStatus: string; startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  if (event.eventStatus !== "SCHEDULED") return false;
  const over = event.endsAt ?? event.startsAt;
  return over === null || over.getTime() > now.getTime();
}

// ---------------------------------------------------------------------------------------------
// The one order
// ---------------------------------------------------------------------------------------------

/** The roles in the order the club set them, then by age: `position`, then `createdAt`, then the id (a total order). */
export function compareRoles(
  a: { position: number; createdAt: Date; id: string },
  b: { position: number; createdAt: Date; id: string },
): number {
  return a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}
