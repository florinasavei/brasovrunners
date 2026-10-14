import { and, asc, count, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers, type VolunteerAgreementMethod } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { VOLUNTEER_AGREEMENT_KEY } from "@/modules/legal-documents/domain/keys";
import {
  findCurrentApprovedDocument,
  noticeDescribesVolunteerAgreement,
  noticeDescribesVolunteers,
  volunteerAgreementInForce,
} from "@/modules/legal-documents/repository";
import { enqueueEmail } from "@/modules/notifications/outbox";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { emailBucketKey } from "@/modules/rate-limit/domain/key";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { looksLikeSpam } from "@/modules/registrations/service";
import { canManageVolunteers, isBackofficeRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import {
  acceptedRoleNames,
  choicesWithAssigned,
  compareRoles,
  openChoices,
  refusedFields,
  type RoleStanding,
  standingOf,
  type VolunteerRoleInput,
  volunteerEventAhead,
  volunteerOfferClosedFor,
  volunteerPublicInputSchema,
  volunteerRoleInputSchema,
  volunteerStaffInputSchema,
  VOLUNTEER_ROLES_MAX,
  VOLUNTEER_STATES,
  type VolunteerState,
} from "./domain/volunteer";
import { agreementAcceptance, readAgreementFacts } from "./agreement";

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
  needed: number;
  descriptionRo: string | null;
  descriptionEn: string | null;
  position: number;
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
};

/** An event's roles, in the order the club set them. */
export async function listVolunteerRoles<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerRole[]> {
  const rows = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId));
  return rows.sort(compareRoles);
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
  const rows = await db
    .select({ row: eventVolunteers, agreementVersion: legalDocuments.version })
    .from(eventVolunteers)
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .where(eq(eventVolunteers.eventId, eventId))
    .orderBy(asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
  const choices = await choicesOf(db, eventId);
  return rows.map(({ row, agreementVersion }) => {
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
  descriptionRo: string | null;
  descriptionEn: string | null;
  needed: number;
  taken: number;
  free: number;
};

/**
 * What an event's page reads to decide whether to draw «Vreau să fiu voluntar» and which roles to list
 * (§754): the tick, and every role with its standing, in the club's order. Names and counts only — nothing
 * of a person — so the public cache may hold it (`public-cache/reads.ts`); expired by every write here.
 */
export async function readPublicVolunteerRoles<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ acceptsVolunteers: boolean; roles: PublicVolunteerRole[] }> {
  const [event] = await db.select({ accepts: events.acceptsVolunteers }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event?.accepts) return { acceptsVolunteers: false, roles: [] };
  const roles = await listVolunteerRoles(db, eventId);
  const people = await db
    .select({ roleId: eventVolunteers.roleId, state: eventVolunteers.state })
    .from(eventVolunteers)
    .where(eq(eventVolunteers.eventId, eventId));
  return {
    acceptsVolunteers: true,
    roles: roles.map((role) => {
      const standing = standingOf(role, people);
      return {
        id: role.id,
        nameRo: role.nameRo,
        nameEn: role.nameEn,
        descriptionRo: role.descriptionRo,
        descriptionEn: role.descriptionEn,
        needed: role.needed,
        taken: standing.taken,
        free: standing.free,
      };
    }),
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

const ROLE_FIELDS = ["nameRo", "nameEn", "needed", "descriptionRo", "descriptionEn"] as const;

function roleInputOf(fields: Record<string, unknown>): VolunteerRoleInput {
  const parsed = volunteerRoleInputSchema.safeParse(postedStrings(fields, ROLE_FIELDS));
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), refusedFields(parsed.error));
  }
  return parsed.data;
}

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

    // Every verb is about this event's list: locked for the change, so two presses cannot both take a position.
    // In the order of the ids — the order a sign-up locks the roles it ticked (§761) — so the two never wait on
    // each other in a circle.
    const roles = (
      await tx.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, request.eventId)).orderBy(asc(eventVolunteerRoles.id)).for("update")
    ).sort(compareRoles);

    if (request.kind === "add" && input) {
      if (roles.length >= VOLUNTEER_ROLES_MAX) {
        throw new DomainError("VALIDATION_ERROR", `an event takes at most ${VOLUNTEER_ROLES_MAX} roles`, ["nameRo"]);
      }
      const [row] = await tx
        .insert(eventVolunteerRoles)
        .values({
          eventId: request.eventId,
          nameRo: input.nameRo,
          nameEn: input.nameEn,
          needed: input.needed,
          descriptionRo: input.descriptionRo,
          descriptionEn: input.descriptionEn,
          position: roles.length === 0 ? 0 : Math.max(...roles.map((role) => role.position)) + 1,
          createdAt: now,
        })
        .returning({ id: eventVolunteerRoles.id });
      await audit("volunteer_role.added", { roleId: row.id, nameRo: input.nameRo, nameEn: input.nameEn, needed: input.needed });
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
      const index = roles.findIndex((role) => role.id === current.id);
      const target = request.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= roles.length) return { changed: false, role: summary };
      const order = roles.map((role) => role.id);
      [order[index], order[target]] = [order[target], order[index]];
      // Positions 0..n-1 in the new order: a total order, whatever the gaps a delete left.
      for (const [position, id] of order.entries()) {
        await tx.update(eventVolunteerRoles).set({ position }).where(eq(eventVolunteerRoles.id, id));
      }
      await audit("volunteer_role.moved", { roleId: current.id, nameRo: current.nameRo, direction: request.direction });
      return { changed: true, role: summary };
    }

    // «Salvează» on a role: both names, how many it needs, and its description.
    if (!input) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    const before = {
      nameRo: current.nameRo,
      nameEn: current.nameEn,
      needed: current.needed,
      descriptionRo: current.descriptionRo,
      descriptionEn: current.descriptionEn,
    };
    const changedFields = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== input[key]);
    if (changedFields.length === 0) return { changed: false, role: summary };
    await tx
      .update(eventVolunteerRoles)
      .set({
        nameRo: input.nameRo,
        nameEn: input.nameEn,
        needed: input.needed,
        descriptionRo: input.descriptionRo,
        descriptionEn: input.descriptionEn,
      })
      .where(eq(eventVolunteerRoles.id, current.id));
    await audit("volunteer_role.edited", { roleId: current.id, fields: changedFields, nameRo: input.nameRo, needed: input.needed });
    return { changed: true, role: { id: current.id, nameRo: input.nameRo } };
  });
  // The public page lists the roles and what each still needs: it is told once the write has committed.
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

