import { and, asc, count, eq, gt, sql } from "drizzle-orm";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { findCurrentApprovedDocument, noticeDescribesVolunteers } from "@/modules/legal-documents/repository";
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
  compareRoles,
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

/**
 * An event's volunteers (§NNN; the owner, 2026-10-13: «I want to register volunteers for a race and be
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
 * gets — «am primit», or «full» when the role it names has filled, judged first for everybody — so the
 * form is no oracle for who volunteers (BR-REQ-031-01 criterion 3).
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
  roleId: string;
  name: string;
  email: string;
  phone: string;
  state: VolunteerState;
  source: "STAFF" | "PUBLIC";
  message: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** An event's roles, in the order the club set them. */
export async function listVolunteerRoles<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerRole[]> {
  const rows = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId));
  return rows.sort(compareRoles);
}

/** An event's volunteers, oldest first (the card groups them by role). */
export async function listVolunteers<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<VolunteerItem[]> {
  const rows = await db
    .select()
    .from(eventVolunteers)
    .where(eq(eventVolunteers.eventId, eventId))
    .orderBy(asc(eventVolunteers.createdAt), asc(eventVolunteers.id));
  return rows.map((row) => ({
    id: row.id,
    eventId: row.eventId,
    roleId: row.roleId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    state: row.state,
    source: row.source,
    message: row.message,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** The roles of one event with how each stands, in the club's order: «N din M» and what is still needed. */
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
 * (§NNN): the tick, and every role with its standing, in the club's order. Names and counts only — nothing
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
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).for("update").limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });

    // Every verb is about this event's list: locked for the change, so two presses cannot both take a position.
    const roles = (
      await tx.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, request.eventId)).for("update")
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
      const [people] = await tx.select({ n: count() }).from(eventVolunteers).where(eq(eventVolunteers.roleId, current.id));
      if ((people?.n ?? 0) > 0) throw new DomainError("VOLUNTEER_ROLE_HAS_PEOPLE", "move the volunteers to another role first", ["roleId"]);
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
 * «Primește voluntari» on or off (§NNN): the event's own tick, in the volunteers' card's own form — the
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
    const [event] = await tx.select({ on: events.acceptsVolunteers }).from(events).where(eq(events.id, request.eventId)).for("update").limit(1);
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

const STAFF_FIELDS = ["roleId", "name", "email", "phone", "note"] as const;

export type VolunteerRequest =
  | { kind: "add"; eventId: string; fields: Record<string, unknown> }
  | { kind: "edit"; eventId: string; id: string; fields: Record<string, unknown> }
  | { kind: "setState"; eventId: string; id: string; state: unknown }
  | { kind: "delete"; eventId: string; id: string };

export type VolunteerResult = { changed: boolean; volunteer: { id: string } };

