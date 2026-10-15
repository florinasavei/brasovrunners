import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { REGISTRATION_NOTE_MAX, registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";
import { canKeepRegistrationNotes, canManageRegistrations, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * Internal notes on a registration (§777; the owner, 2026-10-15: «trebuie să putem lăsa comentarii pe fiecare
 * înscriere în parte, doar pentru organizatori și administratori»).
 *
 * **Who** — the Organizer, the Administrator and the Superadministrator (`canKeepRegistrationNotes`), asserted in
 * every function below, so the page's drawing of the card and the action's gate are two more courtesies and
 * this is the rule (BR-REQ-060-01). The Tehnic role and the volunteer get nothing: not a note, not a count.
 * **Delete** is narrower: the note's author, or whoever changes registrations (`canManageRegistrations`).
 *
 * **What a note is** — plain text in the author's own language, up to `REGISTRATION_NOTE_MAX` characters,
 * line breaks kept. It is personal data about the participant: the privacy notice's template says the
 * organizers may keep them (§754's paragraph, amended), «Toate datele unei persoane» lists them (art. 15), and
 * the registration's erase takes them with it — `ON DELETE CASCADE`, so the erase, the retention sweep and an
 * event's hard delete all do, and no audit row ever carried the words.
 *
 * **The trail** names who and when and never the words: `registration.note_added` / `registration.note_deleted`
 * with an empty metadata. A delete empties the row's `body` (the words are gone, not merely hidden) and stamps
 * `deleted_at`; nothing reads a deleted row.
 *
 * **Where a note never appears** — the race-day desk (§67: a name, a state and a number), the public list,
 * every email. None of those queries read this table, and a test holds each.
 *
 * **The one file that carries them (§785; the owner, 2026-10-15: «asta trebuie de asemenea să fie și în Excel!»)** —
 * the registrations export, the spreadsheet and the CSV, a last column «Note interne» for a role that may keep
 * notes (`listRegistrationNotesForExport` here, `exportNotesCell` for the words; the route asks the same
 * `canKeepRegistrationNotes` before it asks for the column, and the reader asserts it again). The author is a
 * role, never a name, as on «Toate datele unei persoane».
 */

/** One note as the registration's page draws it. */
export type RegistrationNoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  /** The author's display name as the audit trail and the desk show a colleague; null once the account is gone. */
  authorName: string | null;
  /** Whether the reader may delete it: their own, or any when they change registrations. */
  deletable: boolean;
};

type Actor = Pick<StaffUser, "id" | "role">;

function assertMayKeepNotes(actor: Pick<StaffUser, "role">): void {
  if (!canKeepRegistrationNotes(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read or write a registration's internal notes`);
  }
}

/**
 * The words of a note, ready to store: line breaks as `\n`, the ends trimmed. Refused when nothing is left
 * (`NOTE_EMPTY`) or when more than `REGISTRATION_NOTE_MAX` characters remain (`NOTE_TOO_LONG`), each naming the
 * box. Counted in characters the way the table's check counts them (`char_length`), so an emoji is one.
 */
export function parseNoteBody(raw: unknown): string {
  const body = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (body === "") throw new DomainError("NOTE_EMPTY", "a note needs words", ["body"]);
  if ([...body].length > REGISTRATION_NOTE_MAX) throw new DomainError("NOTE_TOO_LONG", `a note holds at most ${REGISTRATION_NOTE_MAX} characters`, ["body"]);
  return body;
}

/** A foreign-key violation — the registration was erased between the read and the write. */
function isForeignKeyViolation(error: unknown): boolean {
  for (let current: unknown = error; current && typeof current === "object"; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: unknown }).code === "23503") return true;
  }
  return false;
}

/**
 * «Salvează nota»: one note on one registration, by an Organizer or above. Any status, any kind — a note on a
 * cancelled row is still a note. The trail row carries no words.
 */
