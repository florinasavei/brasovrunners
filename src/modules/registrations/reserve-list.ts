import { and, asc, eq } from "drizzle-orm";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventReserveEntries, RESERVE_EMAIL_MAX, RESERVE_NAME_MAX, RESERVE_NOTE_MAX } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { canKeepRegistrationNotes, canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { enterOnWaitlistByStaff, type WaitlistEntryByStaffResult } from "./admin-service";
import { HIDDEN_LIST_OFF } from "./domain/hidden-list";
import { parseEliteEntry } from "./elite-list";
import { addRegistrationNote } from "./notes";
import { type PartnerMarkInput, parsePartnerMark, writeRegistrationPartnerName } from "./partner-mark";
import { lockEventForCapacity } from "./repository";
import { OWN_ADDRESS_GUEST, type StaffPlaceOptions } from "./service";

/**
 * «Lista internă de așteptare» (§854): the people who asked — usually through the contact form — to be kept
 * in mind for one event, written down by the organizers and told nothing. Not a registration: nothing here
 * holds a place, stands in the queue, sends an email or reaches a count; the allocator never reads it.
 * «Mută pe lista oficială» and «Oferă-i un loc acum» (§888) move a line onto the official waiting list in one
 * press (`moveReserveEntryToWaitlist`); the full form, prefilled, stays one link away, and `settleReserveEntry`
 * then carries the entry's note onto the registration as an internal note (§777) and removes the line.
 * «Mută pe lista de elită» (§903) takes a line the other way, onto no list of registrations at all: its name onto
 * the race's elite list (§895), printed on a bib, nobody registered (`moveReserveEntryToElite`). «Pe adresa mea, invitat
 * special» registers a line with no address of its own on the Administrator's address, on «Lista de invitați speciali»
 * (`moveReserveEntryToOwnAddress`).
 *
 * **Who** — the Organizer and above (`canKeepRegistrationNotes`, the internal notes' own rule) add, note, correct a name,
 * mark «E de la parteneri» (the decision «De la parteneri») and delete; moving a line is the Administrator's (`canManageRegistrations`, §888). Asserted in every function
 * below (BR-REQ-060-01). **The trail** names who, when and which line — never a name, an address or the note's
 * words.
 */

type Actor = Pick<StaffUser, "id" | "role">;

export type ReserveEntryRow = {
  id: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  note: string | null;
  /** «E de la parteneri» (the decision «De la parteneri»): the partner's or sponsor's name, or null. */
  partnerName: string | null;
  createdAt: Date;
  /** Who wrote it down; null once the account is gone. */
  createdByName: string | null;
};

export type ReserveEntryInput = {
  firstName: unknown;
  lastName: unknown;
  email: unknown;
  note: unknown;
  /** «E de la parteneri» and its box (the decision «De la parteneri»): absent is unticked. */
  partner?: unknown;
  partnerName?: unknown;
};

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

/**
 * The typed name, ready to store: both boxes trimmed, 1 to `RESERVE_NAME_MAX` characters each, the refusal naming
 * the box (or both). The one parse the add and «Corectează numele» share.
 */
export function parseReserveName(input: { firstName: unknown; lastName: unknown }): { firstName: string; lastName: string } {
  const firstName = trimmed(input.firstName);
  const lastName = trimmed(input.lastName);
  const missing = [firstName === "" || [...firstName].length > RESERVE_NAME_MAX ? "firstName" : null, lastName === "" || [...lastName].length > RESERVE_NAME_MAX ? "lastName" : null].filter(
    (field): field is string => field !== null,
  );
  if (missing.length > 0) throw new DomainError("VALIDATION_ERROR", `a name of 1 to ${RESERVE_NAME_MAX} characters is required`, missing);
  return { firstName, lastName };
}

/** The typed line, ready to store; every refusal names its box. */
export function parseReserveEntry(input: ReserveEntryInput): { firstName: string; lastName: string; email: string | null; note: string | null; partnerName: string | null } {
  const name = parseReserveName(input);
  const email = trimmed(input.email);
  if (email !== "" && (email.length > RESERVE_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new DomainError("VALIDATION_ERROR", "the address is not an email address", ["email"]);
  }
  return { ...name, email: email === "" ? null : email, note: parseReserveNote(input.note), partnerName: parsePartnerMark({ partner: input.partner, partnerName: input.partnerName }) };
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
    partnerName: row.partnerName,
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

/** «Adaugă pe lista internă»: one person, one event, nobody told; «E de la parteneri» with it, its trail a flag and never the name. */
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
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.added",
      entityType: "event",
      entityId: eventId,
      metadata: values.partnerName ? { entryId: row.id, partner: true } : { entryId: row.id },
      now,
    });
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

/**
 * «Corectează numele» on one line («Lista internă», amended by «Corectează numele pe lista internă»; the owner:
 * a name written down wrong must be fixable): the first and last name, through the add's own parse
 * (`parseReserveName`). The Organizer and above, as add, note and delete are (asserted here and again at the action's
 * door, BR-REQ-060-01). The line keeps its place, address, note, author and creation moment; a save of the same
 * name writes nothing. A line moved or deleted meanwhile is NOT_FOUND. The trail names who, when and which line,
 * never the old or the new name.
 */
export async function renameReserveEntry<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  rawName: { firstName: unknown; lastName: unknown },
  now: Date,
): Promise<{ eventId: string; changed: boolean }> {
  assertMayKeep(actor);
  const name = parseReserveName(rawName);
  return db.transaction(async (tx) => {
    const current = await lockedEntry(tx, entryId);
    if (current.firstName === name.firstName && current.lastName === name.lastName) return { eventId: current.eventId, changed: false };
    await tx.update(eventReserveEntries).set({ ...name, updatedAt: now }).where(eq(eventReserveEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_reserve.renamed", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    return { eventId: current.eventId, changed: true };
  });
}

/**
 * «E de la parteneri» on one line (the decision «De la parteneri»), in its own fold beside «Corectează numele»: the tick and the
 * box «Numele partenerului sau sponsorului» — ticked without a name is refused naming the box, unticked clears it
 * (`parsePartnerMark`). The Organizer and above, as add, note and rename are (asserted here and again at the action's door,
 * BR-REQ-060-01). The line keeps everything else; a save of the same name writes nothing. A line moved or deleted meanwhile
 * is NOT_FOUND. The trail: `event_reserve.partner_saved`, `{ entryId, partner }` — whether a name is now present, never the name.
 */
export async function saveReservePartner<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  input: PartnerMarkInput,
  now: Date,
): Promise<{ eventId: string; changed: boolean }> {
  assertMayKeep(actor);
  const partnerName = parsePartnerMark(input);
  return db.transaction(async (tx) => {
    const current = await lockedEntry(tx, entryId);
    if (current.partnerName === partnerName) return { eventId: current.eventId, changed: false };
    await tx.update(eventReserveEntries).set({ partnerName, updatedAt: now }).where(eq(eventReserveEntries.id, current.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.partner_saved",
      entityType: "event",
      entityId: current.eventId,
      metadata: { entryId: current.id, partner: partnerName !== null },
      now,
    });
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

/** Moving a line onto the official list is the Administrator's (§888): the Organizer keeps add, note and delete. */
function assertMayMove(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not move a line of the internal list onto the official waiting list`);
  }
}

export type ReserveMoveInput = {
  /** The address typed in the dialog's form, read only when the line has none. */
  email: unknown;
  /** The relay tick (§33), asked in the dialog. */
  relayedByParticipantRequest: boolean;
  /** The backoffice's language: the person's emails leave in it, as from the official list's add form (§872). */
  locale: Locale;
  /** «Oferă-i un loc acum»: the offer after the entry, with the capacity its dialog named (§642). Absent: «Mută pe lista oficială». */
  offerNow?: StaffPlaceOptions | null;
};

/**
 * «Mută pe lista oficială» and «Oferă-i un loc acum» on one line (§888; the owner, 2026-11-01: the internal list
 * is notes, the official one the real queue — one press from the first to the second). The Administrator's
 * (`canManageRegistrations`, asserted here and again by the entry). One transaction: the event row locked, then
 * the line — the order an event's delete takes them in — then the line's person entered as the official list's
 * add form enters one (`enterOnWaitlistByStaff`: the address vouched for, the one allocator, the ordinary email,
 * no verification email; with `offerNow`, §642's offer when the row is left waiting), the line's note onto the new
 * registration (§777) and its partner's name («De la parteneri»), and the line removed, audited `event_reserve.moved`. Any refusal writes nothing: the line
 * stays, with its note. The address is the line's; a line written without one takes the one typed in the dialog's
 * form, refused naming the box when there is none. A second press on a line already moved finds it gone.
 */
export async function moveReserveEntryToWaitlist<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  input: ReserveMoveInput,
  now: Date,
): Promise<WaitlistEntryByStaffResult & { eventId: string }> {
  assertMayKeep(actor);
  assertMayMove(actor);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const result = await db.transaction(async (tx) => {
    const [line] = await tx.select({ eventId: eventReserveEntries.eventId }).from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).limit(1);
    if (!line) throw new DomainError("NOT_FOUND", "the line is not there");
    await lockEventForCapacity(tx, line.eventId);
    const entry = await lockedEntry(tx, entryId);
    const email = entry.email ?? trimmed(input.email);
    if (email === "") throw new DomainError("VALIDATION_ERROR", "the official list needs the person's address", ["email"]);
    const placed = await enterOnWaitlistByStaff(
      tx,
      actor,
      {
        eventId: entry.eventId,
        firstName: entry.firstName,
        lastName: entry.lastName,
        email,
        locale: input.locale,
        relayedByParticipantRequest: input.relayedByParticipantRequest,
        note: entry.note,
        // «E de la parteneri» (the decision «De la parteneri»): the line's partner onto the registration, in this transaction.
        partnerName: entry.partnerName,
        // The offer's raise, if any, is the move's in «Istoric capacitate» (§914).
        offerNow: input.offerNow ? { ...input.offerNow, via: "moveAndOffer" } : null,
      },
      now,
    );
    await tx.delete(eventReserveEntries).where(eq(eventReserveEntries.id, entry.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.moved",
      entityType: "event",
      entityId: entry.eventId,
      metadata: { entryId: entry.id, registrationId: placed.registrationId, ...(input.offerNow ? { offerNow: true } : {}) },
      now,
    });
    return { ...placed, eventId: entry.eventId };
  });
  // After the commit, as every raise tells the public count (§333).
  if (result.capacityRaisedTo !== null) revalidatePublicContent("places");
  return result;
}

export type ReserveOwnAddressInput = {
  /** The relay tick (§33), asked in the dialog as the move asks it. */
  relayedByParticipantRequest: boolean;
  /** The backoffice's language: the person's emails leave in it, as from the move. */
  locale: Locale;
};

/**
 * «Pe adresa mea, invitat special» on one line (the decision «A line of the internal list on the Administrator's own
 * address, as a special guest»; the owner, 2026-11-11, of a partners' guest with no address: «trebuie să pot să o pun și
 * fără mail»). The person is registered on **the pressing Administrator's own address** — `staff_users.email`, read
 * here by the actor's id, never an address posted by the form — and put on «Lista de invitați speciali» (§643) before
 * the allocator runs: a place outside the announced ones, the vouched hold's deadline (`computeVouchedPlaceExpiry`),
 * the ordinary declaration email to that address, no verification email. The declaration stays the person's: signed
 * from the link the Administrator forwards, or on paper at the start («Confirmă pe hârtie»).
 *
 * The Administrator's (`canManageRegistrations`, asserted here and again by the entry). One transaction under the event
 * row's lock — the lock every allocation takes (`AGENTS.md` §10.6): the switch «Folosește lista de invitați speciali»
 * (`HIDDEN_LIST_OFF`) and the start (`VOUCHED_ENTRY_AFTER_START`) asked before anything is written, then the line, then
 * the vouched entry (`enterOnWaitlistByStaff`: the name rule of several people on one address, `ALREADY_ON_ADDRESS` /
 * `ADDRESS_AT_CAP`, decided under that same lock), the line's note onto the registration (§777), its partner's name («De la
 * parteneri») and the line deleted.
 * Any refusal writes nothing and the line stays. The trail: the entry's rows, the special list's row and
 * `event_reserve.moved`, each tagged `via: OWN_ADDRESS_GUEST`, ids only.
 */
export async function moveReserveEntryToOwnAddress<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  input: ReserveOwnAddressInput,
  now: Date,
): Promise<WaitlistEntryByStaffResult & { eventId: string }> {
  assertMayKeep(actor);
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not register a line of the internal list on their own address`);
  }
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  return db.transaction(async (tx) => {
    const [line] = await tx.select({ eventId: eventReserveEntries.eventId }).from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).limit(1);
    if (!line) throw new DomainError("NOT_FOUND", "the line is not there");
    const event = await lockEventForCapacity(tx, line.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    if (!event.hiddenListEnabled) {
      throw new DomainError("VALIDATION_ERROR", "the special guests list is off for this event: tick «Folosește lista de invitați speciali» in the event's settings first", [HIDDEN_LIST_OFF]);
    }
    if (event.startsAt.getTime() <= now.getTime()) {
      throw new DomainError("VOUCHED_ENTRY_AFTER_START", "the event has started: enter the person at the desk instead");
    }
    const entry = await lockedEntry(tx, entryId);
    // The address is the actor's own, read from the account by its id: nothing the form posts reaches it.
    const [own] = await tx.select({ email: staffUsers.email }).from(staffUsers).where(eq(staffUsers.id, actor.id)).limit(1);
    if (!own) throw new DomainError("FORBIDDEN", "the account pressing is not there");
    const placed = await enterOnWaitlistByStaff(
      tx,
      actor,
      {
        eventId: entry.eventId,
        firstName: entry.firstName,
        lastName: entry.lastName,
        email: own.email,
        locale: input.locale,
        relayedByParticipantRequest: input.relayedByParticipantRequest,
        note: entry.note,
        // «E de la parteneri» (the decision «De la parteneri»): the line's partner onto the registration, in this transaction.
        partnerName: entry.partnerName,
        outsideCapacityVia: OWN_ADDRESS_GUEST,
      },
      now,
    );
    await tx.delete(eventReserveEntries).where(eq(eventReserveEntries.id, entry.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.moved",
      entityType: "event",
      entityId: entry.eventId,
      metadata: { entryId: entry.id, registrationId: placed.registrationId, via: OWN_ADDRESS_GUEST },
      now,
    });
    return { ...placed, eventId: entry.eventId };
  });
}

/**
 * After «Trece pe lista oficială» made a registration of the line: its note becomes the registration's
 * internal note (§777), its partner's name («De la parteneri») the registration's, and the line is removed. Nothing happens when the registration is not of the line's
 * event — another event chosen on the form, or a forged one: the note never lands on another event's row —
 * or when the line is already gone. The Administrator's since §888, as the one-press move.
 */
export async function settleReserveEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, registrationId: string, now: Date): Promise<void> {
  assertMayKeep(actor);
  assertMayMove(actor);
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
    // The line's partner, with the line's removal: a line already gone writes nothing on the registration.
    if (entry.partnerName) await writeRegistrationPartnerName(tx, actor.id, registration.id, entry.partnerName, now, "reserve");
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

/**
 * «Mută pe lista de elită» on one line (§903; the owner, 2026-11-03, of an elite runner written on the internal
 * list without an address: «având în vedere că e elită, nu trebuie să-i pun email»): the line's name onto the
 * race's elite list (§895) — printed on a bib where the number goes — and the line off the internal list. **Not a
 * registration**: no participant, no place, no queue, no email, no declaration, so no address is asked and the
 * declaration rule stays whole (an elite line is a name to print and nothing else). The Administrator's, as
 * writing the elite list and moving a line are (`canManageRegistrations`; asserted here and again at the action's
 * door, BR-REQ-060-01).
 *
 * One transaction: the event row locked as `addEliteEntry` locks it (the lock every draw takes, `AGENTS.md`
 * §10.6), then the line — the order an event's delete takes them in — then the elite line written with the line's
 * first and last name through `parseEliteEntry` (trimmed, inner spaces collapsed, 1 to `ELITE_NAME_MAX`
 * characters; a longer name is refused naming `name`, and nothing is written) and **no number** (the editor's
 * card is where a number is given, with its checks), and the line deleted. The note is not carried — an elite
 * line has none — nor the partner's name («De la parteneri»: it labels a registration, and nobody is registered), and the
 * address, if any, goes with the line. The trail: `event_elite.added` for the new line
 * and `event_reserve.moved` for the old one, ids only. A second press on a line already moved finds it gone.
 */
export async function moveReserveEntryToElite<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  now: Date,
): Promise<{ eventId: string; eliteEntryId: string }> {
  assertMayKeep(actor);
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not move a line of the internal list onto the elite list`);
  }
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  return db.transaction(async (tx) => {
    const [line] = await tx.select({ eventId: eventReserveEntries.eventId }).from(eventReserveEntries).where(eq(eventReserveEntries.id, entryId)).limit(1);
    if (!line) throw new DomainError("NOT_FOUND", "the line is not there");
    const event = await lockEventForCapacity(tx, line.eventId);
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const entry = await lockedEntry(tx, entryId);
    const { name } = parseEliteEntry({ name: `${entry.firstName} ${entry.lastName}`, bibNumber: null });
    const [elite] = await tx
      .insert(eventEliteEntries)
      .values({ eventId: entry.eventId, name, bibNumber: null, createdByStaffUserId: actor.id, createdAt: now })
      .returning({ id: eventEliteEntries.id });
    await tx.delete(eventReserveEntries).where(eq(eventReserveEntries.id, entry.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_elite.added",
      entityType: "event",
      entityId: entry.eventId,
      metadata: { entryId: elite.id, reserveEntryId: entry.id },
      now,
    });
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_reserve.moved",
      entityType: "event",
      entityId: entry.eventId,
      metadata: { entryId: entry.id, eliteEntryId: elite.id },
      now,
    });
    return { eventId: entry.eventId, eliteEntryId: elite.id };
  });
}
