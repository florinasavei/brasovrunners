import { and, asc, eq } from "drizzle-orm";
import { eventReserveEntries, RESERVE_EMAIL_MAX, RESERVE_NAME_MAX, RESERVE_NOTE_MAX } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canKeepRegistrationNotes } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { addRegistrationNote } from "./notes";

/**
 * «Lista internă de așteptare» (§854): the people who asked — usually through the contact form — to be kept
 * in mind for one event, written down by the organizers and told nothing. Not a registration: nothing here
 * holds a place, stands in the queue, sends an email or reaches a count; the allocator never reads it.
 * «Trece pe lista oficială» opens the ordinary staff entry prefilled (`createRegistrationByStaff`), and
 * `settleReserveEntry` then carries the entry's note onto the registration as an internal note (§777) and
 * removes the line.
 *
 * **Who** — the Organizer and above (`canKeepRegistrationNotes`, the internal notes' own rule), asserted in
 * every function below (BR-REQ-060-01). **The trail** names who, when and which line — never a name, an
 * address or the note's words.
 */

type Actor = Pick<StaffUser, "id" | "role">;

export type ReserveEntryRow = {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  note: string | null;
  createdAt: Date;
  /** Who wrote it down; null once the account is gone. */
  createdByName: string | null;
};

export type ReserveEntryInput = { firstName: unknown; lastName: unknown; email: unknown; note: unknown };

function assertMayKeep(actor: Pick<StaffUser, "role">): void {
  if (!canKeepRegistrationNotes(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or write an event's internal waiting list`);
  }
}

function trimmed(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

/** The note as stored: line breaks as `\n`, the ends trimmed, null when nothing is left. */
export function parseReserveNote(raw: unknown): string | null {
  const note = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (note === "") return null;
  if ([...note].length > RESERVE_NOTE_MAX) throw new DomainError("NOTE_TOO_LONG", `a note holds at most ${RESERVE_NOTE_MAX} characters`, ["note"]);
  return note;
}

/** The typed line, ready to store; every refusal names its box. */
export function parseReserveEntry(input: ReserveEntryInput): { firstName: string; lastName: string; email: string | null; note: string | null } {
  const firstName = trimmed(input.firstName);
  const lastName = trimmed(input.lastName);
  const email = trimmed(input.email);
  const missing = [firstName === "" || [...firstName].length > RESERVE_NAME_MAX ? "firstName" : null, lastName === "" || [...lastName].length > RESERVE_NAME_MAX ? "lastName" : null].filter(
    (field): field is string => field !== null,
  );
  if (missing.length > 0) throw new DomainError("VALIDATION_ERROR", `a name of 1 to ${RESERVE_NAME_MAX} characters is required`, missing);
  if (email !== "" && (email.length > RESERVE_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new DomainError("VALIDATION_ERROR", "the address is not an email address", ["email"]);
  }
  return { firstName, lastName, email: email === "" ? null : email, note: parseReserveNote(input.note) };
}

/** One event's internal list, in the order it was written down. */
export async function listReserveEntries<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<ReserveEntryRow[]> {
  assertMayKeep(actor);
  if (!isUuid(eventId)) return [];
  const rows = await db
    .select({ row: eventReserveEntries, createdByName: staffUsers.displayName })
    .from(eventReserveEntries)
    .leftJoin(staffUsers, eq(staffUsers.id, eventReserveEntries.createdByStaffUserId))
    .where(eq(eventReserveEntries.eventId, eventId))
    .orderBy(asc(eventReserveEntries.createdAt), asc(eventReserveEntries.id));
  return rows.map(({ row, createdByName }) => ({
    id: row.id,
    eventId: row.eventId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    note: row.note,
    createdAt: row.createdAt,
    createdByName,
  }));
}

/** One line, for the staff entry's prefill; undefined when it is not there. */
export async function findReserveEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string): Promise<ReserveEntryRow | undefined> {
  assertMayKeep(actor);
  if (!isUuid(entryId)) return undefined;
  const [row] = await db.select().from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).limit(1);
  return row ? { ...row, createdByName: null } : undefined;
}

/** «Adaugă pe lista internă»: one person, one event, nobody told. */
export async function addReserveEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, input: ReserveEntryInput, now: Date): Promise<{ id: string }> {
  assertMayKeep(actor);
  const values = parseReserveEntry(input);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const [row] = await tx
      .insert(eventReserveEntries)
      .values({ eventId, ...values, createdByStaffUserId: actor.id, createdAt: now, updatedAt: now })
      .returning({ id: eventReserveEntries.id });
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_reserve.added", entityType: "event", entityId: eventId, metadata: { entryId: row.id }, now });
    return row;
  });
}

async function lockedEntry<T extends Record<string, unknown>>(tx: Database<T>, entryId: string) {
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const [row] = await tx.select().from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).for("update");
  if (!row) throw new DomainError("NOT_FOUND", "the line is not there");
  return row;
}

/** «Salvează nota» on one line; an empty box clears the note. A save of the same words writes nothing. */
export async function saveReserveNote<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, rawNote: unknown, now: Date): Promise<{ eventId: string; changed: boolean }> {
  assertMayKeep(actor);
  const note = parseReserveNote(rawNote);
  return db.transaction(async (tx) => {
    const current = await lockedEntry(tx, entryId);
    if (current.note === note) return { eventId: current.eventId, changed: false };
    await tx.update(eventReserveEntries).set({ note, updatedAt: now }).where(eq(eventReserveEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_reserve.note_saved", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    return { eventId: current.eventId, changed: true };
  });
}

/** «Șterge» on one line: the name, the address and the note are gone. */
export async function deleteReserveEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, now: Date): Promise<{ eventId: string }> {
  assertMayKeep(actor);
  return db.transaction(async (tx) => {
    const current = await lockedEntry(tx, entryId);
    await tx.delete(eventReserveEntries).where(eq(eventReserveEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_reserve.deleted", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    return { eventId: current.eventId };
  });
}

/**
 * After «Trece pe lista oficială» made a registration of the line: its note becomes the registration's
 * internal note (§777) and the line is removed. Nothing happens when the registration is not of the line's
 * event — another event chosen on the form, or a forged one: the note never lands on another event's row —
 * or when the line is already gone.
 */
export async function settleReserveEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, registrationId: string, now: Date): Promise<void> {
  assertMayKeep(actor);
  if (!isUuid(entryId) || !isUuid(registrationId)) return;
  const [entry] = await db.select().from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).limit(1);
  if (!entry) return;
  const [registration] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.eventId, entry.eventId)))
    .limit(1);
  if (!registration) return;
  if (entry.note) await addRegistrationNote(db, actor, registration.id, entry.note, now);
  await db.transaction(async (tx) => {
    const deleted = await tx.delete(eventReserveEntries).where(eq(eventReserveEntries.id, entry.id)).returning({ id: eventReserveEntries.id });
    if (deleted.length === 0) return;
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.moved",
      entityType: "event",
      entityId: entry.eventId,
      metadata: { entryId: entry.id, registrationId: registration.id },
      now,
    });
  });
}
