import { and, count, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { eventVolunteerNotes, VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations, canManageVolunteers, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { type ExportNote, noteBodyOf } from "@/shared/notes/note-text";

/**
 * «Note interne» on a volunteer (amending the single organizers' line of §754, after a registration's notes, §777 and §785): what
 * the organizers tell each other about one person who offered to help, several dated notes each with its author.
 *
 * **Who** — whoever manages the volunteers (`canManageVolunteers`: the Organizer, the Administrator, the Superadministrator),
 * asserted in every function below, so the page's card, the list's marker and the actions' gates are courtesies and this is the
 * rule (BR-REQ-060-01). **Delete and edit** are narrower, as a registration's delete: the note's author, or whoever changes
 * registrations (`canManageRegistrations`, the Administrator and above) — one rule for both, `mayChangeNote` (§964).
 *
 * **What a note is** — plain text, line breaks kept, at most `VOLUNTEER_NOTE_MAX` characters (a registration note's own limit).
 * It is personal data about the volunteer: the privacy notice already says the organizers may add a note of their own about the
 * offer; «Toate datele unei persoane» lists them; «Șterge voluntarul», the thirty-day sweep and an event's hard delete take them
 * by the table's `ON DELETE CASCADE`. An edit changes the words and `updated_at`, never `created_at` or the author: the note
 * keeps its place in the thread, and no earlier words are kept anywhere (§964).
 *
 * **The trail** names who and when and never the words: `volunteer.note_added` / `volunteer.note_edited` /
 * `volunteer.note_deleted`, recorded as every `volunteer.*` row is — entity `event`, the event's id — with `{ volunteerId }` and
 * nothing else. A delete empties `body`.
 *
 * **The old single line.** Migration `0196` carried every `event_volunteers.note` into a note here; nothing new writes or shows
 * that column. One exception keeps «Șterge» and «Modifică» true: deleting or changing a note whose words equal the column also
 * clears the column, in the same transaction, so the old words are really gone until the column's contract release drops it.
 *
 * **On «Planul voluntarilor»** (§981, amending this section's «never elsewhere»; the owner, 2026-11-18: «să văd în plan și
 * comentariile mele»): beside each person the plan draws, the words and the moment of each live note — on the screen only, never on
 * paper — read in one query for the event (`listVolunteerNotesForPlan`), for a role this file's gate allows (`mayReadVolunteerNotes`).
 *
 * Never imported by the registrations' notes (`modules/registrations/notes.ts`) or its table: the two kinds of note share only
 * the pure words (`shared/notes/note-text.ts`). A file that reads this one is a reviewed edit of
 * `tests/unit/volunteers/volunteer-notes-never-leave.test.ts`.
 */

/** One note as the volunteer's page draws it. */
export type VolunteerNoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  /** The author's display name, as the trail names a colleague; null when nobody can be named («autor necunoscut»). */
  authorName: string | null;
  /** Whether the reader may delete it: their own, or any when they change registrations. */
  deletable: boolean;
  /** Whether the reader may change its words (§964) — the same rule as the delete's, so the same answer. */
  editable: boolean;
};

/**
 * One live note as the «Voluntari» list's row reads it (§964): its words and moment for the column and the marker's tooltip, and
 * for the row's «Modifică nota» its id and whether the reader may change it. No author: the list names nobody.
 */
export type VolunteerListNote = { id: string; createdAt: Date; body: string; editable: boolean };

/**
 * One live note as «Planul voluntarilor» draws it beside its person (§981): its words and its moment, newest first. No author and
 * no press: the plan names nobody and changes no note — the person's page does.
 */
export type VolunteerPlanNote = { id: string; createdAt: Date; body: string };

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * Whether a role may read a volunteer's internal notes at all: the one gate every function below asserts. A screen that draws
 * notes beside something a wider gate allows (the plan, §981) asks this first and leaves the notes out for anyone else.
 */
export function mayReadVolunteerNotes(role: StaffRole): boolean {
  return canManageVolunteers(role);
}

function assertMayKeepNotes(actor: Pick<StaffUser, "role">): void {
  if (!mayReadVolunteerNotes(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or write a volunteer's internal notes`);
  }
}

/**
 * Whether the actor may change or delete a note written by `authorId` (§964): their own, or any when they change registrations
 * (the Administrator and above). A note nobody can be named for (a carried line, an author's account gone) is the Administrator's.
 * The one rule behind «Șterge», «Modifică», «Modifică nota» and the flags the screens draw them by.
 */
function mayChangeNote(actor: Actor, authorId: string | null): boolean {
  return canManageRegistrations(actor.role) || (authorId !== null && authorId === actor.id);
}

/** The words of a volunteer's note, ready to store (`noteBodyOf` at the volunteers' limit), refused naming `box`. */
export function parseVolunteerNoteBody(raw: unknown, box = "body"): string {
  return noteBodyOf(raw, VOLUNTEER_NOTE_MAX, box);
}

/** A foreign-key violation — the volunteer was deleted between the read and the write. */
function isForeignKeyViolation(error: unknown): boolean {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23503") return true;
  }
  return false;
}

/**
 * One note written inside a transaction the caller holds: the card's «Salvează nota» below, and «Adaugă un voluntar de mână»'s
 * first note, written in the add's own transaction (`changeVolunteer`). The words must already be parsed. Asserted here too.
 */
export async function insertVolunteerNote<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Actor,
  volunteer: { id: string; eventId: string },
  body: string,
  now: Date,
): Promise<{ id: string }> {
  assertMayKeepNotes(actor);
  const [row] = await tx
    .insert(eventVolunteerNotes)
    .values({ volunteerId: volunteer.id, authorStaffUserId: actor.id, body, createdAt: now, updatedAt: now })
    .returning({ id: eventVolunteerNotes.id });
  await recordAuditEvent(tx, {
    actorStaffUserId: actor.id,
    action: "volunteer.note_added",
    entityType: "event",
    entityId: volunteer.eventId,
    metadata: { volunteerId: volunteer.id },
    now,
  });
  return row;
}

