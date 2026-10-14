import { z } from "zod";
import type { EventVolunteerSource, EventVolunteerState } from "@/db/schema/event-volunteers";
import { normalizeTeamText, resolveRichPair, richTextBox } from "@/modules/content/team/fields";
import { E164_PHONE } from "@/modules/registrations/phone";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { SEX_CHOICES } from "@/modules/registrations/domain/sex";
import { isValidEmail } from "@/modules/participants/domain/canonical-email";

/**
 * Volunteers for a race (§754; the owner, 2026-10-13: «I want to register volunteers for a race and
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
/** The role description's plain words, per language (§NNN): a list item counts for what it says, not for its JSON. */
export const VOLUNTEER_ROLE_DESCRIPTION_MAX = 2000;
/** What a person says about themselves (§NNN): the city's length is the database's, the age's range too. */
export const VOLUNTEER_CITY_MAX = 80;
export const VOLUNTEER_AGE_MAX = 100;
export const VOLUNTEER_NEEDED_MAX = 1000;
export const VOLUNTEER_NAME_MAX = 120;
export const VOLUNTEER_MESSAGE_MAX = 300;
export const VOLUNTEER_NOTE_MAX = 500;
/** How many roles one event may define: a list a person can read, and a bound on a forged form. */
export const VOLUNTEER_ROLES_MAX = 30;

/**
 * How old a volunteer must be (§758; the owner's brief of 2026-10-13: «volunteers must be 18 or older unless the
 * club decides otherwise»): the form's and the link page's «Am cel puțin 18 ani» and the agreement's
 * `{{minimumAge}}`. Romania's volunteering law lets a minor volunteer with a parent's consent; how the club
 * would take that consent is the lawyer's later question, so until then the platform takes adults only.
 */
export const VOLUNTEER_MINIMUM_AGE = 18;
// Since §NNN the typed age is what is checked against it (the public form, the organizers' entry); the link page keeps its tick.

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

/** A plain box of several lines (the description's plain twin, for a caller without the editor): trimmed, at most one empty line in a row. */
const plainBox = (max: number) => z.string().optional().default("").transform(normalizeTeamText).pipe(z.string().max(max));

/**
 * A role as the club types it: both names (the bilingual rule, §352 — never one language's name under the other's
 * page), how many people it needs, and optionally «Descrierea rolului» — what the person would do — in both
 * languages or neither (§NNN: the rich-text editor's document per language, `descriptionRoBody` /
 * `descriptionEnBody`; the plain boxes `descriptionRo` / `descriptionEn` are for a caller without the editor, a
 * script or a test, and read as paragraphs). No table and no picture: the description is read on a phone, under a
 * tick. The field names are the form's own `name`s, so a refusal's summary links to the box.
 *
 * Parsed, the description is its document and its plain words per language (`descriptionRoJson`,
 * `descriptionWordsRo`, …), or nulls — the FAQ's shape (§525, §474).
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
    descriptionRo: plainBox(VOLUNTEER_ROLE_DESCRIPTION_MAX),
    descriptionEn: plainBox(VOLUNTEER_ROLE_DESCRIPTION_MAX),
    descriptionRoBody: richTextBox,
    descriptionEnBody: richTextBox,
  })
  .transform((fields, ctx) => {
    const description = resolveRichPair(
      ctx,
      { ro: { plain: fields.descriptionRo, body: fields.descriptionRoBody }, en: { plain: fields.descriptionEn, body: fields.descriptionEnBody } },
      { ro: { plain: "descriptionRo", body: "descriptionRoBody" }, en: { plain: "descriptionEn", body: "descriptionEnBody" } },
      { max: VOLUNTEER_ROLE_DESCRIPTION_MAX, tables: false, what: "the role's description" },
    );
    return {
      nameRo: fields.nameRo,
      nameEn: fields.nameEn,
      needed: fields.needed,
      descriptionRoJson: description.ro.doc,
      descriptionEnJson: description.en.doc,
      descriptionWordsRo: description.ro.plain,
      descriptionWordsEn: description.en.plain,
    };
  });

export type VolunteerRoleInput = z.infer<typeof volunteerRoleInputSchema>;

const uuidField = z.uuid();

/**
 * What a person says about themselves (§NNN; the owner, 2026-10-14: «vârstă, sex, oraș și o bifă dacă a mai fost
 * voluntar sau nu»): the age in whole years — digits only, one to `VOLUNTEER_AGE_MAX`; whether it reaches
 * `VOLUNTEER_MINIMUM_AGE` is `refuseUnderage`, a second rule so the page can say which one failed — the sex as the
 * registration form's two answers, the city as one short line. Required on the public form, optional on the
 * organizers' entry (an empty box is null).
 */