function staffInputOf(fields: Record<string, unknown>) {
  const parsed = volunteerStaffInputSchema.safeParse(postedStrings(fields, STAFF_FIELDS));
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "), refusedFields(parsed.error));
  }
  let identity;
  try {
    identity = canonicalizeEmail(parsed.data.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }
  return { ...parsed.data, identity };
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

/**
 * One change to one event's volunteers, by one staff member: enter one by hand, change what was typed
 * (the name, the address, the telephone number, the role, the organizers' note), confirm or cancel, delete.
 * The address goes through the canonicalizer and is unique per event (`VOLUNTEER_ALREADY_LISTED`, naming the
 * box); the role must be this event's (VALIDATION_ERROR, `roleId`); a person who is not there, or is on
 * another event, is NOT_FOUND. A press that changes nothing writes nothing. Every change is audited with the
 * ids and the names of the fields — never the person's own words.
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

  const result = await db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, request.eventId)).limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "the event is not there");
    const audit = (action: AuditAction, metadata: Record<string, unknown>) =>
      recordAuditEvent(tx, { actorStaffUserId: actor.id, action, entityType: "event", entityId: request.eventId, metadata, now });

    const roleOf = async (roleId: string) => {
      const [role] = await tx
        .select({ id: eventVolunteerRoles.id, nameRo: eventVolunteerRoles.nameRo })
        .from(eventVolunteerRoles)
        .where(and(eq(eventVolunteerRoles.id, roleId), eq(eventVolunteerRoles.eventId, request.eventId)))
        .limit(1);
      if (!role) throw new DomainError("VALIDATION_ERROR", "that role is not this event's", ["roleId"]);
      return role;
    };
    const holderOf = async (canonicalEmail: string) => {
      const [row] = await tx
        .select({ id: eventVolunteers.id })
        .from(eventVolunteers)
        .where(and(eq(eventVolunteers.eventId, request.eventId), eq(eventVolunteers.canonicalEmail, canonicalEmail)))
        .limit(1);
      return row;
    };

    if (request.kind === "add" && input) {
      const role = await roleOf(input.roleId);
      if (await holderOf(input.identity.canonicalEmail)) throw alreadyListed();
      const [row] = await tx
        .insert(eventVolunteers)
        .values({
          eventId: request.eventId,
          roleId: role.id,
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
        .returning({ id: eventVolunteers.id });
      if (!row) throw alreadyListed();
      await audit("volunteer.added", { volunteerId: row.id, roleId: role.id, roleNameRo: role.nameRo });
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
      await tx.delete(eventVolunteers).where(eq(eventVolunteers.id, current.id));
      await audit("volunteer.deleted", { volunteerId: current.id, roleId: current.roleId, state: current.state });
      return { changed: true, volunteer: summary };
    }

    if (request.kind === "setState" && state) {
      if (current.state === state) return { changed: false, volunteer: summary };
      await tx.update(eventVolunteers).set({ state, updatedAt: now }).where(eq(eventVolunteers.id, current.id));
      await audit("volunteer.state_changed", { volunteerId: current.id, roleId: current.roleId, from: current.state, to: state });
      return { changed: true, volunteer: summary };
    }

    // «Salvează» on a volunteer: every box, the role included.
    if (!input) throw new DomainError("VALIDATION_ERROR", "nothing to save");
    const role = await roleOf(input.roleId);
    if (input.identity.canonicalEmail !== current.canonicalEmail) {
      const holder = await holderOf(input.identity.canonicalEmail);
      if (holder && holder.id !== current.id) throw alreadyListed();
    }
    const next = {
      roleId: role.id,
      name: input.name,
      email: input.identity.deliveryEmail,
      phone: input.phone,
      note: input.note,
    };
    const before = { roleId: current.roleId, name: current.name, email: current.email, phone: current.phone, note: current.note };
    const changedFields = (Object.keys(before) as (keyof typeof before)[]).filter((key) => before[key] !== next[key]);
    if (changedFields.length === 0) return { changed: false, volunteer: summary };
    try {
      await tx
        .update(eventVolunteers)
        .set({
          ...next,
          canonicalEmail: input.identity.canonicalEmail,
          canonicalizationVersion: input.identity.canonicalizationVersion,
          updatedAt: now,
        })
        .where(eq(eventVolunteers.id, current.id));
    } catch (error) {
      // The same race on a changed address: a sign-up of it committed after the check. The transaction is lost
      // either way; the organizer hears the sentence, not the database.
      if (isAddressClash(error)) throw alreadyListed();
      throw error;
    }
    await audit("volunteer.edited", { volunteerId: current.id, fields: changedFields, roleId: role.id });
    return { changed: true, volunteer: summary };
  });
  if (result.changed) revalidatePublicContent("places");
  return result;
}

/**
 * The volunteers' export (§NNN), «Descarcă CSV»: the same rows the card lists, recorded as
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
  /** The role filled while the form was open: the page offers the roles that still need people. */
  | { outcome: "full" };

/**
 * A person's offer from an event's page. Refuses — as the person's own fix, `VALIDATION_ERROR` naming each
 * box — a malformed address or telephone number, a missing name, a role that is not this event's, or the
 * consent tick not given; and — `CONFLICT`, the page offers no form then — an event that does not take
 * volunteers, is cancelled or over, is not published, or whose privacy notice in force does not describe
 * volunteers (`volunteerOfferClosedFor`, asked again here: the page's cache is not the gate).
 *
 * On a new person: one row «Înscris» (`source` PUBLIC, the notice's version recorded as the consent's
 * proof), one `VOLUNTEER_RECEIVED` to them in the language of the page and one `VOLUNTEER_CLUB_NOTICE` to
 * each Organizer, Administrator and Superadministrator — all in the one transaction (BR-REQ-080-02). The
 * role's row is locked while its people are counted, so two people cannot take the last place together.
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
  // Conditions (a) and (c), the event published, public and still ahead — the one rule the page and the card
  // read; (b), a role that still needs people, is judged under the lock below.
  const closed = volunteerOfferClosedFor({
    acceptsVolunteers: event.acceptsVolunteers,
    standings: [{ free: 1 }],
    noticeDescribes,
    eventAhead: volunteerEventAhead(event, now),
    published: event.editorialStatus === "PUBLISHED",
    membersOnly: event.membersOnly,
  });
  if (closed) throw new DomainError("CONFLICT", `the volunteer form is closed (${closed})`);
  const notice = await findCurrentApprovedDocument(db, "PRIVACY_NOTICE", input.locale, now);
  if (!notice) throw new DomainError("CONFLICT", "no approved privacy notice in this language");

  let identity;
  try {
    identity = canonicalizeEmail(input.email);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "the address is not valid", ["email"]);
  }

  const byAddress = await consumeRateLimit(db, "volunteer-signup", emailBucketKey("volunteer-signup", identity.canonicalEmail), now);
  const byEvent = await consumeRateLimit(db, "volunteer-event", eventId, now);
  if (!byAddress.allowed || !byEvent.allowed) return { outcome: "limited" };

  const outcome = await db.transaction(async (tx): Promise<VolunteerSubmitOutcome & { added?: string }> => {
    const [role] = await tx
      .select()
      .from(eventVolunteerRoles)
      .where(and(eq(eventVolunteerRoles.id, input.roleId), eq(eventVolunteerRoles.eventId, eventId)))
      .for("update")
      .limit(1);
    if (!role) throw new DomainError("VALIDATION_ERROR", "that role is not this event's", ["roleId"]);

    // A full role first, for everybody: asked after the repeat, a forged post naming a full role would answer
    // «full» to a stranger and «am primit» to a person already listed — an oracle. This way both hear «full».
    const people = await tx
      .select({ roleId: eventVolunteers.roleId, state: eventVolunteers.state })
      .from(eventVolunteers)
      .where(eq(eventVolunteers.roleId, role.id));
    if (standingOf(role, people).free === 0) return { outcome: "full" };

    // A repeat of the same person: the same answer a new one gets, nothing changed, nothing sent — whatever the row's state is.
    const [existing] = await tx
      .select({ id: eventVolunteers.id })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.eventId, eventId), eq(eventVolunteers.canonicalEmail, identity.canonicalEmail)))
      .limit(1);
    if (existing) return { outcome: "done" };

    const [row] = await tx
      .insert(eventVolunteers)
      .values({
        eventId,
        roleId: role.id,
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
        createdAt: now,
        updatedAt: now,
      })
      // Two first posts of one address at once: the constraint decides, the loser reads the winner next time.
      .onConflictDoNothing({ target: [eventVolunteers.eventId, eventVolunteers.canonicalEmail] })
      .returning({ id: eventVolunteers.id });
    if (!row) return { outcome: "done" };

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
      metadata: { volunteerId: row.id, roleId: role.id, roleNameRo: role.nameRo },
      now,
    });
    return { outcome: "done", added: row.id };
  });
  // The roles on the page changed (a place taken, or a role found full): the page is told once the write has committed.
  if (outcome.added || outcome.outcome === "full") revalidatePublicContent("places");
  return { outcome: outcome.outcome } as VolunteerSubmitOutcome;
}