/** «Salvează nota»: one note on one volunteer, whatever their state. The trail row carries no words. */
export async function addVolunteerNote<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  volunteerId: string,
  rawBody: unknown,
  now: Date,
): Promise<{ id: string; volunteerId: string }> {
  assertMayKeepNotes(actor);
  const body = parseVolunteerNoteBody(rawBody);
  if (!isUuid(volunteerId)) throw new DomainError("NOT_FOUND", "no such volunteer");
  const [volunteer] = await db.select({ id: eventVolunteers.id, eventId: eventVolunteers.eventId }).from(eventVolunteers).where(eq(eventVolunteers.id, volunteerId)).limit(1);
  if (!volunteer) throw new DomainError("NOT_FOUND", "no such volunteer");
  try {
    const row = await db.transaction((tx) => insertVolunteerNote(tx, actor, volunteer, body, now));
    return { id: row.id, volunteerId };
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new DomainError("NOT_FOUND", "no such volunteer");
    throw error;
  }
}

/** A volunteer's live notes, newest first, each with its author's display name — the card's read. A refused role gets no list. */
export async function listVolunteerNotes<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, volunteerId: string): Promise<VolunteerNoteRow[]> {
  assertMayKeepNotes(actor);
  if (!isUuid(volunteerId)) return [];
  const rows = await db
    .select({
      id: eventVolunteerNotes.id,
      body: eventVolunteerNotes.body,
      createdAt: eventVolunteerNotes.createdAt,
      authorId: eventVolunteerNotes.authorStaffUserId,
      authorName: staffUsers.displayName,
    })
    .from(eventVolunteerNotes)
    .leftJoin(staffUsers, eq(staffUsers.id, eventVolunteerNotes.authorStaffUserId))
    .where(and(eq(eventVolunteerNotes.volunteerId, volunteerId), isNull(eventVolunteerNotes.deletedAt)))
    .orderBy(desc(eventVolunteerNotes.createdAt), desc(eventVolunteerNotes.id));
  return rows.map((row) => {
    const mayChange = mayChangeNote(actor, row.authorId);
    return {
      id: row.id,
      body: row.body,
      createdAt: row.createdAt,
      authorName: row.authorId === null ? null : row.authorName,
      deletable: mayChange,
      editable: mayChange,
    };
  });
}