const ageDigits = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().regex(/^\d{1,3}$/))
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1).max(VOLUNTEER_AGE_MAX));
const requiredAge = z.string().optional().default("").pipe(ageDigits);
const optionalAge = z
  .string()
  .optional()
  .default("")
  .transform((value) => value.trim())
  .pipe(z.union([z.literal(""), ageDigits]))
  .transform((value) => (value === "" ? null : value));
const requiredSex = z.string().optional().default("").pipe(z.enum(SEX_CHOICES));
const optionalSex = z
  .string()
  .optional()
  .default("")
  .pipe(z.union([z.literal(""), z.enum(SEX_CHOICES)]))
  .transform((value) => (value === "" ? null : value));
const requiredCity = z.string().optional().default("").pipe(line(VOLUNTEER_CITY_MAX));
const optionalCity = z.string().optional().default("").pipe(optionalLine(VOLUNTEER_CITY_MAX));
/** «Mărimea tricoului»: a size of the kit's list, or "" for none (null) — whether the event gives a shirt is the service's question. */
const shirtField = z
  .string()
  .optional()
  .default("")
  .pipe(z.union([z.literal(""), z.enum(SHIRT_SIZES)]))
  .transform((value) => (value === "" ? null : value));
/** A tick as the action reads it from the form: true only when posted. */
const tick = z.boolean().optional().default(false);

/**
 * A person typed younger than the platform takes (§NNN): one issue on the age's own box, so the refusal's summary
 * links to it; the page says «cel puțin 18 ani» rather than «scrie vârsta» by reading the typed age.
 */
export function refuseUnderage(ctx: z.RefinementCtx, age: number | null): void {
  if (age !== null && age < VOLUNTEER_MINIMUM_AGE) {
    ctx.addIssue({ code: "custom", path: ["age"], message: `volunteers must be at least ${VOLUNTEER_MINIMUM_AGE} years old` });
  }
}

/**
 * The roles a person ticked (§761): each an id, trimmed, the same one twice kept once, in the order posted — never
 * more than an event may define. Whether each is this event's is the service's question (it reads the event).
 */
const roleIdsField = z
  .array(z.string().transform((value) => value.trim()).pipe(uuidField))
  .max(VOLUNTEER_ROLES_MAX)
  .transform((ids) => [...new Set(ids)]);

/** The organizers' «Rolul dat»: a role's id, or "" for nobody placed yet (null). */
const assignedRoleField = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.union([z.literal(""), uuidField]))
  .transform((value) => (value === "" ? null : value));

/**
 * A person as an organizer types them: the same boxes as the public form, plus the organizers' own note — the roles
 * the person would do (`roleIds`, the ticks) and, optionally, the role the organizers give them (`assignedRoleId`,
 * which may be any of the event's, ticked or not). At least one of the two (`roleIds` named in the refusal); a
 * person entered with a role given and nothing ticked has that role as their one choice, so every row says what
 * the person offered (`choicesWithAssigned`).
 */
