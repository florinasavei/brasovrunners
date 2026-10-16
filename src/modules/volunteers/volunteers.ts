import { and, asc, count, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import { eventVolunteerCategories, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers, type VolunteerAgreementMethod } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { hasRichTextContent, readRichText, type RichTextDoc } from "@/modules/content/rich-text/domain/schema";
import { sexShown, type SexChoice } from "@/modules/registrations/domain/sex";
import type { RegistrationTshirtSize } from "@/db/schema/registrations";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import type { SignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import {
  findCurrentApprovedDocument,
  noticeDescribesVolunteerAgreement,
  noticeDescribesVolunteerProfile,
  noticeDescribesVolunteers,
  volunteerAgreementInForce,
  volunteerMinorsOpen,
} from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { canManageVolunteers, isBackofficeRole } from "@/modules/staff-identity/domain/roles";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { readTypedDate } from "@/shared/forms/pickers/wall-values";
import { isUuid } from "@/shared/ids";
import {
  acceptedRoleNames,
  type CategoryContact,
  categoryContactOf,
  choicesWithAssigned,
  compareCategories,
  compareRoles,
  guardianAllowsConfirm,
  isVolunteerMinor,
  openChoices,
  refusedFields,
  type RoleStanding,
  sameDescription,
  standingOf,
  type VolunteerRoleInput,
  VOLUNTEER_MINIMUM_AGE,
  volunteerAgeOn,
  volunteerEventAhead,
  volunteerEventDay,
  volunteerOfferClosedFor,
  volunteerCategoryContactSchema,
  volunteerCategoryInputSchema,
  volunteerPublicSchemaFor,
  volunteerRoleInputSchema,
  volunteerStaffInputSchemaFor,
  VOLUNTEER_CATEGORIES_MAX,
  VOLUNTEER_ROLES_MAX,
  VOLUNTEER_STATES,
  type VolunteerState,
} from "./domain/volunteer";
import { agreementAcceptance, canonicalOrNull, readAgreementFacts } from "./agreement";
import { checkedRoleColour } from "./badges/badges";
import { type RoleRowBox, roleBox, roleColourBoxesOf } from "./role-rows";

/**
 * An event's volunteers (§754; the owner, 2026-10-13: «I want to register volunteers for a race and be
 * able to define custom roles», choosing a public form on the race's page as well as the organizers' own
 * list, and roles defined per event).
 *
 * Three things live here, each asserted on the server and never by a hidden button (BR-REQ-060-01):
 * the **roles** the club defines for one event (bilingual, how many it needs), the **people** on them
 * (entered by hand, or offered on the event's page), and the **public sign-up**, which takes the public
 * forms' defences unchanged — the honeypot and the timing check, Turnstile at the action, a throttle on the
 * address and one on the event — and answers every post that is not a person's typo the same way.
 *
 * **A volunteer is not a registration**: no place of the race's capacity, no declaration, no row on the
 * public list, no account. `registrations/` is not touched; this module reads nothing of it but
 * `looksLikeSpam`. The address goes through the versioned canonicalizer (AGENTS.md §10.4) and the database's
 * `UNIQUE (event_id, canonical_email)` is the identity: one row per person per event.
 *
 * **Why no confirmation link to the address first** (AGENTS.md §10.4, §12.8): the registration form
 * confirms an address because the confirmation is what holds a place and what the declaration binds. A
 * sign-up here holds nothing, binds nothing and gives the sender no way to act: the one email the address
 * gets carries no token and no link that does anything, the list of volunteers is read only by the
 * organizers, and an organizer's «Confirmat» — a person who then writes or rings — is the proof that the
 * address is the volunteer's. The worst a stranger's typing does is one polite email, which the throttles
 * bound; the group runs' self-declaration (§393) takes an unconfirmed address the same way.
 *
 * **A repeated sign-up** (the same address for the same event, whatever the role and whatever the row's
 * state — an organizer's «Anulat» included) changes nothing, sends nothing, and gets the answer a new one
 * gets — «am primit», or «full» when every role it ticks has filled, judged first for everybody: the answer
 * itself never tells a listed address from a new one (BR-REQ-031-01 criterion 3). §754's accepted residual —
 * a new address lowered the public «mai e nevoie de N» and a listed one did not — ended with §761: an offer
 * takes no place, only a role the organizers give counts, so a sign-up never moves the number.
 */

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

export type VolunteerRole = {
  id: string;
  eventId: string;
  nameRo: string;
  nameEn: string;
  needed: number | null;
  /**
   * «Descrierea rolului» (§765): the plain words per language — a line per paragraph and per list item: what the card's
   * header, the agreement and the emails say (the columns `description_words_*`; it is `RoleWords`' own shape, so a role
   * names itself to the agreement as it is) — and the editor's document, which the public form and the editor draw.
   * Both languages or neither; null is none.
   */
  descriptionRo: string | null;
  descriptionEn: string | null;
  descriptionRoJson: RichTextDoc | null;
  descriptionEnJson: RichTextDoc | null;
  /** The role's band on the volunteer badges (§764): a hex, or null for the club's orange. */
  colour: string | null;
  /** The category the role sits under (§774), or null for «Alte activități». */
  categoryId: string | null;
  position: number;
  createdAt: Date;
};

/**
 * A heading an event's roles are grouped under (§774), with the contact person the club set for its volunteers — the three words
 * as the database holds them (`contact`, null while none is set, is the same as the pages and the emails read it).
 */
export type VolunteerCategory = {
  id: string;
  eventId: string;
  nameRo: string;
  nameEn: string;
  sort: number;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contact: CategoryContact | null;
  createdAt: Date;
};

export type VolunteerItem = {
  id: string;
  eventId: string;
  /** The role the organizers gave the person, or null while nobody has (§761): «De repartizat» on the card. */
  roleId: string | null;
  /** The roles the person said they would do, in the club's order (§761): their chips on the card. */
  choiceIds: string[];
  name: string;
  email: string;
  phone: string;
  state: VolunteerState;
  source: "STAFF" | "PUBLIC";
  message: string | null;
  note: string | null;
  /** What the person said about themselves (§765), or nulls and false for a row from before — and for one the club typed without. */
  age: number | null;
  /** The day they were born, `YYYY-MM-DD` (§773): the age above is its age on the event's day; null for a row from before, which has an age alone. */
  dateOfBirth: string | null;
  sex: SexChoice | null;
  city: string | null;
  volunteeredBefore: boolean;
  clubMember: boolean;
  shirtSize: Exclude<RegistrationTshirtSize, "NONE"> | null;
  createdAt: Date;
  updatedAt: Date;
  /** The volunteer agreement (§758): when it was accepted and how, or nulls for «contract neacceptat încă». */
  agreementAcceptedAt: Date | null;
  agreementMethod: VolunteerAgreementMethod | null;
  /** The number of the version accepted, read through the row's reference. */
  agreementVersion: number | null;
  /**
   * The roles' names the accepted agreement named, in its language (`acceptedRoleNames`): the role given, or the
   * roles chosen while none was — they differ from the row's once the roles change.
   */
  agreementRoleName: string | null;
  /**
   * The event's date and place as the accepted text named them (`agreement_facts`), in the acceptance's language
   * (`agreementLocale`) — the card compares them with the event's own, so a race moved since says so.
   */
  agreementLocale: Locale | null;
  agreementEventDate: string | null;
  agreementEventLocation: string | null;
  /** The language the person wrote in: the version in force in it is the one the desk's PDF prints. */
  locale: Locale;
  /** Whether a link to accept is live, and when an organizer last sent one. */
  agreementTokenExpiresAt: Date | null;
  agreementRequestedAt: Date | null;
  /**
   * The parent or guardian of a volunteer under eighteen (§768): their name and address (null for an adult, and for a
   * guardian with no address — the consent is taken on paper), and how and when they accepted the agreement.
   */
  guardianName: string | null;
  guardianEmail: string | null;
  guardianAcceptedAt: Date | null;
  guardianMethod: "LINK" | "PAPER" | null;
  /** The number of the version the guardian accepted, read through the row's reference. */
  guardianVersion: number | null;
  /** Whether a link to the guardian is live, and when it was last asked for. */
  guardianTokenExpiresAt: Date | null;
  guardianRequestedAt: Date | null;
};

/** An event's roles, in the order the club set them. */
export async function listVolunteerRoles<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerRole[]> {
  const rows = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId));
  return rows.sort(compareRoles).map(roleOf);
}

/** An event's categories, in the order the club set them (§774): `sort`, then age, then the id. */
export async function listVolunteerCategories<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerCategory[]> {
  const rows = await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, eventId));
  return rows.sort(compareCategories).map(categoryOf);
}

function categoryOf(row: typeof eventVolunteerCategories.$inferSelect): VolunteerCategory {
  return {
    id: row.id,
    eventId: row.eventId,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    sort: row.sort,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    contactEmail: row.contactEmail,
    contact: categoryContactOf(row),
    createdAt: row.createdAt,
  };
}

/** A stored document as the editor and the page read it: leniently, so a body nobody can parse costs a description, not the page. */
function storedDescription(json: unknown): RichTextDoc | null {
  if (json === null || json === undefined) return null;
  const doc = readRichText(json);
  return hasRichTextContent(doc) ? doc : null;
}

/** The roles' columns as the card, the form and the agreement read them (§765): the plain words under the names `RoleWords` uses. */
function roleOf(row: typeof eventVolunteerRoles.$inferSelect): VolunteerRole {
  return {
    id: row.id,
    eventId: row.eventId,
    nameRo: row.nameRo,
    nameEn: row.nameEn,
    needed: row.needed,
    descriptionRo: row.descriptionWordsRo,
    descriptionEn: row.descriptionWordsEn,
    descriptionRoJson: storedDescription(row.descriptionRoJson),
    descriptionEnJson: storedDescription(row.descriptionEnJson),
    colour: row.colour,
    categoryId: row.categoryId,
    position: row.position,
    createdAt: row.createdAt,
  };
}

/**
 * The roles each of an event's volunteers chose (§761), volunteer → role ids in the club's order (`compareRoles`):
 * one read for the whole list.
 */
async function choicesOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      volunteerId: eventVolunteerRoleChoices.volunteerId,
      id: eventVolunteerRoles.id,
      position: eventVolunteerRoles.position,
      createdAt: eventVolunteerRoles.createdAt,
    })
    .from(eventVolunteerRoleChoices)
    .innerJoin(eventVolunteerRoles, eq(eventVolunteerRoles.id, eventVolunteerRoleChoices.roleId))
    .where(eq(eventVolunteerRoles.eventId, eventId));
  const byVolunteer = new Map<string, string[]>();
  for (const row of rows.sort(compareRoles)) byVolunteer.set(row.volunteerId, [...(byVolunteer.get(row.volunteerId) ?? []), row.id]);
  return byVolunteer;
}

/** An event's volunteers, oldest first (the card groups them by the role given, «De repartizat» first). */
export async function listVolunteers<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerItem[]> {
  const guardianDocument = alias(legalDocuments, "guardian_document");
  const rows = await db
    .select({ row: eventVolunteers, agreementVersion: legalDocuments.version, guardianVersion: guardianDocument.version })
    .from(eventVolunteers)
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .leftJoin(guardianDocument, eq(guardianDocument.id, eventVolunteers.guardianDocumentId))
    .where(eq(eventVolunteers.eventId, eventId))
    .orderBy(asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
  const choices = await choicesOf(db, eventId);
  return rows.map(({ row, agreementVersion, guardianVersion }) => {
    const facts = readAgreementFacts(row.agreementFacts);
    return {
      id: row.id,
      eventId: row.eventId,
      roleId: row.roleId,
      choiceIds: choices.get(row.id) ?? [],
      name: row.name,
      email: row.email,
      phone: row.phone,
      state: row.state,
      source: row.source,
      message: row.message,
      note: row.note,
      age: row.age,
      dateOfBirth: row.dateOfBirth,
      sex: sexShown(row.sex),
      city: row.city,
      volunteeredBefore: row.volunteeredBefore,
      clubMember: row.clubMember,
      shirtSize: row.shirtSize === null || row.shirtSize === "NONE" ? null : row.shirtSize,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      agreementAcceptedAt: row.agreementAcceptedAt,
      agreementMethod: row.agreementMethod,
      agreementVersion: row.agreementAcceptedAt ? agreementVersion : null,
      agreementRoleName: facts ? acceptedRoleNames(facts) : null,
      agreementLocale: row.agreementAcceptedAt ? row.agreementLocale : null,
      agreementEventDate: facts?.eventDate ?? null,
      agreementEventLocation: facts?.eventLocation ?? null,
      locale: row.locale,
      agreementTokenExpiresAt: row.agreementTokenExpiresAt,
      agreementRequestedAt: row.agreementRequestedAt,
      guardianName: row.guardianName,
      guardianEmail: row.guardianEmail,
      guardianAcceptedAt: row.guardianAcceptedAt,
      guardianMethod: row.guardianMethod,
      guardianVersion: row.guardianAcceptedAt ? guardianVersion : null,
      guardianTokenExpiresAt: row.guardianTokenExpiresAt,
      guardianRequestedAt: row.guardianRequestedAt,
    };
  });
}

/**
 * The roles of one event with how each stands, in the club's order: «N din M» and what is still needed — the people
 * given each role, never those who only ticked it (§761).
 */
export function volunteerStandings(roles: readonly VolunteerRole[], volunteers: readonly Pick<VolunteerItem, "roleId" | "state">[]): RoleStanding[] {
  return roles.map((role) => standingOf(role, volunteers));
}

/** How many events still ahead take volunteers — what `/admin/tasks`' row `volunteersNotice` waits on. */
export async function countVolunteeringEvents<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(events)
    .where(
      and(
        eq(events.acceptsVolunteers, true),
        eq(events.eventStatus, "SCHEDULED"),
        gt(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now),
      ),
    );
  return row?.n ?? 0;
}

