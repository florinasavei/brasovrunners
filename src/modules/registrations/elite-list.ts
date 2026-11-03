import { asc, eq } from "drizzle-orm";
import { ELITE_NAME_MAX, ELITE_NUMBER_MAX, eventEliteEntries } from "@/db/schema/event-elite-entries";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Elită — doar numele pe BIB» (§NNN; the owner, 2026-11-03, choosing «Listă separată»): a race's elite runners
 * as a list of names, printed as bibs with the name where the number usually is (`bibs-pdf.ts`, `bib-image.tsx`).
 *
 * **Not registrations.** No participant, no address, no declaration, no place, no queue, no email: nothing here
 * reaches the allocator or any count — «Locuri», the kits, the registrations' summary and export, the sponsors'
 * list, the desk, the results. That is why the declaration rule stays whole: a registration still needs the
 * person's own signed declaration, and an elite line is a name to print, nothing else. A name and an optional
 * number are all it stores.
 *
 * **Who** — the Organizer and above read the list and download its sheet (`canReadRegistrations`, the bibs'
 * own rule, §289); the Administrator adds and deletes (`canManageRegistrations`). Asserted in every function
 * below (BR-REQ-060-01). **The trail** names who, when and which line — never the name or its number.
 */

type Actor = Pick<StaffUser, "id" | "role">;

export type EliteEntryRow = {
  id: string;
  eventId: string;
  name: string;
  bibNumber: number | null;
  createdAt: Date;
};

export type EliteEntryInput = { name: unknown; bibNumber: unknown };

function assertMayRead(actor: Pick<StaffUser, "role">): void {
  if (!canReadRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's elite list`);
  }
}

function assertMayWrite(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an event's elite list`);
  }
}

/**
 * The typed line, ready to store; every refusal names its box. The name trimmed with its inner spaces
 * collapsed to one — it is printed, and a double space would print as a gap — 1 to `ELITE_NAME_MAX`
 * characters; the number empty, or a whole number from 1 to `ELITE_NUMBER_MAX` (the five digits a bib draws).
 */
export function parseEliteEntry(input: EliteEntryInput): { name: string; bibNumber: number | null } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/gu, " ").trim() : "";
  const rawNumber = typeof input.bibNumber === "number" ? String(input.bibNumber) : typeof input.bibNumber === "string" ? input.bibNumber.trim() : "";
  const nameOk = name !== "" && [...name].length <= ELITE_NAME_MAX;
  const number = rawNumber === "" ? null : /^\d{1,5}$/.test(rawNumber) ? Number(rawNumber) : Number.NaN;
  const numberOk = number === null || (Number.isInteger(number) && number >= 1 && number <= ELITE_NUMBER_MAX);
  const refused = [nameOk ? null : "name", numberOk ? null : "bibNumber"].filter((field): field is string => field !== null);
  if (refused.length > 0) {
    throw new DomainError("VALIDATION_ERROR", `a name of 1 to ${ELITE_NAME_MAX} characters, and no number or one from 1 to ${ELITE_NUMBER_MAX}`, refused);
  }
  return { name, bibNumber: number };
}

/** One event's elite list, in the order the club typed it. */
export async function listEliteEntries<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<EliteEntryRow[]> {
  assertMayRead(actor);
  if (!isUuid(eventId)) return [];
  const rows = await db
    .select()
    .from(eventEliteEntries)
    .where(eq(eventEliteEntries.eventId, eventId))
    .orderBy(asc(eventEliteEntries.createdAt), asc(eventEliteEntries.id));
  return rows.map((row) => ({ id: row.id, eventId: row.eventId, name: row.name, bibNumber: row.bibNumber, createdAt: row.createdAt }));
}

/** «Adaugă pe lista de elită»: one name, one event — nobody registered, nobody told. */
export async function addEliteEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, input: EliteEntryInput, now: Date): Promise<{ id: string }> {
  assertMayWrite(actor);
  const values = parseEliteEntry(input);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).limit(1);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const [row] = await tx
      .insert(eventEliteEntries)
      .values({ eventId, ...values, createdByStaffUserId: actor.id, createdAt: now })
      .returning({ id: eventEliteEntries.id });
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.added", entityType: "event", entityId: eventId, metadata: { entryId: row.id }, now });
    return row;
  });
}

/** «Șterge» on one line: the name and its number are gone. A second press finds it gone (NOT_FOUND). */
export async function deleteEliteEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, now: Date): Promise<{ eventId: string }> {
  assertMayWrite(actor);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ id: eventEliteEntries.id, eventId: eventEliteEntries.eventId }).from(eventEliteEntries).where(eq(eventEliteEntries.id, entryId)).for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the line is not there");
    await tx.delete(eventEliteEntries).where(eq(eventEliteEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.deleted", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    return { eventId: current.eventId };
  });
}