export async function addRegistrationNote<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
  rawBody: unknown,
  now: Date,
): Promise<{ id: string }> {
  assertMayKeepNotes(actor);
  const body = parseNoteBody(rawBody);
  if (!isUuid(registrationId)) throw new DomainError("NOT_FOUND", "no such registration");
  const [registration] = await db
    .select({ id: registrations.id, participantId: registrations.participantId })
    .from(registrations)
    .where(eq(registrations.id, registrationId))
    .limit(1);
  if (!registration) throw new DomainError("NOT_FOUND", "no such registration");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(registrationNotes)
        .values({ registrationId, authorStaffUserId: actor.id, body, createdAt: now, updatedAt: now })
        .returning({ id: registrationNotes.id });
      await recordAuditEvent(tx, {
        actorStaffUserId: actor.id,
        participantId: registration.participantId,
        action: "registration.note_added",
        entityType: "registration",
        entityId: registrationId,
        metadata: {},
        now,
      });
      return row;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new DomainError("NOT_FOUND", "no such registration");
    throw error;
  }
}

/**
 * A registration's live notes, newest first, each with its author's display name — the card's read. Asserted
 * here: a role that may not keep notes is refused, never given an empty list that looks like «none».
 */
export async function listRegistrationNotes<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  registrationId: string,
): Promise<RegistrationNoteRow[]> {
  assertMayKeepNotes(actor);
  if (!isUuid(registrationId)) return [];
  const rows = await db
    .select({
      id: registrationNotes.id,
      body: registrationNotes.body,
      createdAt: registrationNotes.createdAt,
      authorId: registrationNotes.authorStaffUserId,
      authorName: staffUsers.displayName,
    })
    .from(registrationNotes)
    .leftJoin(staffUsers, eq(staffUsers.id, registrationNotes.authorStaffUserId))
    .where(and(eq(registrationNotes.registrationId, registrationId), isNull(registrationNotes.deletedAt)))
    .orderBy(desc(registrationNotes.createdAt), desc(registrationNotes.id));
  const mayDeleteAny = canManageRegistrations(actor.role);
  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    authorName: row.authorId === null ? null : row.authorName,
    deletable: mayDeleteAny || row.authorId === actor.id,
  }));
}

/**
 * How many live notes each of these registrations has — the list's marker, in **one grouped query** over the
 * page's ids (as `listResubmissionMarks`), never a query per row. A registration with none is absent from the
 * map. Asserted like the read: the list asks it only for a role that may.
 */
export async function countRegistrationNotes<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  registrationIds: readonly string[],
): Promise<Map<string, number>> {
  assertMayKeepNotes(actor);
  const counts = new Map<string, number>();
  const ids = registrationIds.filter(isUuid);
  if (ids.length === 0) return counts;
  const rows = await db
    .select({ registrationId: registrationNotes.registrationId, total: count() })
    .from(registrationNotes)
    .where(and(inArray(registrationNotes.registrationId, ids), isNull(registrationNotes.deletedAt)))
    .groupBy(registrationNotes.registrationId);
  for (const row of rows) counts.set(row.registrationId, row.total);
  return counts;
}

/** One live note as the export reads it: when, by which role (null once the account is gone), and the words. */
export type ExportNote = { createdAt: Date; authorRole: StaffRole | null; body: string };

/**
 * The live notes of the exported registrations (§785), in **one grouped query** over their ids — never a query
 * per row — each registration's list newest first (`created_at` then `id` descending, as the card). A
 * registration with none is absent from the map; a soft-deleted note is never read (`deleted_at IS NULL`, and its
 * words are gone anyway). The author is the role only: the display name is not selected. Asserted here like the
 * card's read: a role that may not keep notes is refused, never handed an empty map that looks like «none».
 */
export async function listRegistrationNotesForExport<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  registrationIds: readonly string[],
): Promise<Map<string, ExportNote[]>> {
  assertMayKeepNotes(actor);
  const notes = new Map<string, ExportNote[]>();
  const ids = registrationIds.filter(isUuid);
  if (ids.length === 0) return notes;
  const rows = await db
    .select({
      registrationId: registrationNotes.registrationId,
      body: registrationNotes.body,
      createdAt: registrationNotes.createdAt,
      authorRole: staffUsers.role,
    })
    .from(registrationNotes)
    .leftJoin(staffUsers, eq(staffUsers.id, registrationNotes.authorStaffUserId))
    .where(and(inArray(registrationNotes.registrationId, ids), isNull(registrationNotes.deletedAt)))
    .orderBy(desc(registrationNotes.createdAt), desc(registrationNotes.id));
  for (const row of rows) {
    const list = notes.get(row.registrationId) ?? [];
    list.push({ createdAt: row.createdAt, authorRole: row.authorRole, body: row.body });
    notes.set(row.registrationId, list);
  }
  return notes;
}