/** One role of the public form: the words in both languages and how many people it still needs. */
export type PublicVolunteerRole = {
  id: string;
  nameRo: string;
  nameEn: string;
  /** «Descrierea rolului» (§765): the plain words (how long it reads) and the document the form draws under the role's tick. */
  descriptionRo: string | null;
  descriptionEn: string | null;
  descriptionRoJson: RichTextDoc | null;
  descriptionEnJson: RichTextDoc | null;
  needed: number | null;
  taken: number;
  free: number | null;
  /** The category the role sits under (§774); null is «Alte activități». */
  categoryId: string | null;
};

/**
 * One heading of the public form (§774): the category's words in both languages and the contact person the club set for its
 * volunteers — «Întrebări? <name> · <phone> · <email>» under the heading — or null while none is set. The club's own business
 * contact, published by its choice; never a participant's or a volunteer's.
 */
export type PublicVolunteerCategory = { id: string; nameRo: string; nameEn: string; contact: CategoryContact | null };

/**
 * What an event's page reads to decide whether to draw «Vreau să fiu voluntar» and which roles to list
 * (§754): the tick, and every role with its standing, in the club's order. Names and counts only — nothing
 * of a person — so the public cache may hold it (`public-cache/reads.ts`); expired by every write here.
 */
export async function readPublicVolunteerRoles<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ acceptsVolunteers: boolean; shirts: boolean; showCounts: boolean; roles: PublicVolunteerRole[]; categories: PublicVolunteerCategory[] }> {
  const [event] = await db
    .select({ accepts: events.acceptsVolunteers, shirts: events.volunteersShirts, showCounts: events.volunteersShowCounts })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event?.accepts) return { acceptsVolunteers: false, shirts: false, showCounts: false, roles: [], categories: [] };
  const roles = await listVolunteerRoles(db, eventId);
  const categories = await listVolunteerCategories(db, eventId);
  const people = await db
    .select({ roleId: eventVolunteers.roleId, state: eventVolunteers.state })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.eventId, eventId));
  return {
    acceptsVolunteers: true,
    // «Oferim tricouri voluntarilor» (§765): the form asks the size only while it is on.
    shirts: event.shirts,
    // «Arată public câți voluntari mai sunt necesari» (§773): the page says how many a role still needs only while it is on.
    showCounts: event.showCounts,
    roles: roles.map((role) => {
      const standing = standingOf(role, people);
      return {
        id: role.id,
        nameRo: role.nameRo,
        nameEn: role.nameEn,
        descriptionRo: role.descriptionRo,
        descriptionEn: role.descriptionEn,
        descriptionRoJson: role.descriptionRoJson,
        descriptionEnJson: role.descriptionEnJson,
        needed: role.needed,
        taken: standing.taken,
        free: standing.free,
        categoryId: role.categoryId,
      };
    }),
    // In the club's order; the page draws only the headings that have a role still needing people.
    categories: categories.map((category) => ({ id: category.id, nameRo: category.nameRo, nameEn: category.nameEn, contact: category.contact })),
  };
}

// ---------------------------------------------------------------------------------------------
// The club's own changes
// ---------------------------------------------------------------------------------------------

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayManage(actor: Actor): void {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or change an event's volunteers`);
  }
}

/** A forged form's malformed id is the refusal an unknown one gets, not a database error. */
function assertIds(...ids: readonly string[]): void {
  if (ids.some((id) => !isUuid(id))) throw new DomainError("NOT_FOUND", "the event, the role or the volunteer is not there");
}

function postedStrings(fields: Record<string, unknown>, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, typeof fields[name] === "string" ? (fields[name] as string) : ""]));
}

const ROLE_FIELDS = ["nameRo", "nameEn", "needed", "unlimited", "descriptionRo", "descriptionEn"] as const;
/** The editor's documents: absent stays absent (a caller without the editor posts the plain boxes), never an empty document that would win over them. */
const ROLE_BODY_FIELDS = ["descriptionRoBody", "descriptionEnBody"] as const;

function roleInputOf(fields: Record<string, unknown>): VolunteerRoleInput {
  const bodies = Object.fromEntries(ROLE_BODY_FIELDS.filter((name) => typeof fields[name] === "string").map((name) => [name, fields[name] as string]));
  const parsed = volunteerRoleInputSchema.safeParse({ ...postedStrings(fields, ROLE_FIELDS), ...bodies });
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), refusedFields(parsed.error));
  }
  return parsed.data;
}

/**
 * The boxes of a role's band colour inside the role's own form (§764): «Culoarea benzii» and «Culoarea scrisă».
 * A form that posts neither leaves the colour as it is — the saves that predate the colour, and any caller
 * that does not draw the boxes, never reset it.
 */
export const ROLE_FORM_COLOUR_BOXES = { choice: "colourChoice", typed: "colourTyped" } as const;

export type VolunteerRoleRequest =
  | { kind: "add"; eventId: string; fields: Record<string, unknown> }
  | { kind: "edit"; eventId: string; id: string; fields: Record<string, unknown> }
  | { kind: "move"; eventId: string; id: string; direction: "up" | "down" }
  | { kind: "delete"; eventId: string; id: string };

export type VolunteerRoleResult = { changed: boolean; role: { id: string; nameRo: string } };

/**
 * One change to one event's roles, by one staff member. Refuses a role that may not (FORBIDDEN), a role typed
 * wrong (VALIDATION_ERROR naming the boxes: both names, a number of at least one, a description in both
 * languages or neither), an event or a role that is not there — or a role of another event (NOT_FOUND) — and
 * a delete while anybody is on the role, cancelled people included (`VOLUNTEER_ROLE_HAS_PEOPLE`: move them
 * first). A press that changes nothing writes nothing and records nothing.
 */
export async function changeVolunteerRole<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: VolunteerRoleRequest,
  now: Date,
): Promise<VolunteerRoleResult> {
  assertMayManage(actor);
  assertIds(request.eventId, ...(request.kind === "add" ? [] : [request.id]));
  const input = request.kind === "add" || request.kind === "edit" ? roleInputOf(request.fields) : null;
  // The band's colour, when the form drew its boxes: «Culoarea benzii» and the colour typed beside «Altă culoare».
  const postedColour =
    request.kind === "add" || request.kind === "edit"
      ? typeof request.fields[ROLE_FORM_COLOUR_BOXES.choice] === "string"
        ? {
            choice: request.fields[ROLE_FORM_COLOUR_BOXES.choice] as string,
            typed: typeof request.fields[ROLE_FORM_COLOUR_BOXES.typed] === "string" ? (request.fields[ROLE_FORM_COLOUR_BOXES.typed] as string) : "",
          }
        : null
      : null;
  // «Categoria» (§774): the id the form's choice posted, "" for «Alte activități»; absent when the form drew no such choice, which
  // leaves the role where it is — the saves that predate the categories, and any caller without the box, never move a role.
  const postedCategory =
    (request.kind === "add" || request.kind === "edit") && typeof request.fields.categoryId === "string" ? request.fields.categoryId.trim() : undefined;
  if (postedCategory !== undefined && postedCategory !== "" && !isUuid(postedCategory)) {
    throw new DomainError("VALIDATION_ERROR", "that is not a category of this event", ["categoryId"]);
  }

  const result = await db.transaction(async (tx) => {
    // The event's own row is locked first: on an event with no roles yet there is no role row to lock, and two
    // «Adaugă rolul» presses would both take position 0 — or, at twenty-nine roles, both pass the cap.
    // NO KEY UPDATE, never UPDATE: it still queues a second press (the lock conflicts with itself), but not the
    // KEY SHARE a sign-up's insert takes on this row for its foreign key. With FOR UPDATE a sign-up holding its
    // role's lock and waiting on the event, against this press holding the event and waiting on the roles, is a
    // deadlock — one side aborted, a visitor's typing lost.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });

    // The categories next (§774), in the order of their ids: the order a category's own change locks them, after the event and
    // before the roles — so a role put under a category and that category's delete never wait on each other in a circle.
    const categoryIds = (
      await tx.select({ id: eventVolunteerCategories.id }).from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, request.eventId)).orderBy(asc(eventVolunteerCategories.id)).for("update")
    ).map((row) => row.id);
    if (postedCategory && !categoryIds.includes(postedCategory)) {
      throw new DomainError("VALIDATION_ERROR", "that is not a category of this event", ["categoryId"]);
    }

    // Every verb is about this event's list: locked for the change, so two presses cannot both take a position.
    // In the order of the ids — the order a sign-up locks the roles it ticked (§761) — so the two never wait on
    // each other in a circle.
    const roles = (
      await tx.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, request.eventId)).orderBy(asc(eventVolunteerRoles.id)).for("update")
    ).sort(compareRoles);

    /** One name once per category and language (§774): the same name may stand in two categories, never twice in one. */
    const assertNameFree = (names: { nameRo: string; nameEn: string }, categoryId: string | null, exceptId: string | null) => {
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      for (const other of roles) {
        if (other.id === exceptId || other.categoryId !== categoryId) continue;
        if (same(other.nameRo, names.nameRo)) throw new DomainError("VOLUNTEER_NAME_TAKEN", "a role of that name is already under this category", ["nameRo"]);
        if (same(other.nameEn, names.nameEn)) throw new DomainError("VOLUNTEER_NAME_TAKEN", "a role of that name is already under this category", ["nameEn"]);
      }
    };

    if (request.kind === "add" && input) {
      if (roles.length >= VOLUNTEER_ROLES_MAX) {
        throw new DomainError("VALIDATION_ERROR", `an event takes at most ${VOLUNTEER_ROLES_MAX} roles`, ["nameRo"]);
      }
      const categoryId = postedCategory ? postedCategory : null;
      assertNameFree(input, categoryId, null);
      const colour = postedColour ? checkedRoleColour(postedColour, null, ROLE_FORM_COLOUR_BOXES) : null;
      const [row] = await tx
        .insert(eventVolunteerRoles)
        .values({
          eventId: request.eventId,
          nameRo: input.nameRo,
          nameEn: input.nameEn,
          needed: input.needed,
          descriptionRoJson: input.descriptionRoJson,
          descriptionEnJson: input.descriptionEnJson,
          descriptionWordsRo: input.descriptionWordsRo,
          descriptionWordsEn: input.descriptionWordsEn,
          colour,
          categoryId,
          position: roles.length === 0 ? 0 : Math.max(...roles.map((role) => role.position)) + 1,
          createdAt: now,
        })
        .returning({ id: eventVolunteerRoles.id });
      await audit("volunteer_role.added", { roleId: row.id, nameRo: input.nameRo, nameEn: input.nameEn, needed: input.needed, colour, categoryId });
      return { changed: true, role: { id: row.id, nameRo: input.nameRo } };
    }

    const current = roles.find((role) => role.id === (request.kind === "add" ? "" : request.id));
    if (!current) throw new DomainError("NOT_FOUND", "the role is not there");
    const summary = { id: current.id, nameRo: current.nameRo };

    if (request.kind === "delete") {
      // Anybody given the role, or who ticked it (§761) — cancelled people too: the people are asked to move first,
      // never dropped from a role under them (the choices' own reference cascades only for an event's delete).
      const [people] = await tx.select({ n: count() }).from(eventVolunteers).where(eq(eventVolunteers.roleId, current.id));
      const [choosers] = await tx.select({ n: count() }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.roleId, current.id));
      if ((people?.n ?? 0) + (choosers?.n ?? 0) > 0) throw new DomainError("VOLUNTEER_ROLE_HAS_PEOPLE", "move the volunteers to another role first", ["roleId"]);
      await tx.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, current.id));
      await audit("volunteer_role.deleted", { roleId: current.id, nameRo: current.nameRo, nameEn: current.nameEn });
      return { changed: true, role: summary };
    }

    if (request.kind === "move") {
      // One step inside the role's own category (§774): the card lists the roles under their headings, so «up» is above the
      // neighbour under the same heading. The group's members keep the slots they hold in the event's order, swapped.
      const group = roles.filter((role) => role.categoryId === current.categoryId);
      const index = group.findIndex((role) => role.id === current.id);
      const target = request.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= group.length) return { changed: false, role: summary };
      const swapped = group.map((role) => role.id);
      [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
      const inGroup = new Set(group.map((role) => role.id));
      const order = roles.map((role) => role.id);
      let slot = 0;
      for (const [at, id] of order.entries()) if (inGroup.has(id)) order[at] = swapped[slot++] ?? id;
      // Positions 0..n-1 in the new order: a total order, whatever the gaps a delete left.
      for (const [position, id] of order.entries()) {
        await tx.update(eventVolunteerRoles).set({ position }).where(eq(eventVolunteerRoles.id, id));
      }
      await audit("volunteer_role.moved", { roleId: current.id, nameRo: current.nameRo, direction: request.direction });
      return { changed: true, role: summary };
    }

    // «Salvează» on a role: both names, how many it needs, and its description.
    if (!input) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    const colour = postedColour ? checkedRoleColour(postedColour, current.colour, ROLE_FORM_COLOUR_BOXES) : current.colour;
    // «Categoria» (§774): a role moved to another category goes to its end — the club's order inside the new heading.
    const categoryId = postedCategory === undefined ? current.categoryId : postedCategory === "" ? null : postedCategory;
    assertNameFree(input, categoryId, current.id);
    const before = { nameRo: current.nameRo, nameEn: current.nameEn, needed: current.needed, colour: current.colour, categoryId: current.categoryId };
    const after = { nameRo: input.nameRo, nameEn: input.nameEn, needed: input.needed, colour, categoryId };
    const changedFields: string[] = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== after[key]);
    // The description is a document per language (§765): the names of the fields in the trail, never its words.
    if (!sameDescription(current.descriptionRoJson, input.descriptionRoJson)) changedFields.push("descriptionRo");
    if (!sameDescription(current.descriptionEnJson, input.descriptionEnJson)) changedFields.push("descriptionEn");
    if (changedFields.length === 0) return { changed: false, role: summary };
    await tx
      .update(eventVolunteerRoles)
      .set({
        nameRo: input.nameRo,
        nameEn: input.nameEn,
        needed: input.needed,
        descriptionRoJson: input.descriptionRoJson,
        descriptionEnJson: input.descriptionEnJson,
        descriptionWordsRo: input.descriptionWordsRo,
        descriptionWordsEn: input.descriptionWordsEn,
        colour,
        categoryId,
        ...(categoryId !== current.categoryId ? { position: Math.max(...roles.map((role) => role.position)) + 1 } : {}),
      })
      .where(eq(eventVolunteerRoles.id, current.id));
    await audit("volunteer_role.edited", {
      roleId: current.id,
      fields: changedFields,
      nameRo: input.nameRo,
      needed: input.needed,
      ...(changedFields.includes("categoryId") ? { categoryFrom: current.categoryId, categoryTo: categoryId } : {}),
      ...(changedFields.includes("colour") ? { colourFrom: current.colour, colourTo: colour } : {}),
    });
    return { changed: true, role: { id: current.id, nameRo: input.nameRo } };
  });
  // The public page lists the roles and what each still needs: it is told once the write has committed.
  if (result.changed) revalidatePublicContent("places");
  return result;
}