export const volunteerStaffInputSchema = z
  .object({
    roleIds: roleIdsField,
    assignedRoleId: assignedRoleField,
    name: line(VOLUNTEER_NAME_MAX),
    email: z
      .string()
      .trim()
      .max(320)
      .refine((value) => isValidEmail(value)),
    /** E.164, read from what the organizer typed by the registrations' own parser (`typedPhone`, in the action). */
    phone: z.string().regex(E164_PHONE),
    note: optionalLine(VOLUNTEER_NOTE_MAX),
    /** What the person told the organizers (§NNN): every box optional here, an age below the minimum refused. */
    age: optionalAge,
    sex: optionalSex,
    city: optionalCity,
    volunteeredBefore: tick,
    clubMember: tick,
    shirtSize: shirtField,
  })
  .superRefine((value, ctx) => {
    if (value.roleIds.length === 0 && value.assignedRoleId === null) {
      ctx.addIssue({ code: "custom", path: ["roleIds"], message: "tick at least one role, or give the person a role" });
    }
    refuseUnderage(ctx, value.age);
  });

export type VolunteerStaffInput = z.infer<typeof volunteerStaffInputSchema>;

/** The choices a staff entry keeps: what was ticked, or — nothing ticked — the role given, as the one choice. */
export function choicesWithAssigned(input: Pick<VolunteerStaffInput, "roleIds" | "assignedRoleId">): string[] {
  return input.roleIds.length > 0 ? input.roleIds : input.assignedRoleId ? [input.assignedRoleId] : [];
}

/** What every public sign-up posts, whatever the notice in force says (§761, §758). */
const publicBase = {
  roleIds: roleIdsField.pipe(z.array(z.string()).min(1)),
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
  /** «Am citit și accept contractul de voluntariat» (§758): the person's acceptance of the agreement in force, required. */
  agreement: z.literal(true),
  honeypot: z.string().max(2000).optional(),
  renderedAt: z.iso.datetime().optional(),
};

/**
 * The public form while the privacy notice in force does **not** name what a volunteer says about themselves
 * (§758's shape, unchanged): the consent, the agreement and «Am cel puțin 18 ani», each a tick that is the person's
 * own act, required; a minor's volunteering is a later question for the lawyer.
 */
export const volunteerPublicInputSchema = z.object({
  ...publicBase,
  /** «Am cel puțin 18 ani» (§758, `VOLUNTEER_MINIMUM_AGE`): required. */
  adult: z.literal(true),
});

export type VolunteerPublicInput = z.infer<typeof volunteerPublicInputSchema>;

/**
 * The public form while the notice in force names it (§NNN, `describesVolunteerProfile`; the owner, 2026-10-14):
 * «Vârsta» (whole years, at least `VOLUNTEER_MINIMUM_AGE` — the tick «Am cel puțin 18 ani» is gone, the age answers
 * it), «Sex» (the registration form's two answers), «Orașul», the optional ticks «Am mai fost voluntar în trecut la
 * alte curse» and «Fac parte din grupul {club}», and «Mărimea tricoului» — which the service keeps only while the
 * event gives a shirt.
 */
export const volunteerPublicProfileSchema = z
  .object({
    ...publicBase,
    age: requiredAge,
    sex: requiredSex,
    city: requiredCity,
    volunteeredBefore: tick,
    clubMember: tick,
    shirtSize: shirtField,
  })
  .superRefine((value, ctx) => refuseUnderage(ctx, value.age));

export type VolunteerPublicProfileInput = z.infer<typeof volunteerPublicProfileSchema>;

/** The schema a public post is read with: the profile's while the notice names it, §758's otherwise. */
export function volunteerPublicSchemaFor(profile: boolean) {
  return profile ? volunteerPublicProfileSchema : volunteerPublicInputSchema;
}

/** The field names a Zod refusal is about, in the form's own words (names only, never values). */
export function refusedFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "")).filter((name) => name !== ""))];
}

// ---------------------------------------------------------------------------------------------
// How a role stands
// ---------------------------------------------------------------------------------------------

/**
 * One role with the people counted against it: «N din M», what is still needed, and who is already confirmed.
 * Since §761 only the people the organizers **gave** the role count (`roleId`, the assigned role): an offer that
 * merely ticked it holds nothing — the card and the public form's «mai e nevoie de N» read the same number.
 */
export type RoleStanding = {
  roleId: string;
  needed: number;
  /** «Înscris» + «Confirmat» who were given the role: the people the role counts. */
  taken: number;
  confirmed: number;
  /** How many more the role needs; never below zero (an organizer may give it more people than it asked). */
  free: number;
};