const STAFF_FIELDS = ["assignedRoleId", "name", "email", "phone", "note"] as const;

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

function staffInputOf(fields: Record<string, unknown>) {
  const parsed = volunteerStaffInputSchema.safeParse({ ...postedStrings(fields, STAFF_FIELDS), roleIds: postedIds(fields.roleIds) });
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
  const input = request.kind === "add" || request.kind === "edit" ? staffInputOf(request.fields) : null;
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
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).limit(1);
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
    const next = {
      roleId: input.assignedRoleId,
      name: input.name,
      email: input.identity.deliveryEmail,
      phone: input.phone,
      note: input.note,
    };
    const before = { roleId: current.roleId, name: current.name, email: current.email, phone: current.phone, note: current.note };
    const choicesBefore = (
      await tx.select({ roleId: eventVolunteerRoleChoices.roleId }).from(eventVolunteerRoleChoices).where(eq(eventVolunteerRoleChoices.volunteerId, current.id))
    ).map((row) => row.roleId);
    const changedFields: string[] = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== next[key]);
    if (!sameIds(choicesBefore, input.choiceIds)) changedFields.push("roleIds");
    if (changedFields.length === 0) return { changed: false, volunteer: summary };
    try {
      await tx
        .update(eventVolunteers)
        .set({
          ...next,
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
): Promise<{ roles: VolunteerRole[]; volunteers: VolunteerItem[] }> {
  assertMayManage(actor);
  assertIds(eventId);
  const [event] = await db.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
  const roles = await listVolunteerRoles(db, eventId);
  const volunteers = await listVolunteers(db, eventId);
  await recordAuditEvent(db, {
    actorStaffUserId: actor.id,
    action: "volunteer.exported",
    entityType: "event",
    entityId: eventId,
    metadata: { rows: volunteers.length },
    now,
  });
  return { roles, volunteers };
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
): Promise<VolunteerSubmitOutcome> {
  assertIds(eventId);
  const parsed = volunteerPublicInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fields = refusedFields(parsed.error);
    throw new DomainError("VALIDATION_ERROR", "the volunteer form is malformed", fields.length > 0 ? fields : ["name"]);
  }
  const input = parsed.data;
  // The spam defences answer like a success: nothing is kept, nothing says so.
  if (looksLikeSpam(input, now)) return { outcome: "done" };

  const [event] = await db
    .select({
      id: events.id,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      membersOnly: events.membersOnly,
      acceptsVolunteers: events.acceptsVolunteers,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!event) throw new DomainError("CONFLICT", "this event takes no volunteers on its page");
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
  if (!byAddress.allowed || !byEvent.allowed) return { outcome: "limited" };

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
    const chosen = ticked.filter((role) => kept.includes(role.id)).sort(compareRoles);

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
      { eventId, name: input.name, roles: { assigned: null, chosen }, locale: input.locale, document: agreement, method: "FORM" },
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
      metadata: { volunteerId: row.id, roleIds: chosen.map((role) => role.id) },
      now,
    });
    return { outcome: "done", added: row.id, dropped };
  });
  // An offer takes no place, so the page's counts did not move — unless the post found a role full that the page
  // still offered: then the page is told once the write has committed.
  if (outcome.dropped) revalidatePublicContent("places");
  return { outcome: outcome.outcome } as VolunteerSubmitOutcome;
}