// ---------------------------------------------------------------------------------------------
// The «Roluri» card's one save
// ---------------------------------------------------------------------------------------------

/** One row of the card's form: its key (`role-rows.ts`), the saved role it is (null for a blank row), and its boxes by their short names. */
export type VolunteerRolesRowRequest = { key: string; id: string | null; fields: Record<string, unknown> };

export type VolunteerRolesRequest = { eventId: string; rows: readonly VolunteerRolesRowRequest[] };

/** What a save did: the roles it changed and the roles it created. `changed` is false when it wrote nothing. */
export type VolunteerRolesResult = { changed: boolean; edited: number; created: number };

/** Why a row was refused, for the sentence after the role's name («lipsește numele în engleză»). */
export type VolunteerRoleRowProblem =
  | "nameRoMissing"
  | "nameEnMissing"
  | "nameRoLong"
  | "nameEnLong"
  | "needed"
  | "description"
  | "colour"
  | "colourUnreadable"
  | "position"
  | "category"
  | "taken"
  | "tooMany";

/** The role a refusal is about, in the words the sentence names it by: the Romanian name typed (or saved) and its category's two names. */
export type VolunteerRoleRowName = { id: string | null; name: string; categoryRo: string | null; categoryEn: string | null };

/**
 * One row of the «Roluri» card's one save, refused (`VOLUNTEER_ROLE_INVALID`): the role and its category for the sentence, the problem for the
 * words after it, and the boxes — `roles[<key>].nameEn` — for the summary's links. Names and codes only, never a typed value.
 */
export class VolunteerRoleRowError extends DomainError {
  readonly row: VolunteerRoleRowName;
  readonly problem: VolunteerRoleRowProblem;

  constructor(row: VolunteerRoleRowName, problem: VolunteerRoleRowProblem, fields: readonly string[]) {
    super("VOLUNTEER_ROLE_INVALID", `a role of the form cannot be saved: ${problem}`, fields);
    this.row = row;
    this.problem = problem;
  }
}

/** The boxes a role's saved values stand for, as the form would post them: what a row that leaves a box out keeps. */
function postedDefaultsOf(role: typeof eventVolunteerRoles.$inferSelect): Record<string, string> {
  return {
    nameRo: role.nameRo,
    nameEn: role.nameEn,
    needed: role.needed === null ? "" : String(role.needed),
    unlimited: role.needed === null ? "on" : "",
  };
}