export function standingOf(role: { id: string; needed: number }, volunteers: readonly { roleId: string | null; state: VolunteerState }[]): RoleStanding {
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
// The roles a person chooses (§761)
// ---------------------------------------------------------------------------------------------

/**
 * What a public sign-up keeps of the roles the person ticked: those that still need people, in the order ticked.
 * A role that filled while the form was open is dropped and the others are kept; an empty answer — every ticked
 * role filled — is the polite «full» with the roles still open (the service says it, the page lists them). A
 * ticked role that is not this event's is no role at all (`undefined` standing) and is the service's refusal,
 * never silently dropped here.
 */
export function openChoices(ticked: readonly string[], standings: ReadonlyMap<string, Pick<RoleStanding, "free">>): string[] {
  return ticked.filter((roleId) => (standings.get(roleId)?.free ?? 0) > 0);
}

/** A role's words as the agreement and the emails name it, in both languages. */
export type RoleWords = { nameRo: string; nameEn: string; descriptionRo: string | null; descriptionEn: string | null };

/**
 * A role's description as the agreement's sentence takes it: «Ce presupune rolul: {{volunteerTasks}}.» ends with
 * its own full stop, so the club's text — typed in the editor as a sentence, often with one — loses one closing
 * mark (after its spaces), never «…kilometrul 5..». The facts are frozen at acceptance, so this happens before
 * they are written. A text that is only punctuation reads as none, and its sentence is left out.
 */
export function tasksWords(description: string): string {
  // The description's plain words keep a line per paragraph and per list item (§NNN): in the agreement's sentence
  // they read as one, a line that ends a sentence followed by a space, any other by «; ».
  const lines = description
    .split(/\r?\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "");
  const flat = lines.map((part, index) => (index === lines.length - 1 ? part : /[.!?…;:]$/u.test(part) ? `${part} ` : `${part}; `)).join("");
  return flat.trim().replace(/[.!?…;]$/u, "").trimEnd();
}

/**
 * A role's description is shown folded behind «Detalii» when it runs past about three lines (§NNN): more than three
 * lines of plain words (a paragraph or a list item each) or more than `ROLE_DESCRIPTION_FOLD_CHARS` characters.
 * The plain words are the rule's input — a document's JSON says nothing about how long it reads.
 */
export const ROLE_DESCRIPTION_FOLD_CHARS = 200;
export const ROLE_DESCRIPTION_FOLD_LINES = 3;

export function descriptionNeedsFold(words: string | null | undefined): boolean {
  const text = (words ?? "").trim();
  if (text === "") return false;
  return text.length > ROLE_DESCRIPTION_FOLD_CHARS || text.split(/\r?\n/).filter((line) => line.trim() !== "").length > ROLE_DESCRIPTION_FOLD_LINES;
}

/** The first line of a description's plain words, and whether more follows: the card's role header shows the first and folds the rest. */
export function descriptionHead(words: string | null | undefined): { first: string; rest: string | null } {
  const lines = (words ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) return { first: "", rest: null };
  return { first: lines[0], rest: lines.length > 1 ? lines.slice(1).join("\n") : null };
}

/**
 * Whether two stored/typed descriptions are the same document (§NNN): read back from PostgreSQL's `jsonb` the keys come
 * in another order than the editor wrote them, so the comparison sorts them — a press that changes nothing must write
 * and audit nothing.
 */
export function sameDescription(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, inner]) => [key, canonical(inner)]),
          )
        : value;
  return JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));
}

/** The agreement's role blanks for one person: the role given and its tasks, or the roles chosen and what each asks. */
export type AgreementRoleValues = { role: string; tasks: string; choices: string; choiceTasks: string };