/**
 * The most characters the notes cell holds (§785). Excel stops at 32 767 per cell and silently cuts what is
 * past it; the file stops a little before, at a note's end, and says so on its last line.
 */
export const EXPORT_NOTES_CELL_MAX = 32_000;

/** The words the cell is written in, from the reader's language (`Admin.registrations.notes.export*`). */
export type ExportNotesWords = {
  /** The author's role, written out. */
  roles: Record<StaffRole, string>;
  /** Where the author is gone («cont șters»). */
  authorGone: string;
  /** The closing line when the cap cut the list («… (mai multe note pe pagina înscrierii)»). */
  more: string;
};

/**
 * One registration's notes as the export's cell (§785): one note a line, newest first, each
 * «<date> · <rolul autorului>: <text>» — the date on the event's clock (`dd.mm.yyyy hh:mm`), the author's role and
 * never their name — a note's own line breaks kept inside the cell. Empty for no notes. Cut at a note's end below
 * `EXPORT_NOTES_CELL_MAX` with `words.more` as the last line, so the cell is never past what Excel keeps.
 */
export function exportNotesCell(notes: readonly ExportNote[] | undefined, timeZone: string, words: ExportNotesWords): string {
  if (!notes || notes.length === 0) return "";
  const lines: string[] = [];
  let length = 0;
  for (const [index, note] of notes.entries()) {
    const [day, time] = toWallTimeInput(note.createdAt, timeZone).split("T");
    const [year, month, date] = day.split("-");
    const role = note.authorRole ? words.roles[note.authorRole] : words.authorGone;
    const line = `${date}.${month}.${year} ${time} · ${role}: ${note.body.replace(/\r\n?/g, "\n")}`;
    // The room the closing line needs is kept back unless this is the last note and it fits whole.
    const room = EXPORT_NOTES_CELL_MAX - (index === notes.length - 1 ? 0 : words.more.length + 1);
    if (index > 0 && length + 1 + line.length > room) {
      lines.push(words.more);
      break;
    }
    lines.push(line);
    length += (index > 0 ? 1 : 0) + line.length;
  }
  return lines.join("\n");
}

/**
 * «Șterge» on one note: its author's, or any when the actor changes registrations (the Administrator). The words
 * are emptied and `deleted_at` stamped in one write, and the trail records who and when, never the words. A note
 * already deleted, or one that is not there, is `NOT_FOUND`; a colleague's note to an Organizer is `FORBIDDEN`.
 */
export async function deleteRegistrationNote<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  noteId: string,
  now: Date,
): Promise<{ registrationId: string }> {
  assertMayKeepNotes(actor);
  if (!isUuid(noteId)) throw new DomainError("NOT_FOUND", "no such note");
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        id: registrationNotes.id,
        registrationId: registrationNotes.registrationId,
        authorId: registrationNotes.authorStaffUserId,
        participantId: registrations.participantId,
      })
      .from(registrationNotes)
      .innerJoin(registrations, eq(registrations.id, registrationNotes.registrationId))
      .where(and(eq(registrationNotes.id, noteId), isNull(registrationNotes.deletedAt)))
      .limit(1);
    if (!note) throw new DomainError("NOT_FOUND", "no such note");
    if (!canManageRegistrations(actor.role) && note.authorId !== actor.id) {
      throw new DomainError("FORBIDDEN", "a note is deleted by its author or by an Administrator");
    }
    // Only a live row is emptied: a second press that raced the first matches nothing and is a NOT_FOUND.
    const emptied = await tx
      .update(registrationNotes)
      .set({ body: "", deletedAt: now, updatedAt: now })
      .where(and(eq(registrationNotes.id, noteId), isNull(registrationNotes.deletedAt)))
      .returning({ id: registrationNotes.id });
    if (emptied.length === 0) throw new DomainError("NOT_FOUND", "no such note");
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      participantId: note.participantId,
      action: "registration.note_deleted",
      entityType: "registration",
      entityId: note.registrationId,
      metadata: {},
      now,
    });
    return { registrationId: note.registrationId };
  });
}