/**
 * How many live notes each of these volunteers has — the «Voluntari» list's marker, in **one grouped query** over the page's ids,
 * never a query per row. A volunteer with none is absent from the map.
 */
export async function countVolunteerNotes<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  volunteerIds: readonly string[],
): Promise<Map<string, number>> {
  assertMayKeepNotes(actor);
  const counts = new Map<string, number>();
  const ids = volunteerIds.filter(isUuid);
  if (ids.length === 0) return counts;
  const rows = await db
    .select({ volunteerId: eventVolunteerNotes.volunteerId, total: count() })
    .from(eventVolunteerNotes)
    .where(and(inArray(eventVolunteerNotes.volunteerId, ids), isNull(eventVolunteerNotes.deletedAt)))
    .groupBy(eventVolunteerNotes.volunteerId);
  for (const row of rows) counts.set(row.volunteerId, row.total);
  return counts;
}

/**
 * The live notes of these volunteers as a file or the person's record reads them, in **one grouped query** over their ids, each
 * volunteer's list newest first: when, the author's ROLE (never the name — the display name is not selected), and the words. A
 * volunteer with none is absent from the map; a deleted note is never read.
 */
export async function listVolunteerNotesForExport<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  volunteerIds: readonly string[],
): Promise<Map<string, ExportNote<StaffRole>[]>> {
  assertMayKeepNotes(actor);
  const notes = new Map<string, ExportNote<StaffRole>[]>();
  const ids = [...new Set(volunteerIds.filter(isUuid))];
  if (ids.length === 0) return notes;
  const rows = await db
    .select({
      volunteerId: eventVolunteerNotes.volunteerId,
      body: eventVolunteerNotes.body,
      createdAt: eventVolunteerNotes.createdAt,
      authorRole: staffUsers.role,
    })
    .from(eventVolunteerNotes)
    .leftJoin(staffUsers, eq(staffUsers.id, eventVolunteerNotes.authorStaffUserId))
    .where(and(inArray(eventVolunteerNotes.volunteerId, ids), isNull(eventVolunteerNotes.deletedAt)))
    .orderBy(desc(eventVolunteerNotes.createdAt), desc(eventVolunteerNotes.id));
  for (const row of rows) {
    const list = notes.get(row.volunteerId) ?? [];
    list.push({ createdAt: row.createdAt, authorRole: row.authorRole, body: row.body });
    notes.set(row.volunteerId, list);
  }
  return notes;
}

/**
 * The live notes of the «Voluntari» list's rows (§964), in **one grouped query** over the page's ids, each volunteer's list newest
 * first: the words for the column «Note interne» and the marker's tooltip, how many for the marker, and each note's id and
 * whether the reader may change it — the row's «Modifică nota» is drawn on the newest one alone, and only when it may. Neither
 * the author's name nor role is read: the list names nobody. A volunteer with none is absent from the map; a deleted note is
 * never read.
 */
export async function listVolunteerNotesForList<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  volunteerIds: readonly string[],
): Promise<Map<string, VolunteerListNote[]>> {
  assertMayKeepNotes(actor);
  const notes = new Map<string, VolunteerListNote[]>();
  const ids = [...new Set(volunteerIds.filter(isUuid))];
  if (ids.length === 0) return notes;
  const rows = await db
    .select({
      id: eventVolunteerNotes.id,
      volunteerId: eventVolunteerNotes.volunteerId,
      body: eventVolunteerNotes.body,
      createdAt: eventVolunteerNotes.createdAt,
      authorId: eventVolunteerNotes.authorStaffUserId,
    })
    .from(eventVolunteerNotes)
    .where(and(inArray(eventVolunteerNotes.volunteerId, ids), isNull(eventVolunteerNotes.deletedAt)))
    .orderBy(desc(eventVolunteerNotes.createdAt), desc(eventVolunteerNotes.id));
  for (const row of rows) {
    const list = notes.get(row.volunteerId) ?? [];
    list.push({ id: row.id, createdAt: row.createdAt, body: row.body, editable: mayChangeNote(actor, row.authorId) });
    notes.set(row.volunteerId, list);
  }
  return notes;
}