/** The boxes a row posted, as strings: a box left out is a box the role keeps. */
function postedBoxes(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** «Poziția» as typed: empty is none (the role keeps its place, a new one goes last), a whole number from 1 otherwise, else `undefined` (the box's refusal). */
function postedPosition(value: unknown): number | null | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  const number = Number(text);
  return number >= 1 ? number : undefined;
}

/**
 * The box a zod issue's path names, in the row's own spelling: a description's refusal names the editor's document when the row posted one,
 * the plain box when the row (a script, a test) posted that.
 */
function roleBoxOfIssue(name: string, posted: Record<string, string>): RoleRowBox | null {
  const side = name.startsWith("descriptionRo") ? "Ro" : name.startsWith("descriptionEn") ? "En" : null;
  if (side) return `description${side}Body` in posted || !(`description${side}` in posted) ? `description${side}Body` : `description${side}`;
  return (["nameRo", "nameEn", "needed"] as const).find((known) => known === name) ?? null;
}

/**
 * Every role of an event's card saved at once (§NNN; the owner, 2026-10-16: «să pot face batch edit la roluri, nu să dau save de fiecare dată, ci
 * un Save All»), by one staff member — the plural of `changeVolunteerRole`, which stays for the delete and for the older callers. Each row is a
 * saved role (`id`) or the blank row at the end of a category (no `id`; blank names are ignored, a name typed creates the role). A box a row leaves
 * out keeps what the role has — the colour, the description, the category, the number — so a caller posts only what it changes.
 *
 * **All or nothing.** Every row is read first, by the singular's own rules (`roleInputOf`, `checkedRoleColour`: both names, a number of at least one
 * or «Nelimitat», the description in both languages or neither, the colour at AA) and the first refused row, in the form's order, refuses the whole
 * save with `VOLUNTEER_ROLE_INVALID` naming that row (`VolunteerRoleRowError`) and the boxes to correct; so is a name already under the category it ends
 * in (the same name may stand in two categories, never twice in one), a position that is not a whole number from 1, a category that is not the event's,
 * and more than `VOLUNTEER_ROLES_MAX` roles. Only then, in one transaction, is each role that differs from the stored one written — field by field, one
 * audit row each (`volunteer_role.edited`, naming the boxes that changed, with «position» among them when the role's own place moved), the new roles
 * created (`volunteer_role.added`) — and the public page told once. A save that changes nothing writes and records nothing.
 *
 * **«Poziția»** is the role's place among the roles of its own category, from 1. Saving sorts each category by the number posted, a role that left
 * its number alone keeping its place and one that took a new number taking it — before the role it ties with when it moved up, after when it moved
 * down; a role moved to another category goes to its end unless a number was typed, a new role goes last unless one was typed. The stored order is
 * then rewritten compactly (0, 1, 2 … through the categories in the club's order, «Alte roluri» last), which also closes the gaps a delete left; a
 * role that only moved because another did is rewritten silently, never audited as edited.
 */
export async function changeVolunteerRoles<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: VolunteerRolesRequest,
  now: Date,
): Promise<VolunteerRolesResult> {
  assertMayManage(actor);
  assertIds(request.eventId, ...request.rows.flatMap((row) => (row.id === null ? [] : [row.id])));
  if (request.rows.length === 0) return { changed: false, edited: 0, created: 0 };
  // A form names each role once (its boxes are grouped by their row's key); a caller that names one twice would have it audited twice.
  const named = request.rows.flatMap((row) => (row.id === null ? [] : [row.id]));
  if (new Set(named).size !== named.length) throw new DomainError("VALIDATION_ERROR", "a role is named twice in one save");

  const result = await db.transaction(async (tx): Promise<VolunteerRolesResult> => {
    // The locks, in the order every other change of the roles takes them: the event (NO KEY UPDATE, see `changeVolunteerRole`), its categories, its roles.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const categories = (
      await tx.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, request.eventId)).orderBy(asc(eventVolunteerCategories.id)).for("update")
    ).sort(compareCategories);
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const stored = (
      await tx.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, request.eventId)).orderBy(asc(eventVolunteerRoles.id)).for("update")
    ).sort(compareRoles);
    const storedById = new Map(stored.map((role) => [role.id, role]));
    // Each stored role's place among the roles of its own category, from 1: what «Poziția» shows and what a row that leaves it alone keeps.
    const rankBefore = new Map<string, number>();
    const perCategory = new Map<string | null, number>();
    for (const role of stored) {
      const rank = (perCategory.get(role.categoryId) ?? 0) + 1;
      perCategory.set(role.categoryId, rank);
      rankBefore.set(role.id, rank);
    }

    type Stored = typeof eventVolunteerRoles.$inferSelect;
    type Prepared = {
      row: VolunteerRolesRowRequest;
      current: Stored | null;
      /** The id the roles are told apart by while the order is worked out: the saved id, or `new:<key>`. */
      id: string;
      input: VolunteerRoleInput;
      colour: string | null;
      categoryId: string | null;
      posted: number | null;
      changedFields: string[];
    };

    // ---- 1. Every row read, the first refused one refusing the save --------------------------------
    const prepared: Prepared[] = [];
    for (const row of request.rows) {
      const current = row.id === null ? null : (storedById.get(row.id) ?? null);
      if (row.id !== null && !current) throw new DomainError("NOT_FOUND", "the role is not there");
      const boxes = postedBoxes(row.fields);
      // The blank row of a category: no name in either language is no role.
      if (!current && (boxes.nameRo ?? "").trim() === "" && (boxes.nameEn ?? "").trim() === "") continue;

      const postedCategory = typeof boxes.categoryId === "string" ? boxes.categoryId.trim() : undefined;
      const categoryId = postedCategory === undefined ? (current?.categoryId ?? null) : postedCategory === "" ? null : postedCategory;
      const categoryRow = categoryId === null ? undefined : categoryById.get(categoryId);
      const named: VolunteerRoleRowName = {
        id: current?.id ?? null,
        name: (boxes.nameRo ?? current?.nameRo ?? "").trim() || (boxes.nameEn ?? current?.nameEn ?? "").trim(),
        categoryRo: categoryRow?.nameRo ?? null,
        categoryEn: categoryRow?.nameEn ?? null,
      };
      const refuse = (problem: VolunteerRoleRowProblem, ...at: readonly RoleRowBox[]): never => {
        throw new VolunteerRoleRowError(named, problem, at.map((box) => roleBox(row.key, box)));
      };

      if (categoryId !== null && !categoryRow) refuse("category", "categoryId");

      let input: VolunteerRoleInput;
      try {
        input = roleInputOf({ ...(current ? postedDefaultsOf(current) : {}), ...boxes });
      } catch (error) {
        if (!isDomainError(error) || error.code !== "VALIDATION_ERROR") throw error;
        const at = [...new Set(error.fields.flatMap((name) => roleBoxOfIssue(name, boxes) ?? []))];
        const first = error.fields[0] ?? "";
        const typed = (name: "nameRo" | "nameEn") => (boxes[name] ?? current?.[name] ?? "").trim();
        if (first === "nameRo") refuse(typed("nameRo") === "" ? "nameRoMissing" : "nameRoLong", ...at);
        if (first === "nameEn") refuse(typed("nameEn") === "" ? "nameEnMissing" : "nameEnLong", ...at);
        refuse(first === "needed" ? "needed" : "description", ...(at.length > 0 ? at : (["nameRo"] as const)));
        throw error;
      }
      // A row that posted no description box at all keeps the role's: the editor always posts both, a caller that changes only a name does not.
      if (current && !(["descriptionRoBody", "descriptionEnBody", "descriptionRo", "descriptionEn"] as const).some((box) => box in boxes)) {
        input = {
          ...input,
          descriptionRoJson: (current.descriptionRoJson as RichTextDoc | null) ?? null,
          descriptionEnJson: (current.descriptionEnJson as RichTextDoc | null) ?? null,
          descriptionWordsRo: current.descriptionWordsRo,
          descriptionWordsEn: current.descriptionWordsEn,
        };
      }

      let colour = current?.colour ?? null;
      if (typeof boxes.colourChoice === "string") {
        try {
          colour = checkedRoleColour({ choice: boxes.colourChoice, typed: boxes.colourTyped ?? "" }, current?.colour ?? null, roleColourBoxesOf(row.key));
        } catch (error) {
          if (isDomainError(error) && (error.code === "VALIDATION_ERROR" || error.code === "BADGE_COLOUR_UNREADABLE")) {
            throw new VolunteerRoleRowError(named, error.code === "BADGE_COLOUR_UNREADABLE" ? "colourUnreadable" : "colour", error.fields);
          }
          throw error;
        }
      }

      const posted = postedPosition(boxes.position);
      if (posted === undefined) refuse("position", "position");

      prepared.push({ row, current, id: current?.id ?? `new:${row.key}`, input, colour, categoryId, posted: posted ?? null, changedFields: [] });
    }

    const creating = prepared.filter((one) => !one.current);
    const overflow = creating[Math.max(0, VOLUNTEER_ROLES_MAX - stored.length)];
    if (stored.length + creating.length > VOLUNTEER_ROLES_MAX && overflow) {
      throw new VolunteerRoleRowError(
        { id: null, name: overflow.input.nameRo, categoryRo: categoryById.get(overflow.categoryId ?? "")?.nameRo ?? null, categoryEn: categoryById.get(overflow.categoryId ?? "")?.nameEn ?? null },
        "tooMany",
        [roleBox(overflow.row.key, "nameRo")],
      );
    }

    // ---- 2. What each role would be, and the names it would collide on -----------------------------
    const preparedById = new Map(prepared.map((one) => [one.id, one]));
    const finalOf = (role: Stored) => {
      const one = preparedById.get(role.id);
      return one ? { nameRo: one.input.nameRo, nameEn: one.input.nameEn, categoryId: one.categoryId } : { nameRo: role.nameRo, nameEn: role.nameEn, categoryId: role.categoryId };
    };
    const finals = new Map<string, { nameRo: string; nameEn: string; categoryId: string | null }>([
      ...stored.map((role) => [role.id, finalOf(role)] as const),
      ...creating.map((one) => [one.id, { nameRo: one.input.nameRo, nameEn: one.input.nameEn, categoryId: one.categoryId }] as const),
    ]);
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    for (const one of prepared) {
      const mine = finals.get(one.id);
      if (!mine) continue;
      const moved = !one.current || mine.nameRo !== one.current.nameRo || mine.nameEn !== one.current.nameEn || mine.categoryId !== one.current.categoryId;
      // A pair that was already twins and was not touched here is not this save's to refuse.
      if (!moved) continue;
      const named: VolunteerRoleRowName = {
        id: one.current?.id ?? null,
        name: mine.nameRo,
        categoryRo: categoryById.get(mine.categoryId ?? "")?.nameRo ?? null,
        categoryEn: categoryById.get(mine.categoryId ?? "")?.nameEn ?? null,
      };
      for (const [otherId, other] of finals) {
        if (otherId === one.id || other.categoryId !== mine.categoryId) continue;
        if (same(other.nameRo, mine.nameRo)) throw new VolunteerRoleRowError(named, "taken", [roleBox(one.row.key, "nameRo")]);
        if (same(other.nameEn, mine.nameEn)) throw new VolunteerRoleRowError(named, "taken", [roleBox(one.row.key, "nameEn")]);
      }
    }

    // ---- 3. What changed, role by role -------------------------------------------------------------
    for (const one of prepared) {
      const current = one.current;
      if (!current) continue;
      const before = { nameRo: current.nameRo, nameEn: current.nameEn, needed: current.needed, colour: current.colour, categoryId: current.categoryId };
      const after = { nameRo: one.input.nameRo, nameEn: one.input.nameEn, needed: one.input.needed, colour: one.colour, categoryId: one.categoryId };
      one.changedFields = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== after[key]);
      if (!sameDescription(current.descriptionRoJson, one.input.descriptionRoJson)) one.changedFields.push("descriptionRo");
      if (!sameDescription(current.descriptionEnJson, one.input.descriptionEnJson)) one.changedFields.push("descriptionEn");
    }

    // ---- 4. The order: each category sorted by the numbers posted ----------------------------------
    type Member = { id: string; position: number; bias: number; tie: number };
    const members = new Map<string | null, Member[]>();
    const place = (categoryId: string | null, member: Member) => members.set(categoryId, [...(members.get(categoryId) ?? []), member]);
    let tie = 0;
    for (const role of stored) {
      const one = preparedById.get(role.id);
      const rank = rankBefore.get(role.id) ?? 0;
      const categoryId = one ? one.categoryId : role.categoryId;
      let position = rank;
      let bias = 0;
      if (one) {
        const typed = one.posted !== null && one.posted !== rank;
        if (categoryId !== role.categoryId) {
          // To another category: its end, unless a number was typed — then that place, before the role it ties with.
          position = typed && one.posted !== null ? one.posted : Number.POSITIVE_INFINITY;
          bias = -0.5;
        } else if (typed && one.posted !== null) {
          position = one.posted;
          bias = one.posted < rank ? -0.5 : 0.5;
        }
      }
      place(categoryId, { id: role.id, position, bias, tie: tie++ });
    }
    for (const one of creating) place(one.categoryId, { id: one.id, position: one.posted ?? Number.POSITIVE_INFINITY, bias: one.posted === null ? 0 : -0.5, tie: tie++ });
    const rankAfter = new Map<string, number>();
    const positionOf = new Map<string, number>();
    let next = 0;
    for (const categoryId of [...categories.map((category) => category.id), null]) {
      const ordered = [...(members.get(categoryId) ?? [])].sort((a, b) => (a.position === b.position ? 0 : a.position < b.position ? -1 : 1) || a.bias - b.bias || a.tie - b.tie);
      ordered.forEach((member, at) => {
        rankAfter.set(member.id, at + 1);
        positionOf.set(member.id, next++);
      });
    }
    // A role's own place counts as an edit only when it typed a number and landed elsewhere: a role pushed along by another is not edited.
    for (const one of prepared) {
      const current = one.current;
      if (!current || one.categoryId !== current.categoryId) continue;
      const rank = rankBefore.get(current.id) ?? 0;
      if (one.posted !== null && one.posted !== rank && rankAfter.get(current.id) !== rank) one.changedFields.push("position");
    }
    const edited = prepared.filter((one) => one.current && one.changedFields.length > 0);
    if (edited.length + creating.length === 0) return { changed: false, edited: 0, created: 0 };

    // ---- 5. The writes ------------------------------------------------------------------------------
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });
    const renamed = edited.filter((one) => one.changedFields.some((field) => field === "nameRo" || field === "nameEn" || field === "categoryId"));
    // Two roles that swap names (or one that takes the name another is leaving) cannot be written one by one under the unique index: park them first.
    const swaps = renamed.some((one) =>
      renamed.some((other) => {
        const mine = finals.get(one.id);
        return other !== one && other.current !== null && mine !== undefined && other.current.categoryId === mine.categoryId && (same(other.current.nameRo, mine.nameRo) || same(other.current.nameEn, mine.nameEn));
      }),
    );
    if (swaps) {
      for (const one of renamed) {
        if (one.current) await tx.update(eventVolunteerRoles).set({ nameRo: one.current.id, nameEn: one.current.id }).where(eq(eventVolunteerRoles.id, one.current.id));
      }
    }
    for (const role of stored) {
      const one = preparedById.get(role.id);
      const position = positionOf.get(role.id) ?? role.position;
      const set: Partial<typeof eventVolunteerRoles.$inferInsert> = {};
      if (one && one.changedFields.some((field) => field !== "position")) {
        Object.assign(set, {
          nameRo: one.input.nameRo,
          nameEn: one.input.nameEn,
          needed: one.input.needed,
          descriptionRoJson: one.input.descriptionRoJson,
          descriptionEnJson: one.input.descriptionEnJson,
          descriptionWordsRo: one.input.descriptionWordsRo,
          descriptionWordsEn: one.input.descriptionWordsEn,
          colour: one.colour,
          categoryId: one.categoryId,
        });
      }
      if (position !== role.position) set.position = position;
      if (Object.keys(set).length > 0) await tx.update(eventVolunteerRoles).set(set).where(eq(eventVolunteerRoles.id, role.id));
    }
    for (const one of edited) {
      const current = one.current;
      if (!current) continue;
      await audit("volunteer_role.edited", {
        roleId: current.id,
        fields: one.changedFields,
        nameRo: one.input.nameRo,
        needed: one.input.needed,
        ...(one.changedFields.includes("categoryId") ? { categoryFrom: current.categoryId, categoryTo: one.categoryId } : {}),
        ...(one.changedFields.includes("colour") ? { colourFrom: current.colour, colourTo: one.colour } : {}),
        ...(one.changedFields.includes("position") ? { positionFrom: rankBefore.get(current.id), positionTo: rankAfter.get(current.id) } : {}),
      });
    }
    for (const one of creating) {
      const [row] = await tx
        .insert(eventVolunteerRoles)
        .values({
          eventId: request.eventId,
          nameRo: one.input.nameRo,
          nameEn: one.input.nameEn,
          needed: one.input.needed,
          descriptionRoJson: one.input.descriptionRoJson,
          descriptionEnJson: one.input.descriptionEnJson,
          descriptionWordsRo: one.input.descriptionWordsRo,
          descriptionWordsEn: one.input.descriptionWordsEn,
          colour: one.colour,
          categoryId: one.categoryId,
          position: positionOf.get(one.id) ?? stored.length,
          createdAt: now,
        })
        .returning({ id: eventVolunteerRoles.id });
      await audit("volunteer_role.added", { roleId: row.id, nameRo: one.input.nameRo, nameEn: one.input.nameEn, needed: one.input.needed, colour: one.colour, categoryId: one.categoryId });
    }
    return { changed: true, edited: edited.length, created: creating.length };
  });
  // The public page lists the roles and what each still needs: it is told once for the whole save, after the write has committed.
  if (result.changed) revalidatePublicContent("places");
  return result;
}

export type VolunteerCategoryRequest =
  | { kind: "add"; eventId: string; fields: Record<string, unknown> }
  | { kind: "edit"; eventId: string; id: string; fields: Record<string, unknown> }
  /** «Persoana de contact»: the three boxes of one category, saved by the category's own form. */
  | { kind: "contact"; eventId: string; id: string; fields: Record<string, unknown> }
  | { kind: "move"; eventId: string; id: string; direction: "up" | "down" }
  | { kind: "delete"; eventId: string; id: string };

export type VolunteerCategoryResult = { changed: boolean; category: { id: string; nameRo: string } };