/**
 * The agreement's role blanks for one person (§761, amending §758), filled with the club's words only — the roles'
 * names and descriptions —, never a clause of the code's own: the sentences are the approved text's.
 *
 * - A role given: `{{volunteerRole}}` its name, `{{volunteerTasks}}` what it asks; the choices' fields "" (their
 *   sentences drop).
 * - None given, and the text in force names `{{volunteerRoleChoices}}` (`textNamesChoices`, the platform's template
 *   since §761): `{{volunteerRoleChoices}}` the chosen roles' names, «Masă, Traseu», `{{volunteerChoiceTasks}}` what
 *   each asks, «Masă — dă numerele; Traseu — arată drumul»; the role's fields "" (their sentences drop).
 * - None given under a text that does not (every version approved before): the chosen roles' names alone in
 *   `{{volunteerRole}}` — «… în rolul Masă, Traseu.» — and their tasks in `{{volunteerTasks}}` (one role: its
 *   description alone). `/admin/tasks`' row `volunteerRoleChoicesAgreement` asks the club for the new text meanwhile.
 *
 * A role with no description adds nothing to the tasks; none at all is "" and that sentence is left out.
 */
export function agreementRoleWords(
  roles: { assigned: RoleWords | null; chosen: readonly RoleWords[] },
  locale: "ro" | "en",
  textNamesChoices: boolean,
): AgreementRoleValues {
  const name = (role: RoleWords) => (locale === "en" ? role.nameEn : role.nameRo);
  const description = (role: RoleWords) => tasksWords((locale === "en" ? role.descriptionEn : role.descriptionRo) ?? "");
  if (roles.assigned) return { role: name(roles.assigned), tasks: description(roles.assigned), choices: "", choiceTasks: "" };
  const names = roleNames(roles.chosen, locale);
  const eachTasks = roles.chosen
    .filter((chosen) => description(chosen) !== "")
    .map((chosen) => `${name(chosen)} — ${description(chosen)}`)
    .join("; ");
  if (textNamesChoices) return { role: "", tasks: "", choices: names, choiceTasks: eachTasks };
  const tasks = roles.chosen.length === 1 ? description(roles.chosen[0]) : eachTasks;
  return { role: names, tasks, choices: "", choiceTasks: "" };
}

/** Roles' names as the agreement and the card name them: «Masă, Traseu», in the order given. */
export function roleNames(roles: readonly RoleWords[], locale: "ro" | "en"): string {
  return roles.map((role) => (locale === "en" ? role.nameEn : role.nameRo)).join(", ");
}

/**
 * The roles an accepted agreement named, from its blanks (`agreement_facts`): the roles chosen when the text named
 * them in their own sentence, else the role's blank — the role given, or the chosen roles' names under an earlier
 * text. Names only, so the card can show them and compare them.
 */
export function acceptedRoleNames(facts: { volunteerRole: string; volunteerRoleChoices?: string }): string {
  return facts.volunteerRoleChoices && facts.volunteerRoleChoices !== "" ? facts.volunteerRoleChoices : facts.volunteerRole;
}

/**
 * Whether the roles an accepted agreement names (`acceptedRoleNames`) still describe the person: the role given, by
 * name; or — while nobody gave them a role, or the role given is one they chose — the names of their choices as
 * they stand. Otherwise the card says the accepted text named other roles (§758): the acceptance stays valid, the
 * organizers talk it over.
 */
export function agreementStillNamesRole(
  accepted: string,
  person: { assigned: (RoleWords & { id: string }) | null; chosen: readonly (RoleWords & { id: string })[] },
  locale: "ro" | "en",
): boolean {
  if (person.assigned && accepted === roleNames([person.assigned], locale)) return true;
  const assignedChosen = person.assigned === null || person.chosen.some((role) => role.id === person.assigned?.id);
  return assignedChosen && person.chosen.length > 0 && accepted === roleNames(person.chosen, locale);
}

/**
 * What a desk's printed agreement names, as one string the card posts back with «Semnat pe hârtie» (§758): the role
 * given, or the roles chosen — so the record is refused (`VOLUNTEER_AGREEMENT_REPRINT`) when either changed since
 * the sheet was printed. Ids only, order-free.
 */