/**
 * The live notes of one event's people who are not cancelled — the people «Planul voluntarilor» draws (§981) —, in **one query** for
 * the whole event, never one per person: each volunteer's list newest first, the words and the moment alone. Neither the author's
 * name nor role is read: the plan names nobody. A volunteer with none is absent from the map; a deleted note is never read; a value
 * that is no id reads nothing.
 */
export async function listVolunteerNotesForPlan<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  eventId: string,
): Promise<Map<string, VolunteerPlanNote[]>> {
  assertMayKeepNotes(actor);
  const notes = new Map<string, VolunteerPlanNote[]>();
  if (!isUuid(eventId)) return notes;
  const rows = await db
    .select({ id: eventVolunteerNotes.id, volunteerId: eventVolunteerNotes.volunteerId, body: eventVolunteerNotes.body, createdAt: eventVolunteerNotes.createdAt })
    .from(eventVolunteerNotes)
    .innerJoin(eventVolunteers, eq(eventVolunteers.id, eventVolunteerNotes.volunteerId))
    .where(and(eq(eventVolunteers.eventId, eventId), ne(eventVolunteers.state, "CANCELLED"), isNull(eventVolunteerNotes.deletedAt)))
    .orderBy(desc(eventVolunteerNotes.createdAt), desc(eventVolunteerNotes.id));
  for (const row of rows) {
    const list = notes.get(row.volunteerId) ?? [];
    list.push({ id: row.id, createdAt: row.createdAt, body: row.body });
    notes.set(row.volunteerId, list);
  }
  return notes;
}

/** A live note with what changing or deleting it needs — its volunteer, author and words, the event, the old single line — or none. */
async function liveNoteOf<T extends Record<string, unknown>>(tx: Database<T>, noteId: string) {
  const [note] = await tx
    .select({
      volunteerId: eventVolunteerNotes.volunteerId,
      authorId: eventVolunteerNotes.authorStaffUserId,
      body: eventVolunteerNotes.body,
      eventId: eventVolunteers.eventId,
      oldNote: eventVolunteers.note,
    })
    .from(eventVolunteerNotes)
    .innerJoin(eventVolunteers, eq(eventVolunteers.id, eventVolunteerNotes.volunteerId))
    .where(and(eq(eventVolunteerNotes.id, noteId), isNull(eventVolunteerNotes.deletedAt)))
    .limit(1);
  return note;
}

/**
 * The old single line goes with the words it holds: when the note just deleted or changed carried it word for word (`0196`), the
 * column is cleared in the same transaction — only while it still holds those words.
 */
async function clearCarriedLine<T extends Record<string, unknown>>(tx: Database<T>, note: { volunteerId: string; body: string; oldNote: string | null }): Promise<void> {
  if (note.oldNote === null || note.oldNote !== note.body) return;
  await tx
    .update(eventVolunteers)
    .set({ note: null })
    .where(and(eq(eventVolunteers.id, note.volunteerId), eq(eventVolunteers.note, note.body)));
}

/**
 * «Șterge» on one note: its author's, or any when the actor changes registrations (the Administrator). The words are emptied and
 * `deleted_at` stamped in one write — and, when they are the volunteer's old single line word for word (the note carried from it),
 * that column is cleared in the same transaction. The trail records who and when, never the words. A note already deleted, or one
 * that is not there, is `NOT_FOUND`; a colleague's note to an Organizer is `FORBIDDEN`.
 */