const CATEGORY_FIELDS = ["nameRo", "nameEn"] as const;
const CONTACT_FIELDS = ["contactName", "contactPhone", "contactEmail"] as const;

/**
 * One change to one event's volunteer categories (§774; the owner, 2026-10-14: «categorii cu sub-categorii … Toate astea
 * configurabile», and «the contact person for each category will be established later»), by one staff member: add a category,
 * rename it, move it one step in the club's order, set its contact person, delete it. Refuses a person who may not (FORBIDDEN, as
 * the roles' own), a name typed wrong (VALIDATION_ERROR naming `nameRo` / `nameEn`: both, never one), a contact address that is
 * no address (naming `contactEmail`), a name already on the event (VOLUNTEER_NAME_TAKEN), an event or a category that is not there
 * — or one of another event — (NOT_FOUND), and a delete while any role sits under it (VOLUNTEER_CATEGORY_HAS_ROLES: move or delete
 * the roles first). A press that changes nothing writes and records nothing; the trail names the boxes that changed and never a
 * contact's words.
 */
export async function changeVolunteerCategory<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: VolunteerCategoryRequest,
  now: Date,
): Promise<VolunteerCategoryResult> {
  assertMayManage(actor);
  assertIds(request.eventId, ...(request.kind === "add" ? [] : [request.id]));
  const refuse = (error: z.ZodError) =>
    new DomainError("VALIDATION_ERROR", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), refusedFields(error));
  let named: { nameRo: string; nameEn: string } | null = null;
  if (request.kind === "add" || request.kind === "edit") {
    const parsed = volunteerCategoryInputSchema.safeParse(postedStrings(request.fields, CATEGORY_FIELDS));
    if (!parsed.success) throw refuse(parsed.error);
    named = parsed.data;
  }
  let contact: { contactName: string | null; contactPhone: string | null; contactEmail: string | null } | null = null;
  if (request.kind === "contact") {
    const parsed = volunteerCategoryContactSchema.safeParse(postedStrings(request.fields, CONTACT_FIELDS));
    if (!parsed.success) throw refuse(parsed.error);
    contact = parsed.data;
  }

  const result = await db.transaction(async (tx): Promise<VolunteerCategoryResult> => {
    // The event's row first, as the roles' change does (NO KEY UPDATE: a sign-up's foreign key is not made to wait), then the
    // categories in the order of their ids: the order a role's change locks them (§774), so the two never wait in a circle.
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });
    const categories = (
      await tx.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, request.eventId)).orderBy(asc(eventVolunteerCategories.id)).for("update")
    ).sort(compareCategories);
    const assertNameFree = (names: { nameRo: string; nameEn: string }, exceptId: string | null) => {
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      for (const other of categories) {
        if (other.id === exceptId) continue;
        if (same(other.nameRo, names.nameRo)) throw new DomainError("VOLUNTEER_NAME_TAKEN", "a category of that name is already on this event", ["nameRo"]);
        if (same(other.nameEn, names.nameEn)) throw new DomainError("VOLUNTEER_NAME_TAKEN", "a category of that name is already on this event", ["nameEn"]);
      }
    };

    if (request.kind === "add" && named) {
      if (categories.length >= VOLUNTEER_CATEGORIES_MAX) {
        throw new DomainError("VALIDATION_ERROR", `an event takes at most ${VOLUNTEER_CATEGORIES_MAX} categories`, ["nameRo"]);
      }
      assertNameFree(named, null);
      const [row] = await tx
        .insert(eventVolunteerCategories)
        .values({
          eventId: request.eventId,
          nameRo: named.nameRo,
          nameEn: named.nameEn,
          sort: categories.length === 0 ? 0 : Math.max(...categories.map((category) => category.sort)) + 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: eventVolunteerCategories.id });
      await audit("volunteer_category.added", { categoryId: row.id, nameRo: named.nameRo, nameEn: named.nameEn });
      return { changed: true, category: { id: row.id, nameRo: named.nameRo } };
    }

    const current = categories.find((category) => category.id === (request.kind === "add" ? "" : request.id));
    if (!current) throw new DomainError("NOT_FOUND", "the category is not there");
    const summary = { id: current.id, nameRo: current.nameRo };

    if (request.kind === "delete") {
      const [roles] = await tx.select({ n: count() }).from(eventVolunteerRoles).where(eq(eventVolunteerRoles.categoryId, current.id));
      if ((roles?.n ?? 0) > 0) throw new DomainError("VOLUNTEER_CATEGORY_HAS_ROLES", "move or delete the roles under it first", ["categoryId"]);
      await tx.delete(eventVolunteerCategories).where(eq(eventVolunteerCategories.id, current.id));
      await audit("volunteer_category.deleted", { categoryId: current.id, nameRo: current.nameRo, nameEn: current.nameEn });
      return { changed: true, category: summary };
    }

    if (request.kind === "move") {
      const index = categories.findIndex((category) => category.id === current.id);
      const target = request.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= categories.length) return { changed: false, category: summary };
      const order = categories.map((category) => category.id);
      [order[index], order[target]] = [order[target], order[index]];
      // Positions 0..n-1 in the new order: a total order, whatever the gaps a delete left.
      for (const [sort, id] of order.entries()) {
        await tx.update(eventVolunteerCategories).set({ sort }).where(eq(eventVolunteerCategories.id, id));
      }
      await audit("volunteer_category.moved", { categoryId: current.id, nameRo: current.nameRo, direction: request.direction });
      return { changed: true, category: summary };
    }

    if (request.kind === "contact") {
      if (!contact) throw new DomainError("VALIDATION_ERROR", "nothing to save");
      const changedFields = CONTACT_FIELDS.filter((box) => current[box] !== contact[box]);
      if (changedFields.length === 0) return { changed: false, category: summary };
      await tx.update(eventVolunteerCategories).set({ ...contact, updatedAt: now }).where(eq(eventVolunteerCategories.id, current.id));
      // The boxes that changed, never their words: a contact person is a third person's name and number.
      await audit("volunteer_category.contact_edited", { categoryId: current.id, nameRo: current.nameRo, fields: changedFields });
      return { changed: true, category: summary };
    }

    // «Salvează» on a category: both names.
    if (!named) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    assertNameFree(named, current.id);
    const changedFields = CATEGORY_FIELDS.filter((box) => current[box] !== named[box]);
    if (changedFields.length === 0) return { changed: false, category: summary };
    await tx.update(eventVolunteerCategories).set({ nameRo: named.nameRo, nameEn: named.nameEn, updatedAt: now }).where(eq(eventVolunteerCategories.id, current.id));
    await audit("volunteer_category.edited", { categoryId: current.id, fields: changedFields, nameRo: named.nameRo, nameEn: named.nameEn });
    return { changed: true, category: { id: current.id, nameRo: named.nameRo } };
  });
  // The public page draws the headings and their contact: it is told once the write has committed.
  if (result.changed) revalidatePublicContent("places");
  return result;
}

/**
 * «Primește voluntari» on or off (§754): the event's own tick, in the volunteers' card's own form — the
 * editor's save never writes it. Switching it off hides the public form and keeps every role and every
 * person; nothing is deleted by a switch.
 */
export async function setAcceptsVolunteers<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; on: boolean },
  now: Date,
): Promise<{ changed: boolean }> {
  assertMayManage(actor);
  assertIds(request.eventId);
  const result = await db.transaction(async (tx) => {
    // NO KEY UPDATE, the strength the UPDATE below takes anyway: a sign-up's foreign-key check is not made to wait.
    const [event] = await tx.select({ on: events.acceptsVolunteers }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (event.on === request.on) return { changed: false };
    // Not `events.version`: the tick is no edit of the page's text and must not make an open editor's save stale.
    await tx.update(events).set({ acceptsVolunteers: request.on }).where(eq(events.id, request.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteers_switched",
      entityType: "event",
      entityId: request.eventId,
      metadata: { on: request.on },
      now,
    });
    return { changed: true };
  });
  if (result.changed) revalidatePublicContent("events", "places");
  return result;
}

/**
 * «Oferim tricouri voluntarilor» on or off (§765; the owner, 2026-10-14: «acum nu vom da tricouri»): the event's own
 * tick, saved by the «Voluntari» card's own form like «Primește voluntari» — never by the editor's save. Switching it
 * off keeps every size already given (they are shown nowhere meanwhile, `shirtSizeShown`); nothing is deleted by it.
 */
export async function setVolunteersShirts<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; on: boolean },
  now: Date,
): Promise<{ changed: boolean }> {
  assertMayManage(actor);
  assertIds(request.eventId);
  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select({ on: events.volunteersShirts }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (event.on === request.on) return { changed: false };
    // Not `events.version`, like the other tick: it is no edit of the page's text and must not make an open editor's save stale.
    await tx.update(events).set({ volunteersShirts: request.on }).where(eq(events.id, request.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteers_shirts_switched",
      entityType: "event",
      entityId: request.eventId,
      metadata: { on: request.on },
      now,
    });
    return { changed: true };
  });
  // The public form asks the size only while the tick is on: the page is told once the write has committed.
  if (result.changed) revalidatePublicContent("events", "places");
  return result;
}

/**
 * «Arată public câți voluntari mai sunt necesari» on or off (§773; the owner, 2026-10-14: «vreau să bifez dacă să afișez sau
 * nu numărătoarea voluntarilor — știi că am mai avut probleme din astea»; the waiting list's «Arată public câți așteaptă» is
 * the model, §634): the event's own tick, saved by the «Voluntari» card's own form like the two above — never by the editor's
 * save. Off by default. Switching it changes only what the public page says: the roles, the people and the card's counts are
 * untouched, and a role that is full stays unoffered either way (§761).
 */
export async function setVolunteersShowCounts<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: { eventId: string; on: boolean },
  now: Date,
): Promise<{ changed: boolean }> {
  assertMayManage(actor);
  assertIds(request.eventId);
  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select({ on: events.volunteersShowCounts }).from(events).where(eq(events.id, request.eventId)).for("no key update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    if (event.on === request.on) return { changed: false };
    // Not `events.version`, like the other two ticks: it is no edit of the page's text and must not make an open editor's save stale.
    await tx.update(events).set({ volunteersShowCounts: request.on }).where(eq(events.id, request.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event.volunteers_counts_switched",
      entityType: "event",
      entityId: request.eventId,
      metadata: { on: request.on },
      now,
    });
    return { changed: true };
  });
  // The volunteers' page reads the tick through the public cache: it is told once the write has committed.
  if (result.changed) revalidatePublicContent("events", "places");
  return result;
}

const STAFF_FIELDS = ["assignedRoleId", "name", "email", "phone", "note", "birthDate", "sex", "city", "shirtSize", "guardianName", "guardianEmail"] as const;

/**
 * The day an event's volunteers' ages are counted on (§773, `volunteerEventDay`): the gun's day, else the event's, in the event's own
 * zone — read from the event's row. A missing event is the same refusal every other verb gives.
 */
async function eventDayOf<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<string> {
  const [event] = await db
    .select({ startsAt: events.startsAt, raceStartsAt: events.raceStartsAt, timezone: events.timezone, dateToBeAnnounced: events.dateToBeAnnounced })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  return volunteerEventDay(event, now);
}

export type VolunteerRequest =
  | { kind: "add"; eventId: string; fields: Record<string, unknown> }
  | { kind: "edit"; eventId: string; id: string; fields: Record<string, unknown> }
  | { kind: "setState"; eventId: string; id: string; state: unknown }
  /** «Dă-i rolul …» (§761): the organizers give the person one role of the event, ticked by them or not. */
  | { kind: "assign"; eventId: string; id: string; roleId: unknown }
  | { kind: "delete"; eventId: string; id: string };

export type VolunteerResult = { changed: boolean; volunteer: { id: string } };

/** The ticked roles as a form posts them: every value of `roleIds` (one box, or several), strings only. */
function postedIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value !== "" ? [value] : [];
}

function staffInputOf(fields: Record<string, unknown>, eventDay: string, keptAge: number | null) {
  const parsed = volunteerStaffInputSchemaFor(eventDay, keptAge).safeParse({
    ...postedStrings(fields, STAFF_FIELDS),
    roleIds: postedIds(fields.roleIds),
    // The ticks (§765): true only when the form posted them.
    volunteeredBefore: fields.volunteeredBefore === true,
    clubMember: fields.clubMember === true,
  });
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), refusedFields(parsed.error));
  }
  let identity;
  try {
    identity = canonicalizeEmail(parsed.data.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }
  return { ...parsed.data, choiceIds: choicesWithAssigned(parsed.data), identity };
}

