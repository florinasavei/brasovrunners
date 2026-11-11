import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
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
 * rule (BR-REQ-060-01). **Delete** is narrower, as on a registration: the note's author, or whoever changes registrations
 * (`canManageRegistrations`, the Administrator and above).
 *
 * **What a note is** — plain text, line breaks kept, at most `VOLUNTEER_NOTE_MAX` characters (a registration note's own limit).
 * It is personal data about the volunteer: the privacy notice already says the organizers may add a note of their own about the
 * offer; «Toate datele unei persoane» lists them; «Șterge voluntarul», the thirty-day sweep and an event's hard delete take them
 * by the table's `ON DELETE CASCADE`.
 *
 * **The trail** names who and when and never the words: `volunteer.note_added` / `volunteer.note_deleted`, recorded as every
 * `volunteer.*` row is — entity `event`, the event's id — with `{ volunteerId }` and nothing else. A delete empties `body`.
 *
 * **The old single line.** Migration `0196` carried every `event_volunteers.note` into a note here; nothing new writes or shows
 * that column. One exception keeps «Șterge» true: deleting a note whose words equal the column also clears the column, in the
 * same transaction, so the words are really gone until the column's contract release drops it.
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
};

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayKeepNotes(actor: Pick<StaffUser, "role">): void {
  if (!canManageVolunteers(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or write a volunteer's internal notes`);
  }
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
  const mayDeleteAny = canManageRegistrations(actor.role);
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    authorName: row.authorId === null ? null : row.authorName,
    deletable: mayDeleteAny || (row.authorId !== null && row.authorId === actor.id),
  }));
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
 * «Șterge» on one note: its author's, or any when the actor changes registrations (the Administrator). The words are emptied and
 * `deleted_at` stamped in one write — and, when they are the volunteer's old single line word for word (the note carried from it),
 * that column is cleared in the same transaction. The trail records who and when, never the words. A note already deleted, or one
 * that is not there, is `NOT_FOUND`; a colleague's note to an Organizer is `FORBIDDEN`.
 */
export async function deleteVolunteerNote<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, noteId: string, now: Date): Promise<{ volunteerId: string }> {
  assertMayKeepNotes(actor);
  if (!isUuid(noteId)) throw new DomainError("NOT_FOUND", "no such note");
  return db.transaction(async (tx) => {
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
    if (!note) throw new DomainError("NOT_FOUND", "no such note");
    if (!canManageRegistrations(actor.role) && (note.authorId === null || note.authorId !== actor.id)) {
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
    if (note.oldNote !== null && note.oldNote === note.body) {
      await tx
        .update(eventVolunteers)
        .set({ note: null })
        .where(and(eq(eventVolunteers.id, note.volunteerId), eq(eventVolunteers.note, note.body)));
    }
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