export async function deleteVolunteerNote<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, noteId: string, now: Date): Promise<{ volunteerId: string }> {
  assertMayKeepNotes(actor);
  if (!isUuid(noteId)) throw new DomainError("NOT_FOUND", "no such note");
  return db.transaction(async (tx) => {
    const note = await liveNoteOf(tx, noteId);
    if (!note) throw new DomainError("NOT_FOUND", "no such note");
    if (!mayChangeNote(actor, note.authorId)) {
      throw new DomainError("FORBIDDEN", "a note is deleted by its author or by an Administrator");
    }
    // Only a live row is emptied: a second press that raced the first matches nothing and is a NOT_FOUND.
    const emptied = await tx
      .update(eventVolunteerNotes)
      .set({ body: "", deletedAt: now, updatedAt: now })
      .where(and(eq(eventVolunteerNotes.id, noteId), isNull(eventVolunteerNotes.deletedAt)))
      .returning({ id: eventVolunteerNotes.id });
    if (emptied.length === 0) throw new DomainError("NOT_FOUND", "no such note");
    // The question says the words are gone: the old line that holds the same words goes too (only while it still does).
    await clearCarriedLine(tx, note);
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.note_deleted",
      entityType: "event",
      entityId: note.eventId,
      metadata: { volunteerId: note.volunteerId },
      now,
    });
    return { volunteerId: note.volunteerId };
  });
}

/**
 * «Modifică» on one note (§964; the owner, 2026-11-17, of the «Voluntari» list: «lasă-mă să editez și nota internă»): new words
 * for a note, by the hands that may delete it — its author, or any note when the actor changes registrations (the Administrator);
 * a colleague's note to an Organizer is `FORBIDDEN`, as for «Șterge». The words go through the add's own reading
 * (`parseVolunteerNoteBody`: `NOTE_EMPTY`, `NOTE_TOO_LONG`, naming the box `body`). A note deleted, one that is not there, or a
 * malformed id is `NOT_FOUND`. The same words after that reading are `{ changed: false }`: nothing written, nothing in the trail.
 *
 * Otherwise one transaction: `body` and `updated_at` change — never `created_at` or the author, so the note keeps its place in
 * the thread and its byline — one `volunteer.note_edited` row says who and when with `{ volunteerId }` and never the words, before
 * or after; and, as for «Șterge», the old single line goes when it held the note's old words, so they do not outlive their change.
 * Nothing else of the person moves: no email, no public cache tag, no state, role or tick.
 */
export async function editVolunteerNote<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  noteId: string,
  rawBody: unknown,
  now: Date,
): Promise<{ volunteerId: string; changed: boolean }> {
  assertMayKeepNotes(actor);
  const body = parseVolunteerNoteBody(rawBody);
  if (!isUuid(noteId)) throw new DomainError("NOT_FOUND", "no such note");
  return db.transaction(async (tx) => {
    const note = await liveNoteOf(tx, noteId);
    if (!note) throw new DomainError("NOT_FOUND", "no such note");
    if (!mayChangeNote(actor, note.authorId)) {
      throw new DomainError("FORBIDDEN", "a note is changed by its author or by an Administrator");
    }
    if (note.body === body) return { volunteerId: note.volunteerId, changed: false };
    // Only a live row takes the words: a delete that raced this press leaves nothing to change, a NOT_FOUND.
    const changed = await tx
      .update(eventVolunteerNotes)
      .set({ body, updatedAt: now })
      .where(and(eq(eventVolunteerNotes.id, noteId), isNull(eventVolunteerNotes.deletedAt)))
      .returning({ id: eventVolunteerNotes.id });
    if (changed.length === 0) throw new DomainError("NOT_FOUND", "no such note");
    // The old words are gone: the old line that holds them goes too (only while it still does).
    await clearCarriedLine(tx, note);
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "volunteer.note_edited",
      entityType: "event",
      entityId: note.eventId,
      metadata: { volunteerId: note.volunteerId },
      now,
    });
    return { volunteerId: note.volunteerId, changed: true };
  });
}