/**
 * A date of birth typed on the card that makes a person under eighteen on the event's day while the club cannot take a minor (§768), when
 * the parse refused the parent's boxes: the card draws those boxes only while minors are open or the person already is one, so the
 * refusal is on `birthDate` — the box the organizer can see — with the minors-closed sentence, never on a box that is not there. Null
 * when the refusal is something else.
 */
async function minorsClosedRefusal<T extends Record<string, unknown>>(
  db: Database<T>,
  request: Extract<VolunteerRequest, { kind: "add" | "edit" }>,
  error: unknown,
  eventDay: string,
  now: Date,
): Promise<DomainError | null> {
  if (!(error instanceof DomainError) || error.code !== "VALIDATION_ERROR") return null;
  if (!error.fields.some((field) => field === "guardianName" || field === "guardianEmail")) return null;
  const typed = typeof request.fields.birthDate === "string" ? readTypedDate(request.fields.birthDate) : "";
  const age = typed === "" ? null : volunteerAgeOn(typed, eventDay);
  if (age === null || age < VOLUNTEER_MINIMUM_AGE || !isVolunteerMinor(age)) return null;
  if (request.kind === "edit" && isUuid(request.id)) {
    // A person who already is under eighteen has the boxes drawn: their refusal is the boxes'.
    const [held] = await db.select({ age: eventVolunteers.age }).from(eventVolunteers).where(eq(eventVolunteers.id, request.id)).limit(1);
    if (held && isVolunteerMinor(held.age)) return null;
  }
  if (await volunteerMinorsOpen(db, now)) return null;
  return new DomainError("VALIDATION_ERROR", "the club cannot take volunteers under eighteen yet", ["birthDate", ...error.fields.filter((field) => field !== "guardianName" && field !== "guardianEmail")]);
}

/** The answers a person says about themselves, which only a privacy notice that names them (`{{volunteerProfile}}`) lets the platform keep (§765, §773: the date of birth is the age's box). */
const PROFILE_BOXES = ["birthDate", "sex", "city", "volunteeredBefore", "clubMember", "shirtSize"] as const;

/**
 * Staff enter those answers under the same gate as the public form (§765, the §562 / §613 pattern): while the notice in
 * force does not name them, an organizer's post that carries one — one that differs from what the row already holds —
 * is refused, naming the boxes. The card does not draw the boxes then, so only a forged or stale post reaches this.
 * A size for an event that gives no shirt is ignored, as it always was.
 */
function refuseUnnamedProfile(
  input: Pick<ReturnType<typeof staffInputOf>, (typeof PROFILE_BOXES)[number]>,
  current: { dateOfBirth: string | null; sex: SexChoice | "UNSPECIFIED" | null; city: string | null; volunteeredBefore: boolean; clubMember: boolean; shirtSize: string | null } | null,
  shirts: boolean,
): void {
  const refused = PROFILE_BOXES.filter((box) => {
    const posted = input[box];
    if (posted === null || posted === false) return false;
    if (box === "shirtSize" && !shirts) return false;
    if (!current) return true;
    const held = box === "sex" ? sexShown(current.sex) : box === "birthDate" ? current.dateOfBirth : current[box];
    return held !== posted;
  });
  if (refused.length > 0) throw new DomainError("VALIDATION_ERROR", "the privacy notice in force does not name these answers yet", [...refused]);
}

/** The row's columns for what a save changed: the form's `birthDate` is the column `date_of_birth` (§773). */
function columnsOf<R extends { birthDate: string | null }>(next: R): Omit<R, "birthDate"> & { dateOfBirth: string | null } {
  const { birthDate, ...rest } = next;
  return { ...rest, dateOfBirth: birthDate };
}

const alreadyListed = () => new DomainError("VOLUNTEER_ALREADY_LISTED", "this address is already on the event's volunteers", ["email"]);

/** PostgreSQL's unique violation (23505) on one event's addresses, wherever the driver nests it. */
function isAddressClash(error: unknown): boolean {
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth < 5; cause = (cause as { cause?: unknown }).cause, depth++) {
    const { code, constraint, message } = cause as { code?: unknown; constraint?: unknown; message?: unknown };
    if (code !== "23505") continue;
    const name = "event_volunteers_event_canonical_email_unique";
    if (constraint === name || (typeof message === "string" && message.includes(name))) return true;
  }
  return false;
}

/** The same ids, whatever their order. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The one short email that names the role the organizers gave a volunteer (§761), through the outbox in the same
 * transaction as the change, in the person's language. Never to a cancelled person (nothing to do), and withdrawn at
 * the send when the role was changed again or the person cancelled meanwhile (`render.ts`), so only the role that
 * stands is ever announced. Each assignment is its own message: the moment and why it is sent are in the key —
 * `given`, `readdressed` (the role kept, the address corrected) or `reopened` (a cancelled person back with a role).
 */
async function queueRoleAssigned<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  volunteer: { id: string; eventId: string; email: string; locale: Locale; state: VolunteerState },
  roleId: string,
  actorId: string,
  now: Date,
  why: "given" | "readdressed" | "reopened" = "given",
): Promise<void> {
  if (volunteer.state === "CANCELLED") return;
  await enqueueEmail(tx, {
    participantId: null,
    registrationId: null,
    messageType: "VOLUNTEER_ROLE_ASSIGNED",
    locale: volunteer.locale,
    recipientEmail: volunteer.email,
    payload: { eventId: volunteer.eventId, volunteerId: volunteer.id, roleId },
    idempotencyKey: `volunteer:${volunteer.id}:assigned:${roleId}:${why}:${now.getTime()}`,
    requestedByStaffUserId: actorId,
    now,
  });
}

/**
 * One change to one event's volunteers, by one staff member: enter one by hand, change what was typed
 * (the name, the address, the telephone number, the roles they would do, the role given, the organizers' note),
 * give them a role («Dă-i rolul …», §761), confirm or cancel, delete. The address goes through the canonicalizer
 * and is unique per event (`VOLUNTEER_ALREADY_LISTED`, naming the box); every role ticked or given must be this
 * event's (VALIDATION_ERROR naming `roleIds`, `assignedRoleId` or `roleId`); a person who is not there, or is on
 * another event, is NOT_FOUND; a cancelled person is given no role (CONFLICT: reopen first). A role may be given to
 * more people than it asked (the card then reads «3 din 2»). A press that changes nothing writes nothing. Every
 * change is audited with the ids and the names of the fields — never the person's own words — and every new role
 * given is told to the person by one email (`VOLUNTEER_ROLE_ASSIGNED`).
 */
