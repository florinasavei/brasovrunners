import { z } from "zod";
import { namesVolunteerGuardian } from "@/modules/legal-documents/domain/merge-fields";
import type { EventVolunteerSource, EventVolunteerState } from "@/db/schema/event-volunteers";
import type { RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { normalizeTeamText, resolveRichPair, richTextBox } from "@/modules/content/team/fields";
import { isPhoneNumberShaped } from "@/modules/contact/domain/public-phone";
import { E164_PHONE, formatPhone } from "@/modules/registrations/phone";
import { ageOn, dayIn, latestBirthDateFor } from "@/modules/registrations/domain/age";
import { SHIRT_SIZES } from "@/modules/registrations/domain/kit";
import { isDateValue, normalizeTypedDate } from "@/shared/forms/pickers/wall-values";
import { SEX_CHOICES } from "@/modules/registrations/domain/sex";
import { canonicalizeEmail, isValidEmail } from "@/modules/participants/domain/canonical-email";

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
/** The role description's plain words, per language (§765): a list item counts for what it says, not for its JSON. */
export const VOLUNTEER_ROLE_DESCRIPTION_MAX = 2000;
/** What a person says about themselves (§765): the city's length is the database's, the age's range too. */
export const VOLUNTEER_CITY_MAX = 80;
export const VOLUNTEER_AGE_MAX = 100;
/** The guardian's name (§768): the volunteer's own bound. */
export const VOLUNTEER_GUARDIAN_NAME_MAX = 120;
export const VOLUNTEER_NEEDED_MAX = 1000;
export const VOLUNTEER_NAME_MAX = 120;
export const VOLUNTEER_MESSAGE_MAX = 300;
export const VOLUNTEER_NOTE_MAX = 500;
/** How many roles one event may define: a list a person can read, and a bound on a forged form. */
export const VOLUNTEER_ROLES_MAX = 30;
/** How many categories one event may define (§774): headings a person can read on a phone, and a bound on a forged form. */
export const VOLUNTEER_CATEGORIES_MAX = 12;
/** The category's contact person (§774): the name's own bound is the volunteer's, the telephone's and the address's are the database's. */
export const VOLUNTEER_CONTACT_PHONE_MAX = 40;
export const VOLUNTEER_CONTACT_EMAIL_MAX = 320;

/**
 * How old a volunteer must be (§768; the owner, 2026-10-14: «voluntarii trebuie să aibă cel puțin 14 ani, nu 18»,
 * replacing §758's eighteen): the age box's floor on the public form and on the organizers' entry, and the agreement's
 * `{{minimumAge}}`. One constant of the platform, not a club setting: the club did not ask to vary it, and a lower or
 * higher number is Legea nr. 78/2014's question, which a lawyer answers — a change is one line and a release.
 * From this age to `VOLUNTEER_ADULT_AGE` a volunteer is taken only with a parent's or guardian's agreement
 * (`isVolunteerMinor`, the guardian's boxes, the link and the paper record).
 */
export const VOLUNTEER_MINIMUM_AGE = 14;
/** Of age: a volunteer under it needs a parent or guardian (§768); the agreement link's tick «Am cel puțin 18 ani» says it for a person with no age typed. */
export const VOLUNTEER_ADULT_AGE = 18;

/**
 * Whether the guardian's address is the volunteer's own mailbox, through the canonicalizer (§10.4): a person of fourteen with no
 * mailbox of their own may use their parent's (§389: a family on one address), so it is no refusal — the card marks it, and the
 * organizer's confirm, the human check, sees it. False when either address is missing or cannot be read.
 */
export function guardianSharesAddress(volunteerEmail: string, guardianEmail: string | null): boolean {
  if (!guardianEmail) return false;
  try {
    return canonicalizeEmail(volunteerEmail).canonicalEmail === canonicalizeEmail(guardianEmail).canonicalEmail;
  } catch {
    return false;
  }
}

/**
 * The age `{{minimumAge}}` says in a volunteer agreement being read (§768). A text that carries the minors' clause
 * (`{{volunteerGuardian}}`) is one the club approved knowing a person from fourteen volunteers with a parent: it says
 * `VOLUNTEER_MINIMUM_AGE`. A text approved under §758 says nothing of a guardian and the platform takes only adults
 * under it, so it keeps saying eighteen until the club approves a version from the new template — a text in force
 * never moves under the people who accept it. Pure.
 */
export function agreementMinimumAge(body: unknown): number {
  return namesVolunteerGuardian(body) ? VOLUNTEER_MINIMUM_AGE : VOLUNTEER_ADULT_AGE;
}

/** Whether an age typed says a minor: a number under eighteen. No age (an adult's hand entry, a row from before) is never a minor. */
export function isVolunteerMinor(age: number | null | undefined): boolean {
  return typeof age === "number" && age < VOLUNTEER_ADULT_AGE;
}

/**
 * The calendar day a volunteer's age is judged on (§773; the owner, 2026-10-14: «în loc de vârstă vreau să treacă data
 * nașterii»): the day of the race's gun when the event has one, else the event's own day — in the event's own zone, as the
 * registration form counts (`formViewOf`) — so a person who turns fourteen on the morning of the race may offer today. An
 * event whose date is still to be announced has no such day: today stands for it, and the age is judged again at the next
 * save. An event whose **time alone** is to be announced has one — the public row hides the instant but carries `announcedDay`,
 * the day on the event's own calendar — so the page and the service count on the same day. Pure.
 */
export function volunteerEventDay(
  event: {
    startsAt: Date | null;
    raceStartsAt?: Date | null;
    timezone?: string | null;
    dateToBeAnnounced?: boolean | null;
    announcedDay?: string | null;
  },
  now: Date,
): string {
  const zone = event.timezone || "Europe/Bucharest";
  if (event.dateToBeAnnounced === true) return dayIn(now, zone);
  const at = event.raceStartsAt ?? event.startsAt;
  if (at) return dayIn(at, zone);
  return event.announcedDay || dayIn(now, zone);
}

/** The youngest birth date a volunteer may give: the latest day that still makes `VOLUNTEER_MINIMUM_AGE` on the event's day. */
export function latestVolunteerBirthDate(eventDay: string): string {
  return latestBirthDateFor(VOLUNTEER_MINIMUM_AGE, eventDay);
}

/** The oldest: the earliest day that does not make more than `VOLUNTEER_AGE_MAX` on the event's day (a hundred and one is the day before it). */
export function earliestVolunteerBirthDate(eventDay: string): string {
  const over = new Date(`${latestBirthDateFor(VOLUNTEER_AGE_MAX + 1, eventDay)}T00:00:00Z`);
  over.setUTCDate(over.getUTCDate() + 1);
  return over.toISOString().slice(0, 10);
}

/**
 * The age a birth date gives on the event's day, or null for something that is no calendar day. Negative for a date after the
 * event: the form refuses it on the box. A born-on-29-February person turns a year older on 1 March in a common year, as every
 * age here is counted (`ageOn`).
 */
export function volunteerAgeOn(birthDate: string, eventDay: string): number | null {
  // 30 February is no day: `ageOn` would roll it into March and give an age to a date the form refuses.
  return isDateValue(birthDate) ? ageOn(birthDate, eventDay) : null;
}

/**
 * The age a form's date box says on the event's day. An **empty** box on the organizers' entry (`null`, the parsed value) says what
 * the row already held when it has an age and no date (`kept`: a row from before §773); a box that was refused, or never posted
 * (`undefined`), says nothing — no guardian is asked for an age nobody could read.
 */
function ageOfBox(birthDate: unknown, eventDay: string, kept: number | null): number | null {
  if (typeof birthDate === "string" && birthDate !== "") return volunteerAgeOn(birthDate, eventDay);
  return birthDate === null ? kept : null;
}

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

/** A role's number as typed: a whole number from 1 to `VOLUNTEER_NEEDED_MAX`, else `undefined` (the box's refusal). */
export function roleNeededFrom(typed: string): number | undefined {
  if (!/^\d+$/.test(typed)) return undefined;
  const number = Number(typed);
  return Number.isInteger(number) && number >= 1 && number <= VOLUNTEER_NEEDED_MAX ? number : undefined;
}

/**
 * A role as the club types it: both names (the bilingual rule, §352 — never one language's name under the other's
 * page), how many people it needs, and optionally «Descrierea rolului» — what the person would do — in both
 * languages or neither (§765: the rich-text editor's document per language, `descriptionRoBody` /
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
    // «Câți oameni trebuie» as typed, and «Fără număr — oricâți oameni» (§782): the tick posts `on`. The server decides by the tick —
    // a ticked role has no number whatever the box holds (a form without scripts keeps the box, a forged post may fill it).
    needed: z.string().optional().default("").transform((value) => value.trim()),
    unlimited: z.string().optional().default(""),
    descriptionRo: plainBox(VOLUNTEER_ROLE_DESCRIPTION_MAX),
    descriptionEn: plainBox(VOLUNTEER_ROLE_DESCRIPTION_MAX),
    descriptionRoBody: richTextBox,
    descriptionEnBody: richTextBox,
  })
  .transform((fields, ctx) => {
    // No picture and no video: the description is read on a phone, under a tick (and a picture-only body has no plain
    // words, which the table's CHECK refuses — a forged post must be a refusal here, never a 500 there).
    for (const [body, name] of [
      [fields.descriptionRoBody, "descriptionRoBody"],
      [fields.descriptionEnBody, "descriptionEnBody"],
    ] as const) {
      if (body !== undefined && hasMedia(body)) {
        ctx.addIssue({ code: "custom", path: [name], message: "the role's description may not hold a picture or a video" });
      }
    }
    const description = resolveRichPair(
      ctx,
      { ro: { plain: fields.descriptionRo, body: fields.descriptionRoBody }, en: { plain: fields.descriptionEn, body: fields.descriptionEnBody } },
      { ro: { plain: "descriptionRo", body: "descriptionRoBody" }, en: { plain: "descriptionEn", body: "descriptionEnBody" } },
      { max: VOLUNTEER_ROLE_DESCRIPTION_MAX, tables: false, what: "the role's description" },
    );
    // A side with no plain words is no description: the document and the words are both set or both null (the CHECK).
    const kept = (side: { doc: RichTextDoc | null; plain: string | null }) => (side.plain === null ? { doc: null, plain: null } : side);
    const ro = kept(description.ro);
    const en = kept(description.en);
    // NULL is «fără număr» (§782): the tick, or a whole number of at least one — neither is the refusal at the number's box.
    const typed = fields.unlimited === "on" ? null : roleNeededFrom(fields.needed);
    if (typed === undefined) ctx.addIssue({ code: "custom", path: ["needed"], message: "a role needs a number of people, at least 1, or «fără număr»" });
    return {
      nameRo: fields.nameRo,
      nameEn: fields.nameEn,
      needed: typed ?? null,
      descriptionRoJson: ro.doc,
      descriptionEnJson: en.doc,
      descriptionWordsRo: ro.plain,
      descriptionWordsEn: en.plain,
    };
  });

/**
 * A category as the club types it (§774): both names — the bilingual rule, never one language's heading under the other's page.
 * The field names are the form's own `name`s, so a refusal's summary links to the box.
 */
export const volunteerCategoryInputSchema = z.object({
  nameRo: line(VOLUNTEER_ROLE_NAME_MAX),
  nameEn: line(VOLUNTEER_ROLE_NAME_MAX),
});

export type VolunteerCategoryInput = z.infer<typeof volunteerCategoryInputSchema>;

/**
 * «Persoana de contact» of a category (§774): a name, a telephone number and an address, each optional and empty until the club
 * fills them («the contact person for each category will be established later»). The address is read as an address; the telephone is
 * what the card's box posted after `typedPhone` (E.164 when it can be read, else as typed) and is bounded and must be written like a telephone number (`isPhoneNumberShaped`, the check «Telefon public» and the badge share) — so a foreign
 * or a landline number passes, and words do not: a dead `tel:` link and a badge line that silently vanishes are what the check prevents.
 */
export const volunteerCategoryContactSchema = z.object({
  contactName: optionalLine(VOLUNTEER_NAME_MAX),
  contactPhone: optionalLine(VOLUNTEER_CONTACT_PHONE_MAX).refine((value) => value === null || isPhoneNumberShaped(value)),
  contactEmail: optionalLine(VOLUNTEER_CONTACT_EMAIL_MAX).refine((value) => value === null || isValidEmail(value)),
});

export type VolunteerCategoryContactInput = z.infer<typeof volunteerCategoryContactSchema>;

/** The three boxes of a category's contact, as the database holds them. */
export type CategoryContactColumns = { contactName: string | null; contactPhone: string | null; contactEmail: string | null };

/** A category's contact person as the pages and the emails read it: the three words, or null while the club has set none of them. */
export type CategoryContact = { name: string | null; phone: string | null; email: string | null };

export function categoryContactOf(columns: CategoryContactColumns): CategoryContact | null {
  const contact = { name: columns.contactName, phone: columns.contactPhone, email: columns.contactEmail };
  return contact.name === null && contact.phone === null && contact.email === null ? null : contact;
}

/**
 * A contact's words in their order — the name, the telephone, the address — leaving out what is not set: «Ana · +40 712 345 678 ·
 * ana@club.test». The telephone is read as a person reads it (`formatPhone`, grouped), never as it is stored (E.164); its `tel:`
 * link takes the stored digits.
 */
export function contactParts(contact: CategoryContact): string[] {
  return [contact.name, contact.phone === null ? null : formatPhone(contact.phone), contact.email].filter(
    (part): part is string => part !== null && part !== "",
  );
}

export type CategoryContactOf = CategoryContact & { categoryRo?: string; categoryEn?: string };

type ContactRole = { contact?: CategoryContact | null; categoryRo?: string | null; categoryEn?: string | null };

/**
 * The contact persons a volunteer's message names (§774): the one of the category of the role the organizers gave, else those of the
 * categories of the roles the person offered for — each once, in the club's order, and none for a role under no category or a
 * category with no contact set. The volunteer's emails (received, role given, the guardian's request) say them in their footer.
 */
export function volunteerContactsOf(roles: { assigned: ContactRole | null; chosen: readonly ContactRole[] }): CategoryContactOf[] {
  const concerned = roles.assigned ? [roles.assigned] : roles.chosen;
  const seen = new Set<string>();
  const contacts: CategoryContactOf[] = [];
  for (const { contact, categoryRo, categoryEn } of concerned) {
    if (!contact) continue;
    const key = JSON.stringify(contact);
    if (seen.has(key)) continue;
    seen.add(key);
    // The category's name rides along so a message naming two persons can say whose each is.
    contacts.push(categoryRo && categoryEn ? { ...contact, categoryRo, categoryEn } : contact);
  }
  return contacts;
}

/** The categories in the order the club set them: `sort`, then age, then the id (a total order), as the roles' own. */
export function compareCategories(
  a: { sort: number; createdAt: Date; id: string },
  b: { sort: number; createdAt: Date; id: string },
): number {
  return a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** One heading of the card or the form: a category (null is «Alte activități», the roles with none) and its roles, in their order. */
export type RoleGroup<C, R> = { category: C | null; roles: R[] };

/**
 * An event's roles under their categories (§774), in the order the club set the categories (`categories` arrives sorted); the roles
 * keep the order they come in. The roles with no category — or one that is not in the list — are the last group, `category: null`.
 * A category with no role is a group with none (the card shows it, to add one; the public form leaves it out, `withRoles`).
 * An event with no category at all is one group with `category: null`: callers draw no heading for it (`groupsNeedHeadings`).
 */
export function groupRolesByCategory<C extends { id: string }, R extends { categoryId: string | null }>(
  categories: readonly C[],
  roles: readonly R[],
  options: { withRoles?: boolean } = {},
): RoleGroup<C, R>[] {
  const known = new Set(categories.map((category) => category.id));
  const groups: RoleGroup<C, R>[] = categories.map((category) => ({ category, roles: roles.filter((role) => role.categoryId === category.id) }));
  const loose = roles.filter((role) => role.categoryId === null || !known.has(role.categoryId));
  const all: RoleGroup<C, R>[] = loose.length > 0 || categories.length === 0 ? [...groups, { category: null, roles: [...loose] }] : groups;
  return options.withRoles ? all.filter((group) => group.roles.length > 0) : all;
}

/**
 * An event's roles in the order the card lists them — under their categories, in the club's order (`groupRolesByCategory`) — each with
 * the words of its category (§774), ready for `roleLabel`: the role's own words stay as they are, `categoryRo` / `categoryEn` are null
 * for a role under none.
 */
export function rolesWithCategoryWords<R extends { categoryId: string | null }>(
  categories: readonly { id: string; nameRo: string; nameEn: string }[],
  roles: readonly R[],
): (R & { categoryRo: string | null; categoryEn: string | null })[] {
  return groupRolesByCategory(categories, roles).flatMap((group) =>
    group.roles.map((role) => ({ ...role, categoryRo: group.category?.nameRo ?? null, categoryEn: group.category?.nameEn ?? null })),
  );
}

/** Whether a heading is drawn for the groups: not when there is no category at all, whose roles are simply listed. */
export function groupsNeedHeadings(groups: readonly RoleGroup<unknown, unknown>[]): boolean {
  return groups.some((group) => group.category !== null);
}

/** Whether a document holds a picture or a video block (top-level blocks, `schema.ts`). */
function hasMedia(doc: RichTextDoc): boolean {
  return (doc.content ?? []).some((block) => block.type === "image" || block.type === "youtube");
}

export type VolunteerRoleInput = z.infer<typeof volunteerRoleInputSchema>;

const uuidField = z.uuid();

/**
 * What a person says about themselves (§765; the owner, 2026-10-14: «vârstă, sex, oraș și o bifă dacă a mai fost
 * voluntar sau nu»; since §773 «în loc de vârstă vreau să treacă data nașterii»): the **date of birth** — the registration
 * form's own box, typed day first and read by `normalizeTypedDate` — whose age on the event's day (`volunteerEventDay`) is at
 * least `VOLUNTEER_MINIMUM_AGE` and at most `VOLUNTEER_AGE_MAX` (a rule of the box itself, so a refusal names it together with
 * the other boxes that failed; the page says «cel puțin 14 ani» rather than «scrie data» by reading the typed date) — the sex as
 * the registration form's two answers, the city as one short line. Required on the public form, optional on the organizers'
 * entry (an empty box is null). The age every rule reads (`isVolunteerMinor`, the guardian, the agreement) is the date's, derived
 * on the event's day and kept in the `age` column beside it.
 */
function birthDateBox(eventDay: string) {
  return z
    .string()
    .transform((value) => normalizeTypedDate(value))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    // A day that does not exist (30 February) passes the shape and would roll over in `ageOn`: refused on the box, as the registration form's `z.iso.date` does.
    .refine((day) => isDateValue(day))
    .refine(
      (day) => {
        const age = ageOn(day, eventDay);
        return age !== null && age >= VOLUNTEER_MINIMUM_AGE && age <= VOLUNTEER_AGE_MAX;
      },
      { message: `volunteers must be from ${VOLUNTEER_MINIMUM_AGE} to ${VOLUNTEER_AGE_MAX} years old on the event's day` },
    );
}
const requiredBirthDate = (eventDay: string) => z.string().optional().default("").pipe(birthDateBox(eventDay));
const optionalBirthDate = (eventDay: string) =>
  z
    .string()
    .optional()
    .default("")
    .transform((value) => value.trim())
    .pipe(z.union([z.literal(""), birthDateBox(eventDay)]))
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
 * The guardian of a volunteer under eighteen (§768), as a form posts the two boxes: whatever was typed, judged together
 * with the age by `refuseGuardianBoxes` — an adult's boxes (or no age) are dropped, never kept.
 */
const guardianNameBox = z.string().optional().default("");
const guardianEmailBox = z.string().optional().default("");

/** One name as the forms keep it: whitespace folded, trimmed. */
function foldedName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** What the guardian's boxes came to for the age typed: the guardian as kept (or none), and which boxes are refused. */
type GuardianVerdict = { guardian: { name: string; email: string | null } | null; badName: boolean; badEmail: boolean };

/** What the guardian's boxes are judged against: the event's day, and the age a row from before holds when its date box is empty. */
type AgeBasis = { eventDay: string; kept: number | null };

/**
 * What the guardian's two boxes mean for the age the date of birth gives on the event's day (§768, §773), pure:
 * - **eighteen or older, or no age** — the boxes are dropped (`null`): nobody keeps a third person's data for an adult;
 * - **a minor, `address: "required"` (the public form)** — the name (`guardianName`) and a valid address
 *   (`guardianEmail`); the volunteer's tick that the parent knows and agrees is the schema's own (`guardianAware`);
 * - **a minor, `address: "optional"` (the organizers' entry)** — the name, and the address only if typed: the consent
 *   may be taken on paper at the desk, which needs no address.
 *
 * Read from the values a failed parse may leave (a box missing, a date that is no date, one under the floor already
 * refused on its own box): none of those is a minor the guardian is asked for.
 */
function judgeGuardian(value: { birthDate?: unknown; guardianName?: unknown; guardianEmail?: unknown }, address: "required" | "optional", basis: AgeBasis): GuardianVerdict {
  const age = ageOfBox(value.birthDate, basis.eventDay, basis.kept);
  if (!isVolunteerMinor(age) || age === null || age < VOLUNTEER_MINIMUM_AGE) return { guardian: null, badName: false, badEmail: false };
  const name = foldedName(typeof value.guardianName === "string" ? value.guardianName : "");
  const email = (typeof value.guardianEmail === "string" ? value.guardianEmail : "").trim();
  const badName = name === "" || name.length > VOLUNTEER_GUARDIAN_NAME_MAX;
  const badEmail = (address === "required" || email !== "") && (email.length > 320 || !isValidEmail(email));
  return { guardian: badName || badEmail ? null : { name, email: email === "" ? null : email }, badName, badEmail };
}

/**
 * Names each guardian box the age typed makes refused, as zod refinements that run **even when another box was refused**
 * (`when`): a person refused for «sex» is told about the parent's boxes in the same pass, not on a second try. The result
 * is shaped by `guardianOf` in the schema's own `transform`.
 */
function refuseGuardianBoxes<S extends z.ZodType>(schema: S, address: "required" | "optional", basis: AgeBasis): S {
  const always = () => true;
  return schema
    .refine((value) => !judgeGuardian(value as never, address, basis).badName, { path: ["guardianName"], message: "a volunteer under eighteen needs a parent's or guardian's name", when: always })
    .refine((value) => !judgeGuardian(value as never, address, basis).badEmail, { path: ["guardianEmail"], message: "a volunteer under eighteen needs the parent's or guardian's address", when: always }) as unknown as S;
}

/** The guardian as kept for a parse that passed, or null (an adult, no age): the one thing the schemas' `transform` shapes. */
function guardianOf(value: { birthDate: string | null; guardianName: string; guardianEmail: string }, address: "required" | "optional", basis: AgeBasis): { name: string; email: string | null } | null {
  return judgeGuardian(value, address, basis).guardian;
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
const volunteerStaffInputBase = (eventDay: string) =>
  z
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
    /** What the person told the organizers (§765): every box optional here, a date that gives an age below the minimum on the event's day refused (§773). */
    birthDate: optionalBirthDate(eventDay),
    sex: optionalSex,
    city: optionalCity,
    volunteeredBefore: tick,
    clubMember: tick,
    shirtSize: shirtField,
    /** The parent or guardian of a volunteer under eighteen (§768): the name, and the address only if typed (the consent may be on paper). */
    guardianName: guardianNameBox,
    guardianEmail: guardianEmailBox,
  })
  .superRefine((value, ctx) => {
    if (value.roleIds.length === 0 && value.assignedRoleId === null) {
      ctx.addIssue({ code: "custom", path: ["roleIds"], message: "tick at least one role, or give the person a role" });
    }
  });

/**
 * The organizers' entry (§765, §773): the guardian's boxes refused with the rest, then folded into one `guardian` (an adult's
 * dropped), and the **age** derived from the date of birth on `eventDay` — `volunteerEventDay`, the event's own day — beside it.
 * `keptAge` is what a row from before the date held: an empty date box on it keeps that age, so saving a phone number of a person
 * of sixteen never turns them into an adult with no guardian; `null` for a new entry and for a row that has a date.
 */
export function volunteerStaffInputSchemaFor(eventDay: string, keptAge: number | null = null) {
  const basis: AgeBasis = { eventDay, kept: keptAge };
  return refuseGuardianBoxes(volunteerStaffInputBase(eventDay), "optional", basis).transform((value) => {
    // An age under eighteen needs its guardian; any other age keeps none. The two boxes are read here and leave the result.
    const { guardianName, guardianEmail, ...rest } = value;
    return { ...rest, age: ageOfBox(value.birthDate, eventDay, keptAge), guardian: guardianOf({ birthDate: value.birthDate, guardianName, guardianEmail }, "optional", basis) };
  });
}

export type VolunteerStaffInput = z.infer<ReturnType<typeof volunteerStaffInputSchemaFor>>;

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
 * The public form while the notice in force names it (§765, `describesVolunteerProfile`; the owner, 2026-10-14):
 * «Data nașterii» (§773, instead of «Vârsta»: the age on the event's day is at least `VOLUNTEER_MINIMUM_AGE` — the tick «Am
 * cel puțin 18 ani» is gone, the date answers it), «Sex» (the registration form's two answers), «Orașul», the optional ticks
 * «Am mai fost voluntar în trecut la alte curse» and «Fac parte din grupul {club}», and «Mărimea tricoului» — which the
 * service keeps only while the event gives a shirt.
 */
const volunteerPublicProfileBase = (eventDay: string) =>
  z.object({
    ...publicBase,
    birthDate: requiredBirthDate(eventDay),
    sex: requiredSex,
    city: requiredCity,
    volunteeredBefore: tick,
    clubMember: tick,
    shirtSize: shirtField,
    /** The parent's or guardian's name and address, and the volunteer's tick «Părintele sau tutorele meu știe și e de acord» (§768): asked only of a minor. */
    guardianName: guardianNameBox,
    guardianEmail: guardianEmailBox,
    guardianAware: tick,
  });

/**
 * The profile's form with the minors' path (§768; the owner, 2026-10-14: «voluntarii trebuie să aibă cel puțin 14
 * ani» and «fă cu acord ceva»). From fourteen to seventeen the form also takes the parent's or guardian's name and
 * address and the volunteer's tick that the parent knows and agrees — and keeps the guardian as `guardian`, the
 * boxes themselves gone; at eighteen or more the guardian's boxes are dropped, whatever was typed in them.
 *
 * `minors` is whether the club may take a minor yet: the privacy notice in force names `{{volunteerMinors}}` and the
 * volunteer agreement `{{volunteerGuardian}}`, in every language (the §562 / §613 pattern). While it does not, a date that
 * gives an age under eighteen is refused on `birthDate` — the page then says the club cannot take minors yet. The age is the
 * date's on `eventDay` (`volunteerEventDay`): the §768 rules are judged on the event's day, not today's, and the result carries
 * it as `age` beside the date.
 */
export function volunteerPublicProfileSchemaFor(minors: boolean, eventDay: string) {
  const always = () => true;
  const basis: AgeBasis = { eventDay, kept: null };
  // A minor the form asks a guardian for: from the floor to seventeen on the event's day (a date under it is refused on its own box already).
  const minor = (value: { birthDate?: unknown }) => {
    const age = ageOfBox(value.birthDate, eventDay, null);
    return age !== null && age >= VOLUNTEER_MINIMUM_AGE && isVolunteerMinor(age);
  };
  // While the club cannot take a minor the guardian's boxes are not asked at all: the date alone is refused. Every refused box is
  // named in one pass, even when another (the sex, the city) was refused too.
  const refused = minors
    ? refuseGuardianBoxes(volunteerPublicProfileBase(eventDay), "required", basis).refine((value) => !minor(value) || value.guardianAware === true, {
        path: ["guardianAware"],
        message: "the volunteer says the parent knows and agrees",
        when: always,
      })
    : volunteerPublicProfileBase(eventDay).refine((value) => !minor(value), { path: ["birthDate"], message: "the club cannot take volunteers under eighteen yet", when: always });
  return refused.transform((value) => {
    const { guardianName, guardianEmail, guardianAware, ...rest } = value;
    // The tick was read by the refinement above; it leaves the result with the two boxes.
    void guardianAware;
    return { ...rest, age: ageOfBox(value.birthDate, eventDay, null) as number, guardian: minors ? guardianOf({ birthDate: value.birthDate, guardianName, guardianEmail }, "required", basis) : null };
  });
}

export type VolunteerPublicProfileInput = z.infer<ReturnType<typeof volunteerPublicProfileSchemaFor>>;

/**
 * The schema a public post is read with: the profile's (with the minors' path while `minors`) while the notice names
 * the profile, §758's otherwise — which takes adults only, by its own tick. `eventDay` is the day the date of birth is
 * counted on (`volunteerEventDay`).
 */
export function volunteerPublicSchemaFor(mode: { profile: boolean; minors: boolean; eventDay: string }) {
  return mode.profile ? volunteerPublicProfileSchemaFor(mode.minors, mode.eventDay) : volunteerPublicInputSchema;
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
  /** How many people the role needs; null is «fără număr» (§782): any number, never full. */
  needed: number | null;
  /** «Înscris» + «Confirmat» who were given the role: the people the role counts. */
  taken: number;
  confirmed: number;
  /** How many more the role needs; never below zero (an organizer may give it more people than it asked); null for a role without a number. */
  free: number | null;
};

export function standingOf(role: { id: string; needed: number | null }, volunteers: readonly { roleId: string | null; state: VolunteerState }[]): RoleStanding {
  const mine = volunteers.filter((volunteer) => volunteer.roleId === role.id);
  const taken = mine.filter((volunteer) => countsAgainstRole(volunteer.state)).length;
  const confirmed = mine.filter((volunteer) => volunteer.state === "CONFIRMED").length;
  return { roleId: role.id, needed: role.needed, taken, confirmed, free: role.needed === null ? null : Math.max(0, role.needed - taken) };
}

/** Whether a role still takes people: one without a number (§782) always does; a numbered one while it has places. */
export function roleTakesPeople(standing: Pick<RoleStanding, "free"> | undefined): boolean {
  return standing !== undefined && (standing.free === null || standing.free > 0);
}

/** Whether at least one role still needs people (the form's condition (b)). */
export function someRoleNeedsPeople(standings: readonly Pick<RoleStanding, "free">[]): boolean {
  return standings.some((standing) => roleTakesPeople(standing));
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
  return ticked.filter((roleId) => roleTakesPeople(standings.get(roleId)));
}

/**
 * A role's words as the agreement and the emails name it, in both languages — with the heading it sits under, when it has one (§774):
 * a role is named «Direcționare (Traseu)» wherever it is named alone, because «Direcționare» may stand in two categories.
 */
export type RoleWords = {
  nameRo: string;
  nameEn: string;
  descriptionRo: string | null;
  descriptionEn: string | null;
  categoryRo?: string | null;
  categoryEn?: string | null;
};

/**
 * A role named alone (§774): «Direcționare (Traseu)» in the language asked — the category in brackets when the role has one, the name
 * alone when it sits under none. What the assignment chips, the email's «Dă-i rolul …», the CSV's role columns and the agreement's
 * sentences say; the badge's band keeps the role's name only (the owner decided it so).
 */
export function roleLabel(role: Pick<RoleWords, "nameRo" | "nameEn" | "categoryRo" | "categoryEn">, locale: "ro" | "en"): string {
  const name = locale === "en" ? role.nameEn : role.nameRo;
  const category = locale === "en" ? role.categoryEn : role.categoryRo;
  return category ? `${name} (${category})` : name;
}

/**
 * A role's description as the agreement's sentence takes it: «Ce presupune rolul: {{volunteerTasks}}.» ends with
 * its own full stop, so the club's text — typed in the editor as a sentence, often with one — loses one closing
 * mark (after its spaces), never «…kilometrul 5..». The facts are frozen at acceptance, so this happens before
 * they are written. A text that is only punctuation reads as none, and its sentence is left out.
 */
export function tasksWords(description: string): string {
  // The description's plain words keep a line per paragraph and per list item (§765): in the agreement's sentence
  // they read as one, a line that ends a sentence followed by a space, any other by «; ».
  const lines = description
    .split(/\r?\n/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part !== "");
  const flat = lines.map((part, index) => (index === lines.length - 1 ? part : /[.!?…;:]$/u.test(part) ? `${part} ` : `${part}; `)).join("");
  return flat.trim().replace(/[.!?…;]$/u, "").trimEnd();
}

/**
 * A role's description is shown folded behind «Detalii» when it runs past about three lines (§765): more than three
 * lines of plain words (a paragraph or a list item each) or more than `ROLE_DESCRIPTION_FOLD_CHARS` characters.
 * The plain words are the rule's input — a document's JSON says nothing about how long it reads.
 */
// About three lines on a 320-pixel phone, where a line of body text holds about forty characters.
export const ROLE_DESCRIPTION_FOLD_CHARS = 120;
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
 * Whether two stored/typed descriptions are the same document (§765): read back from PostgreSQL's `jsonb` the keys come
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
  const name = (role: RoleWords) => roleLabel(role, locale);
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
  return roles.map((role) => roleLabel(role, locale)).join(", ");
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

/**
 * The link page's two ticks: the agreement and the age, both the person's own act each time. The age tick
 * («Am cel puțin 18 ani») is asked only of a person with no age on their row or one of eighteen or more: a volunteer
 * the organizers entered with an age under eighteen has their guardian accept beside them (§768), and the service
 * (`acceptVolunteerAgreementByLink`) asks the tick of everybody else.
 */
export const volunteerAgreementAcceptSchema = z.object({
  agreement: z.literal(true),
  adult: z.boolean().optional().default(false),
  locale: z.enum(["ro", "en"]),
});

/** The guardian's link page: the typed name is the acceptance, the tick the explicit act; both the guardian's own, every time (§768). */
export const volunteerGuardianAcceptSchema = z.object({
  agreement: z.literal(true),
  typedName: z
    .string()
    .transform((value) => foldedName(value))
    .pipe(z.string().min(1).max(VOLUNTEER_GUARDIAN_NAME_MAX)),
  locale: z.enum(["ro", "en"]),
});

/**
 * Where a volunteer stands with their parent's or guardian's agreement (§768), as the card says it:
 * - `notNeeded` — eighteen or older, or no age: nothing to ask;
 * - `accepted` — the guardian accepted, from the link or on paper;
 * - `linkSent` — not yet, and a link is live in the guardian's mailbox;
 * - `missing` — not yet, and no live link: «Acordul părintelui lipsește».
 */
export type VolunteerGuardianStanding = "notNeeded" | "accepted" | "linkSent" | "missing";

export function guardianStandingOf(
  volunteer: { age: number | null; guardianAcceptedAt: Date | null; guardianTokenExpiresAt: Date | null },
  now: Date,
): VolunteerGuardianStanding {
  if (!isVolunteerMinor(volunteer.age)) return "notNeeded";
  if (volunteer.guardianAcceptedAt) return "accepted";
  if (volunteer.guardianTokenExpiresAt && volunteer.guardianTokenExpiresAt.getTime() > now.getTime()) return "linkSent";
  return "missing";
}

/**
 * Whether a volunteer may be confirmed (§768): a minor needs the guardian's agreement first — the confirm action
 * refuses with «Acordul părintelui lipsește» until it is recorded; an adult is never held up by it.
 */
export function guardianAllowsConfirm(volunteer: { age: number | null; guardianAcceptedAt: Date | null }): boolean {
  return !isVolunteerMinor(volunteer.age) || volunteer.guardianAcceptedAt !== null;
}

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
  if (closed === null) return roles.filter((role) => roleTakesPeople(role));
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