export function agreementRolesStamp(assignedRoleId: string | null, choiceIds: readonly string[]): string {
  return assignedRoleId ? `role:${assignedRoleId}` : `choices:${[...choiceIds].sort().join(",")}`;
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
  /** (d) A volunteer agreement is in force in every language (§758): nobody is listed without accepting one. */
  agreementInForce: boolean;
  /**
   * (e) The privacy notice in force also names `{{volunteerAgreement}}` in every language (§758): the acceptance
   * the form records — the version, the moment, the fingerprint, the age statement — is processing a notice from
   * §754's template does not describe.
   */
  noticeDescribesAgreement: boolean;
  /** The event is neither cancelled nor over: nobody offers to help at a race that is gone. */
  eventAhead: boolean;
  /** The event's page is published: an unpublished event has no public page to carry the form. */
  published: boolean;
  /** The event is for the members alone (§552): the form is public, so such a page never draws it. */
  membersOnly: boolean;
};

/** Why the form is not offered, in the order the page checks; null when it is. */
export type VolunteerOfferClosed = "off" | "notPublished" | "membersOnly" | "eventOver" | "noRoleNeeds" | "noNotice" | "noAgreement" | "noAgreementNotice";

/**
 * The form's conditions as one pure rule, so the page, the action, the editor's card and the tests read the
 * same: the event offers volunteering (a), at least one role still needs people (b), the privacy notice
 * in force describes volunteers (c), a volunteer agreement is in force (d, §758) and the notice describes its
 * acceptance (e, §758) — plus the event being
 * published, public (not for the members alone) and still ahead. The page draws the form only when this says
 * null; the action asks it again before it keeps a name; the card names the first condition missing.
 */
export function volunteerOfferClosedFor(inputs: VolunteerOfferInputs): VolunteerOfferClosed | null {
  if (!inputs.acceptsVolunteers) return "off";
  if (!inputs.published) return "notPublished";
  if (inputs.membersOnly) return "membersOnly";
  if (!inputs.eventAhead) return "eventOver";
  if (!someRoleNeedsPeople(inputs.standings)) return "noRoleNeeds";
  if (!inputs.noticeDescribes) return "noNotice";
  if (!inputs.agreementInForce) return "noAgreement";
  if (!inputs.noticeDescribesAgreement) return "noAgreementNotice";
  return null;
}

// ---------------------------------------------------------------------------------------------
// The volunteer agreement (§758)
// ---------------------------------------------------------------------------------------------

/**
 * Where a volunteer stands with the agreement, as the organizers' card says it:
 * - `accepted` — accepted (on the form, from the link, or on paper at the desk);
 * - `linkSent` — not yet, and a link to accept it is live in the person's mailbox;
 * - `notAccepted` — not yet, and no live link: «contract neacceptat încă».
 */
export type VolunteerAgreementStanding = "accepted" | "linkSent" | "notAccepted";

export function agreementStandingOf(
  volunteer: { agreementAcceptedAt: Date | null; agreementTokenExpiresAt: Date | null },
  now: Date,
): VolunteerAgreementStanding {
  if (volunteer.agreementAcceptedAt) return "accepted";
  if (volunteer.agreementTokenExpiresAt && volunteer.agreementTokenExpiresAt.getTime() > now.getTime()) return "linkSent";
  return "notAccepted";
}

/** The link page's two ticks: the agreement and the age, both the person's own act each time. */
export const volunteerAgreementAcceptSchema = z.object({
  agreement: z.literal(true),
  adult: z.literal(true),
  locale: z.enum(["ro", "en"]),
});

/**
 * Which roles the page's box lists, or null for no box at all: the roles that still need people while the form
 * is open; and, when the form closed only because the organizers gave the last place while the person typed (an
 * offer takes none, §761), an empty list for a person whose page is the answer to their own post — «am primit»,
 * «the role filled», or a refusal they came back to correct (invalid, captcha, limited) — so the box says «toate rolurile s-au umplut»
 * rather than vanishing without a sentence. A plain visit, and every other closed form, draws nothing.
 */
export function volunteerBoxRoles<R extends Pick<RoleStanding, "free">>(
  closed: VolunteerOfferClosed | null,
  roles: readonly R[],
  answer: "done" | "full" | "invalid" | "captcha" | "limited" | null,
): R[] | null {
  if (closed === null) return roles.filter((role) => role.free > 0);
  return closed === "noRoleNeeds" && answer !== null ? [] : null;
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