export async function changeVolunteer<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  request: VolunteerRequest,
  now: Date,
): Promise<VolunteerResult> {
  assertMayManage(actor);
  assertIds(request.eventId, ...(request.kind === "add" ? [] : [request.id]));
  let input: ReturnType<typeof staffInputOf> | null = null;
  // What an empty date box means on a row from before the date existed (§773): the age it holds, kept — see `volunteerStaffInputSchemaFor`.
  let keptAge: number | null = null;
  if (request.kind === "add" || request.kind === "edit") {
    // The person's age is the date's on the event's day: the gun's, else the event's (`volunteerEventDay`).
    const eventDay = await eventDayOf(db, request.eventId, now);
    if (request.kind === "edit") {
      const [held] = await db
        .select({ age: eventVolunteers.age, dateOfBirth: eventVolunteers.dateOfBirth })
        .from(eventVolunteers)
        .where(and(eq(eventVolunteers.id, request.id), eq(eventVolunteers.eventId, request.eventId)))
        .limit(1);
      keptAge = held && held.dateOfBirth === null ? held.age : null;
    }
    try {
      input = staffInputOf(request.fields, eventDay, keptAge);
    } catch (error) {
      throw (await minorsClosedRefusal(db, request, error, eventDay, now)) ?? error;
    }
  }
  // Whether the notice in force names the profile answers (§765): read before the transaction, like the public sign-up does.
  const profileDescribed = input ? await noticeDescribesVolunteerProfile(db, now) : true;
  // Whether the club may take a person under eighteen (§768): asked only when this entry says one — a card save of a person already
  // under eighteen is never held up by a text withdrawn since, but nobody new is put under eighteen without the texts.
  const minorsOpen = input?.guardian ? await volunteerMinorsOpen(db, now) : true;
  const state =
    request.kind === "setState"
      ? (VOLUNTEER_STATES as readonly unknown[]).includes(request.state)
        ? (request.state as VolunteerState)
        : null
      : null;
  if (request.kind === "setState" && !state) throw new DomainError("VALIDATION_ERROR", "that is not a state", ["state"]);
  const assigned = request.kind === "assign" && typeof request.roleId === "string" ? request.roleId.trim() : "";
  if (request.kind === "assign" && !isUuid(assigned)) throw new DomainError("VALIDATION_ERROR", "that is not a role", ["roleId"]);

  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id, shirts: events.volunteersShirts }).from(events).where(eq(events.id, request.eventId)).limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });

    // A verb that writes a reference to a role — the role given, the roles ticked — locks the event's roles first, in
    // the order of their ids: the order a sign-up locks the roles it ticked and a role change locks them all (§761).
    // Without it the insert's foreign keys take KEY SHARE on each role in the order posted, and a hand entry naming
    // two roles against a sign-up ticking both waits in a circle (40P01) — one side aborted, someone's typing lost.
    if (request.kind === "add" || request.kind === "edit" || request.kind === "assign") {
      await tx
        .select({ id: eventVolunteerRoles.id })
        .from(eventVolunteerRoles)
        .where(eq(eventVolunteerRoles.eventId, request.eventId))
        .orderBy(asc(eventVolunteerRoles.id))
        .for("update");
    }

    /** Every id this event's role, or the refusal naming the box it came from. */
    const assertEventRoles = async (ids: readonly string[], box: string) => {
      if (ids.length === 0) return;
      const found = await tx
        .select({ id: eventVolunteerRoles.id })
        .from(eventVolunteerRoles)
        .where(and(inArray(eventVolunteerRoles.id, [...ids]), eq(eventVolunteerRoles.eventId, request.eventId)));
      if (found.length !== new Set(ids).size) throw new DomainError("VALIDATION_ERROR", "that role is not this event's", [box]);
    };
    const holderOf = async (canonicalEmail: string) => {
      const [row] = await tx
        .select({ id: eventVolunteers.id })
        .from(eventVolunteers)
        .where(and(eq(eventVolunteers.eventId, request.eventId), eq(eventVolunteers.canonicalEmail, canonicalEmail)))
        .limit(1);
      return row;
    };
    /** The person's choices become exactly `ids`: the ones no longer ticked go, the new ones come. */
    const writeChoices = async (volunteerId: string, ids: readonly string[]) => {
      await tx
        .delete(eventVolunteerRoleChoices)
        .where(
          ids.length > 0
            ? and(eq(eventVolunteerRoleChoices.volunteerId, volunteerId), notInArray(eventVolunteerRoleChoices.roleId, [...ids]))
            : eq(eventVolunteerRoleChoices.volunteerId, volunteerId),
        );
      if (ids.length > 0) {
        await tx
          .insert(eventVolunteerRoleChoices)
          // In the order of the ids, as the roles were locked above.
          .values([...ids].sort().map((roleId) => ({ volunteerId, roleId, createdAt: now })))
          .onConflictDoNothing();
      }
    };

    if (request.kind === "add" && input) {
      await assertEventRoles(input.roleIds, "roleIds");
      if (input.assignedRoleId) await assertEventRoles([input.assignedRoleId], "assignedRoleId");
      if (await holderOf(input.identity.canonicalEmail)) throw alreadyListed();
      if (!profileDescribed) refuseUnnamedProfile(input, null, event.shirts);
      if (input.guardian && !minorsOpen) throw new DomainError("VALIDATION_ERROR", "the club cannot take volunteers under eighteen yet", ["birthDate"]);
      const [row] = await tx
        .insert(eventVolunteers)
        .values({
          eventId: request.eventId,
          roleId: input.assignedRoleId,
          name: input.name,
          email: input.identity.deliveryEmail,
          canonicalEmail: input.identity.canonicalEmail,
          canonicalizationVersion: input.identity.canonicalizationVersion,
          phone: input.phone,
          state: "REGISTERED",
          source: "STAFF",
          note: input.note,
          // The date of birth and its age on the event's day (§773): `age` is what every rule reads, the date is what the club asked for.
          age: input.age,
          dateOfBirth: input.birthDate,
          sex: input.sex,
          city: input.city,
          volunteeredBefore: input.volunteeredBefore,
          clubMember: input.clubMember,
          // A size only while the event gives a shirt (§765); a stale form posting one for an event without is ignored.
          shirtSize: event.shirts ? input.shirtSize : null,
          // The parent or guardian of a person under eighteen (§768): their name, and the address when the organizer has one.
          guardianName: input.guardian?.name ?? null,
          guardianEmail: input.guardian?.email ?? null,
          createdByStaffUserId: actor.id,
          createdAt: now,
          updatedAt: now,
        })
        // A public sign-up of the same address may commit between the check above and this insert: the
        // constraint decides, and the organizer hears the same sentence, never a database error.
        .onConflictDoNothing({ target: [eventVolunteers.eventId, eventVolunteers.canonicalEmail] })
        .returning({ id: eventVolunteers.id, eventId: eventVolunteers.eventId, email: eventVolunteers.email, locale: eventVolunteers.locale, state: eventVolunteers.state });
      if (!row) throw alreadyListed();
      await writeChoices(row.id, input.choiceIds);
      await audit("volunteer.added", { volunteerId: row.id, roleId: input.assignedRoleId, roleIds: input.choiceIds });
      if (input.assignedRoleId) await queueRoleAssigned(tx, row, input.assignedRoleId, actor.id, now);
      return { changed: true, volunteer: { id: row.id } };
    }

    const [current] = await tx
      .select()
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.id, request.kind === "add" ? "" : request.id), eq(eventVolunteers.eventId, request.eventId)))
      .for("update")
      .limit(1);
    if (!current) throw new DomainError("NOT_FOUND", "the volunteer is not there");
    const summary = { id: current.id };

    if (request.kind === "delete") {
      // The person's choices go with them (CASCADE).
      await tx.delete(eventVolunteers).where(eq(eventVolunteers.id, current.id));
      await audit("volunteer.deleted", { volunteerId: current.id, roleId: current.roleId, state: current.state });
      return { changed: true, volunteer: summary };
    }

    if (request.kind === "setState" && state) {
      if (current.state === state) return { changed: false, volunteer: summary };
      // A volunteer under eighteen is confirmed only once their parent or guardian has accepted the agreement (§768): «Acordul părintelui lipsește».
      if (state === "CONFIRMED" && !guardianAllowsConfirm(current)) {
        throw new DomainError("VOLUNTEER_GUARDIAN_MISSING", "the parent's or guardian's agreement is missing", ["guardian"]);
      }
      await tx.update(eventVolunteers).set({ state, updatedAt: now }).where(eq(eventVolunteers.id, current.id));
      await audit("volunteer.state_changed", { volunteerId: current.id, roleId: current.roleId, from: current.state, to: state });
      // A cancelled person reopened with a role given is told it: the email queued when it was given was withdrawn at
      // the send while they were cancelled, or never queued (`queueRoleAssigned`), and the receipt promised one.
      if (current.state === "CANCELLED" && current.roleId) await queueRoleAssigned(tx, { ...current, state }, current.roleId, actor.id, now, "reopened");
      return { changed: true, volunteer: summary };
    }

    if (request.kind === "assign") {
      await assertEventRoles([assigned], "roleId");
      if (current.state === "CANCELLED") throw new DomainError("CONFLICT", "a cancelled volunteer is given no role: reopen them first");
      if (current.roleId === assigned) return { changed: false, volunteer: summary };
      await tx.update(eventVolunteers).set({ roleId: assigned, updatedAt: now }).where(eq(eventVolunteers.id, current.id));
      await audit("volunteer.assigned", { volunteerId: current.id, roleId: assigned, from: current.roleId });
      await queueRoleAssigned(tx, current, assigned, actor.id, now);
      return { changed: true, volunteer: summary };
    }

    // «Salvează» on a volunteer: every box, the roles ticked and the role given included.
    if (!input) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    await assertEventRoles(input.roleIds, "roleIds");
    if (input.assignedRoleId) await assertEventRoles([input.assignedRoleId], "assignedRoleId");
    // The same line «Dă-i rolul» holds: a cancelled person is given no new role — reopen them first. Taking a role
    // back, or keeping the one they had, is still an edit.
    if (current.state === "CANCELLED" && input.assignedRoleId && input.assignedRoleId !== current.roleId) {
      throw new DomainError("CONFLICT", "a cancelled volunteer is given no role: reopen them first");
    }
    if (input.identity.canonicalEmail !== current.canonicalEmail) {
      const holder = await holderOf(input.identity.canonicalEmail);
      if (holder && holder.id !== current.id) throw alreadyListed();
    }
    if (!profileDescribed) refuseUnnamedProfile(input, current, event.shirts);
    // The age an empty date box kept was read before this transaction: a row that changed meanwhile is the organizer's to look at again.
    if (profileDescribed && input.birthDate === null && (current.dateOfBirth === null ? current.age : null) !== keptAge) {
      throw new DomainError("CONFLICT", "the volunteer changed while the form was open");
    }
    // While the notice names none of them the boxes are not drawn: what the row holds stays as it was, shown by the card as before.
    const profile = profileDescribed
      ? {
          // The age is the date's on the event's day, or — an empty date box on a row from before the date — the one it held (§773).
          age: input.age,
          birthDate: input.birthDate,
          sex: input.sex,
          city: input.city,
          volunteeredBefore: input.volunteeredBefore,
          clubMember: input.clubMember,
          // While the event gives no shirt the box is not drawn: the size stays as it was, shown nowhere (§765).
          shirtSize: event.shirts ? input.shirtSize : current.shirtSize,
        }
      : {
          age: current.age,
          birthDate: current.dateOfBirth,
          sex: sexShown(current.sex),
          city: current.city,
          volunteeredBefore: current.volunteeredBefore,
          clubMember: current.clubMember,
          shirtSize: current.shirtSize,
        };
    // `age` is derived from the date: the trail names the date's box, and the age alone only when it moved with no new date (an event moved).
    const { age: nextAge, ...nextAnswers } = profile;
    const next = {
      roleId: input.assignedRoleId,
      name: input.name,
      email: input.identity.deliveryEmail,
      phone: input.phone,
      note: input.note,
      ...nextAnswers,
    };
    const before = {
      roleId: current.roleId,
      name: current.name,
      email: current.email,
      phone: current.phone,
      note: current.note,
      birthDate: current.dateOfBirth,
      // The retired «Prefer să nu spun» reads as no answer, as it does everywhere (`sexShown`).
      sex: sexShown(current.sex),
      city: current.city,
      volunteeredBefore: current.volunteeredBefore,
      clubMember: current.clubMember,
      shirtSize: current.shirtSize,
    };
    const choicesBefore = (
      await tx.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, current.id))
    ).map((row) => row.roleId);
    const changedFields: string[] = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== next[key]);
    if (!sameIds(choicesBefore, input.choiceIds)) changedFields.push("roleIds");
    if (nextAge !== current.age && !changedFields.includes("birthDate")) changedFields.push("age");

    // The parent or guardian follows the age typed (§768): a person under eighteen has one — the name, and the address if
    // the organizer has it; an age of eighteen or more (or none) keeps no third person's data, so the guardian's columns,
    // an acceptance included, are cleared. While the notice names no profile the age is not drawn and the guardian stays as it is.
    // A guardian who has accepted is not renamed or readdressed under their acceptance.
    let guardianSet: Partial<typeof eventVolunteers.$inferInsert> = {};
    if (profileDescribed) {
      if (input.guardian) {
        if (!minorsOpen && !isVolunteerMinor(current.age)) throw new DomainError("VALIDATION_ERROR", "the club cannot take volunteers under eighteen yet", ["birthDate"]);
        // «Confirmat» is the guardian's consent's state (setState's rule): a confirmed person who becomes a minor is refused, not
        // quietly demoted — the organizer moves them back to «Înscris» first, then the consent is asked.
        if (current.state === "CONFIRMED" && current.guardianAcceptedAt === null) {
          throw new DomainError("VOLUNTEER_GUARDIAN_MISSING", "the parent's or guardian's agreement is missing", ["birthDate"]);
        }
        const nameChanged = input.guardian.name !== current.guardianName;
        const emailChanged = canonicalOrNull(input.guardian.email ?? "") !== canonicalOrNull(current.guardianEmail ?? "");
        if (current.guardianAcceptedAt && (nameChanged || emailChanged)) {
          throw new DomainError("VALIDATION_ERROR", "the guardian has accepted: their name and address are fixed", ["guardianName", "guardianEmail"]);
        }
        if (nameChanged) changedFields.push("guardianName");
        if (emailChanged) changedFields.push("guardianEmail");
        guardianSet = {
          guardianName: input.guardian.name,
          guardianEmail: input.guardian.email,
          // A changed guardian address kills a live guardian link (§12.8): it went to the old one.
          ...(emailChanged ? { guardianTokenHash: null, guardianTokenExpiresAt: null } : {}),
        };
      } else if (current.guardianName !== null) {
        changedFields.push("guardianCleared");
        guardianSet = {
          guardianName: null,
          guardianEmail: null,
          guardianDocumentId: null,
          guardianAcceptedAt: null,
          guardianMethod: null,
          guardianLocale: null,
          guardianTextHash: null,
          guardianFacts: null,
          guardianTypedName: null,
          guardianRecordedByStaffUserId: null,
          guardianIp: null,
          guardianUserAgent: null,
          guardianTokenHash: null,
          guardianTokenExpiresAt: null,
          guardianRequestedAt: null,
        };
      }
    }
    if (changedFields.length === 0) return { changed: false, volunteer: summary };
    try {
      await tx
        .update(eventVolunteers)
        .set({
          ...columnsOf(next),
          age: nextAge,
          ...guardianSet,
          canonicalEmail: input.identity.canonicalEmail,
          canonicalizationVersion: input.identity.canonicalizationVersion,
          // A changed address kills a live agreement link (§758, §12.8): it went to the old one.
          ...(changedFields.includes("email") ? { agreementTokenHash: null, agreementTokenExpiresAt: null } : {}),
          updatedAt: now,
        })
        .where(eq(eventVolunteers.id, current.id));
    } catch (error) {
      // The same race on a changed address: a sign-up of it committed after the check. The transaction is lost
      // either way; the organizer hears the sentence, not the database.
      if (isAddressClash(error)) throw alreadyListed();
      throw error;
    }
    if (changedFields.includes("roleIds")) await writeChoices(current.id, input.choiceIds);
    await audit("volunteer.edited", { volunteerId: current.id, fields: changedFields, roleId: input.assignedRoleId });
    // A role newly given is told to the person, at the address the row now holds — and so is a role kept when the
    // address was corrected: the earlier email went to the old address (or is withdrawn at the send for it).
    const addressCorrected = input.identity.canonicalEmail !== current.canonicalEmail;
    if (input.assignedRoleId && (input.assignedRoleId !== current.roleId || addressCorrected)) {
      const why = input.assignedRoleId !== current.roleId ? "given" : "readdressed";
      await queueRoleAssigned(tx, { ...current, email: next.email }, input.assignedRoleId, actor.id, now, why);
    }
    return { changed: true, volunteer: summary };
  });
  if (result.changed) revalidatePublicContent("places");
  return result;
}

/**
 * The volunteers' export (§754), «Descarcă CSV»: the same rows the card lists, recorded as
 * `volunteer.exported` with the count and never a value — a file that leaves the application is a copy
 * the retention sweep cannot reach, which is why the trail says it was made.
 */
export async function exportVolunteers<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  now: Date,
): Promise<{ roles: VolunteerRole[]; categories: VolunteerCategory[]; volunteers: VolunteerItem[]; shirts: boolean }> {
  assertMayManage(actor);
  assertIds(eventId);
  const [event] = await db.select({ id: events.id, shirts: events.volunteersShirts }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  const roles = await listVolunteerRoles(db, eventId);
  // The categories name a role in the file («Direcționare (Traseu)»); their contact person never goes into it.
  const categories = await listVolunteerCategories(db, eventId);
  const volunteers = await listVolunteers(db, eventId);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "volunteer.exported",
    entityType: "event",
    entityId: eventId,
    metadata: { rows: volunteers.length },
    now,
  });
  return { roles, categories, volunteers, shirts: event.shirts };
}

// ---------------------------------------------------------------------------------------------
// The public sign-up
// ---------------------------------------------------------------------------------------------

export type VolunteerSubmitOutcome =
  /** Whatever it found — new, a repeat, a bot's — the page says «am primit». */
  | { outcome: "done" }
  /** The address's hour, or the event's, is spent: said plainly, because a person is not a bot. */
  | { outcome: "limited" }
  /** Every role ticked filled while the form was open: the page offers the roles that still need people. */
  | { outcome: "full" };

/**
 * A person's offer from an event's page. Refuses — as the person's own fix, `VALIDATION_ERROR` naming each
 * box — a malformed address or telephone number, a missing name, no role ticked or one that is not this event's
 * (`roleIds`), or the consent, agreement or age tick not given; and — `CONFLICT`, the page offers no form then — an
 * event that does not take volunteers, is cancelled or over, is not published, whose privacy notice in force does
 * not describe volunteers, while no volunteer agreement is in force, or while that notice does not describe the
 * agreement's acceptance (`volunteerOfferClosedFor`, asked again here: the page's cache is not the gate).
 *
 * «Ce ești dispus(ă) să faci» (§761): the person ticks every role they would do. The ones that still need people are
 * kept as their choices (`openChoices`) — a role that filled while the form was open is dropped and the others stay;
 * none left is «full», for everybody, before the repeat is looked for (no oracle). The offer holds no place: the row
 * has no role until the organizers give one (`assign`), and only a role given counts against its need.
 *
 * On a new person: one row «Înscris» (`source` PUBLIC, the notice's version recorded as the consent's
 * proof, and the agreement accepted with its version, moment and fingerprint, §758 — naming the roles chosen),
 * their choices, one `VOLUNTEER_RECEIVED` to them in the language of the page — the agreement's PDF attached at the
 * send — and one `VOLUNTEER_CLUB_NOTICE` to each Organizer, Administrator and Superadministrator — all in the one
 * transaction (BR-REQ-080-02). The ticked roles' rows are locked, in the order of their ids, while their people are
 * counted, so a role given away meanwhile is read as it stands.
 */
export async function submitVolunteer<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  rawInput: unknown,
  now: Date,
  /** The IP address and browser of the press (§771), read by the action from the request: the agreement's tick is an electronic acceptance, and this is its trace. */
  trace?: SignatureTrace,
): Promise<VolunteerSubmitOutcome> {
  assertIds(eventId);
  // What the form asked depends on the notice in force (§765): the profile's boxes while it names them, §758's tick otherwise.
  const profileMode = await noticeDescribesVolunteerProfile(db, now);
  // A person under eighteen is taken only while the notice and the agreement in force both describe minors (§768).
  const minorsMode = profileMode && (await volunteerMinorsOpen(db, now));
  // The event first: the person's age is their date of birth's on the event's own day (§773, `volunteerEventDay`), so the form cannot be read without it.
  const [event] = await db
    .select({
      id: events.id,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      membersOnly: events.membersOnly,
      acceptsVolunteers: events.acceptsVolunteers,
      volunteersShirts: events.volunteersShirts,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      raceStartsAt: events.raceStartsAt,
      timezone: events.timezone,
      dateToBeAnnounced: events.dateToBeAnnounced,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new DomainError("CONFLICT", "this event takes no volunteers on its page");
  const parsed = volunteerPublicSchemaFor({ profile: profileMode, minors: minorsMode, eventDay: volunteerEventDay(event, now) }).safeParse(rawInput);
  if (!parsed.success) {
    const fields = refusedFields(parsed.error);
    throw new DomainError("VALIDATION_ERROR", "the volunteer form is malformed", fields.length > 0 ? fields : ["name"]);
  }
  const input = parsed.data;
  // What the person said about themselves, only when the form asked it (§765, §773: the date of birth, and the age it gives on the event's day).
  const profile =
    "age" in input
      ? { age: input.age, dateOfBirth: input.birthDate, sex: input.sex, city: input.city, volunteeredBefore: input.volunteeredBefore, clubMember: input.clubMember, shirtSize: input.shirtSize }
      : null;
  // The parent or guardian of a person under eighteen (§768): the name and the address, or none for an adult.
  const guardian = "guardian" in input ? input.guardian : null;
  // The spam defences answer like a success: nothing is kept, nothing says so.
  if (looksLikeSpam(input, now)) return { outcome: "done" };

  const noticeDescribes = await noticeDescribesVolunteers(db, now);
  // Conditions (a), (c) and (d), the event published, public and still ahead — the one rule the page and the
  // card read; (b), a role that still needs people, is judged under the lock below.
  const closed = volunteerOfferClosedFor({
    acceptsVolunteers: event.acceptsVolunteers,
    standings: [{ free: 1 }],
    noticeDescribes,
    agreementInForce: await volunteerAgreementInForce(db, now),
    noticeDescribesAgreement: await noticeDescribesVolunteerAgreement(db, now),
    eventAhead: volunteerEventAhead(event, now),
    published: event.editorialStatus === "PUBLISHED",
    membersOnly: event.membersOnly,
  });
  if (closed) throw new DomainError("CONFLICT", `the volunteer form is closed (${closed})`);
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!notice) throw new DomainError("CONFLICT", "no approved privacy notice in this language");
  // The agreement the tick accepted (§758): the version in force in the page's language, recorded on the row.
  const agreement = await findCurrentApprovedDocument(db, VOLUNTEER_AGREEMENT_KEY, input.locale, now);
  if (!agreement) throw new DomainError("CONFLICT", "no approved volunteer agreement in this language");

  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }

  const byAddress = await consumeRateLimit(db, "volunteer-signup", emailBucketKey("volunteer-signup", identity.canonicalEmail), now);
  const byEvent = await consumeRateLimit(db, "volunteer-event", eventId, now);
  // The guardian's address is mailed too, unproven (§768): the same three an hour, in its own bucket — a script cannot spend the allowance on one parent's mailbox.
  const guardianAddress = guardian?.email ? canonicalOrNull(guardian.email) : null;
  const byGuardian = guardianAddress ? await consumeRateLimit(db, "volunteer-signup", emailBucketKey("volunteer-guardian", guardianAddress), now) : { allowed: true };
  if (!byAddress.allowed || !byEvent.allowed || !byGuardian.allowed) return { outcome: "limited" };

  const outcome = await db.transaction(async (tx): Promise<VolunteerSubmitOutcome & { added?: string; dropped?: boolean }> => {
    // The roles ticked, locked in the order of their ids — the order a role change locks them — while their people
    // are counted: a role given away by the organizers meanwhile is read as it stands, never twice.
    const ticked = await tx
      .select()
      .from(eventVolunteerRoles)
      .where(and(inArray(eventVolunteerRoles.id, input.roleIds), eq(eventVolunteerRoles.eventId, eventId)))
      .orderBy(asc(eventVolunteerRoles.id))
      .for("update");
    if (ticked.length !== input.roleIds.length) throw new DomainError("VALIDATION_ERROR", "that role is not this event's", ["roleIds"]);

    // Full roles first, for everybody: asked after the repeat, a forged post naming only full roles would answer
    // «full» to a stranger and «am primit» to a person already listed — an oracle. This way both hear «full».
    const people = await tx
      .select({ roleId: eventVolunteers.roleId, state: eventVolunteers.state })
      .from(eventVolunteers)
      .where(inArray(eventVolunteers.roleId, input.roleIds));
    const kept = openChoices(input.roleIds, new Map(ticked.map((role) => [role.id, standingOf(role, people)])));
    if (kept.length === 0) return { outcome: "full", dropped: true };
    const dropped = kept.length < input.roleIds.length;
    // The roles as the agreement names them (§765): the plain words of «Descrierea rolului», never the old one-line column.
    // …each with the words of the category it sits under (§774), so the sentence says «Direcționare (Traseu)».
    const categoryWords = new Map(
      (await tx.select({ id: eventVolunteerCategories.id, nameRo: eventVolunteerCategories.nameRo, nameEn: eventVolunteerCategories.nameEn }).from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, eventId))).map((category) => [category.id, category]),
    );
    const chosen = ticked
      .filter((role) => kept.includes(role.id))
      .map(roleOf)
      .sort(compareRoles)
      .map((role) => ({ ...role, categoryRo: categoryWords.get(role.categoryId ?? "")?.nameRo ?? null, categoryEn: categoryWords.get(role.categoryId ?? "")?.nameEn ?? null }));

    // A repeat of the same person: the same answer a new one gets, nothing changed, nothing sent — whatever the row's state is.
    const [existing] = await tx
      .select({ id: eventVolunteers.id })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.canonicalEmail, identity.canonicalEmail)))
      .limit(1);
    if (existing) return { outcome: "done", dropped };

    // The agreement accepted with the sign-up (§758): the version, the moment, the blanks and their fingerprint —
    // naming the roles chosen, since nobody has given the person one yet (§761).
    const acceptance = await agreementAcceptance(
      tx,
      { eventId, name: input.name, roles: { assigned: null, chosen }, locale: input.locale, document: agreement, method: "FORM", guardianName: guardian?.name ?? null, trace },
      now,
    );
    const [row] = await tx
      .insert(eventVolunteers)
      .values({
        eventId,
        // No role until the organizers give one (§761): the offer holds no place.
        roleId: null,
        name: input.name,
        email: identity.deliveryEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        phone: input.phone,
        locale: input.locale,
        state: "REGISTERED",
        source: "PUBLIC",
        message: input.message,
        privacyNoticeVersion: notice.version,
        // The person's own words about themselves (§765), kept only when the notice in force names them; the size only
        // while the event gives a shirt. A form posted for the other mode (a page cached before the notice changed) is refused at the top, naming its missing boxes; the redirect then draws the form now in force.
        ...(profile
          ? {
              age: profile.age,
              dateOfBirth: profile.dateOfBirth,
              sex: profile.sex,
              city: profile.city,
              volunteeredBefore: profile.volunteeredBefore,
              clubMember: profile.clubMember,
              shirtSize: event.volunteersShirts ? profile.shirtSize : null,
            }
          : {}),
        // The parent or guardian of a person under eighteen (§768): kept with the row, and asked by email below.
        ...(guardian ? { guardianName: guardian.name, guardianEmail: guardian.email, guardianRequestedAt: now } : {}),
        ...acceptance,
        createdAt: now,
        updatedAt: now,
      })
      // Two first posts of one address at once: the constraint decides, the loser reads the winner next time.
      .onConflictDoNothing({ target: [eventVolunteers.eventId, eventVolunteers.canonicalEmail] })
      .returning({ id: eventVolunteers.id });
    if (!row) return { outcome: "done", dropped };
    await tx.insert(eventVolunteerRoleChoices).values([...kept].sort().map((roleId) => ({ volunteerId: row.id, roleId, createdAt: now })));

    await enqueueEmail(tx, {
      participantId: null,
      registrationId: null,
      messageType: "VOLUNTEER_RECEIVED",
      locale: input.locale,
      recipientEmail: identity.deliveryEmail,
      payload: { eventId, volunteerId: row.id },
      idempotencyKey: `volunteer:${row.id}:received`,
      now,
    });
    // A person under eighteen: their parent or guardian is asked, at the address the form took, in the language of the
    // page — the same single-use link flow as the volunteer's own agreement (§768, §758). Minted when the email leaves.
    if (guardian?.email) {
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "VOLUNTEER_GUARDIAN_REQUEST",
        locale: input.locale,
        recipientEmail: guardian.email,
        payload: { eventId, volunteerId: row.id },
        idempotencyKey: `volunteer:${row.id}:guardian-request:${now.getTime()}`,
        now,
      });
    }
    // Each Organizer, Administrator and Superadministrator, in the language of their own row.
    const colleagues = await tx
      .select({ id: staffUsers.id, email: staffUsers.email, role: staffUsers.role, preferredLocale: staffUsers.preferredLocale })
      .from(staffUsers);
    for (const colleague of colleagues) {
      if (!isBackofficeRole(colleague.role) || !canManageVolunteers(colleague.role) || colleague.email.trim() === "") continue;
      await enqueueEmail(tx, {
        participantId: null,
        registrationId: null,
        messageType: "VOLUNTEER_CLUB_NOTICE",
        locale: colleague.preferredLocale,
        recipientEmail: colleague.email,
        payload: { eventId, volunteerId: row.id },
        idempotencyKey: `volunteer:${row.id}:club:${colleague.id}`,
        now,
      });
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: null,
      action: "volunteer.signed_up",
      entityType: "event",
      entityId: eventId,
      metadata: { volunteerId: row.id, roleIds: chosen.map((role) => role.id), ...(guardian ? { minor: true } : {}) },
      now,
    });
    return { outcome: "done", added: row.id, dropped };
  });
  // An offer takes no place, so the page's counts did not move — unless the post found a role full that the page
  // still offered: then the page is told once the write has committed.
  if (outcome.dropped) revalidatePublicContent("places");
  return { outcome: outcome.outcome } as VolunteerSubmitOutcome;
}
