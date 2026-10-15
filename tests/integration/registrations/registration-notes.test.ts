import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { REGISTRATION_NOTE_MAX, registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { listDeskRegistrations, listRegistrationsForAdmin } from "@/modules/registrations/admin-repository";
import { buildRegistrationsCsv } from "@/modules/registrations/csv";
import { addRegistrationNote, countRegistrationNotes, deleteRegistrationNote, listRegistrationNotes, parseNoteBody } from "@/modules/registrations/notes";
import { exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import { listPublicStartList } from "@/modules/registrations/repository";
import { resolveDisplayName } from "@/modules/registrations/names";
import { canKeepRegistrationNotes, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * Internal notes on a registration (§NNN; BR-REQ-037-03, BR-REQ-060-01, BR-REQ-053-01) — the table, the
 * service and what must never carry a note: read from a real database (PGlite, the same migrations as Neon).
 *
 * The owner, 2026-10-15: «ca și Admins, trebuie să putem lăsa comentarii pe fiecare înscriere în parte, doar
 * pentru organizatori și administratori». The Organizer, the Administrator and the Superadministrator keep
 * notes; the Tehnic role, the volunteer, the Redactor and a member get nothing, asserted in the service. A
 * note is deleted with its registration, and the trail names who and when and never the words.
 */
const NOW = new Date("2026-10-15T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));

const { deleteRegistrationByStaff } = await import("@/modules/registrations/admin-service");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function createRace(): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 150 })
    .returning();
  return event.id;
}

let serial = 0;
async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}): Promise<{ id: string; email: string }> {
  serial += 1;
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: resolveDisplayName({ legalName: `Runner ${serial}` }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "CONFIRMED",
      confirmedAt: NOW,
      ...row,
    })
    .returning({ id: registrations.id });
  return { id: created.id, email };
}

async function staff(role: StaffRole, name = `Colleague ${role}`): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${name.toLowerCase().replaceAll(" ", ".")}@dev.test`, displayName: name, role }).returning();
  return user;
}

async function failureOf(operation: Promise<unknown>) {
  try {
    await operation;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error("expected a DomainError");
}

const WORDS = "cere tricou S și vine cu un copil de 4 ani";

describe("the table and its cascade (migration 0162)", () => {
  it("keeps a note until its registration goes, and then keeps nothing — a deleted one too", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const organizer = await staff("MODERATOR");
    const { id: noteId } = await addRegistrationNote(db, organizer, id, WORDS, NOW);
    await addRegistrationNote(db, organizer, id, "a doua", minutes(1));
    await deleteRegistrationNote(db, organizer, noteId, minutes(2));
    expect(await db.select().from(registrationNotes)).toHaveLength(2);

    await db.delete(registrations).where(eq(registrations.id, id));
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
  });

  it("refuses a body past the limit in the table itself, not only in the service", async () => {
    const race = await createRace();
    const { id } = await register(race);
    await db.insert(registrationNotes).values({ registrationId: id, body: "x".repeat(REGISTRATION_NOTE_MAX) });
    await expectViolation(db.insert(registrationNotes).values({ registrationId: id, body: "x".repeat(REGISTRATION_NOTE_MAX + 1) }), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "registration_notes_body_length",
    });
  });

  it("keeps the note when its author's account is removed, and says the author is gone", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const author = await staff("MODERATOR", "Leaving Colleague");
    const reader = await staff("ADMIN");
    await addRegistrationNote(db, author, id, WORDS, NOW);
    await db.delete(staffUsers).where(eq(staffUsers.id, author.id));
    const [row] = await listRegistrationNotes(db, reader, id);
    expect(row).toMatchObject({ body: WORDS, authorName: null });
  });
});

describe("add, list and the words (parseNoteBody)", () => {
  it("lists a registration's notes newest first with the author's display name, and records who and when — never the words", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const organizer = await staff("MODERATOR", "Ioana Organizer");
    const admin = await staff("ADMIN", "Andrei Admin");
    await addRegistrationNote(db, organizer, id, "prima", NOW);
    await addRegistrationNote(db, admin, id, "a doua", minutes(5));

    const notes = await listRegistrationNotes(db, admin, id);
    expect(notes.map((note) => [note.body, note.authorName])).toEqual([
      ["a doua", "Andrei Admin"],
      ["prima", "Ioana Organizer"],
    ]);

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"));
    expect(trail).toHaveLength(2);
    for (const row of trail) {
      expect(row).toMatchObject({ entityType: "registration", entityId: id, metadataJson: {} });
      expect(JSON.stringify(row)).not.toMatch(/prima|a doua/);
    }
    expect(trail.map((row) => row.actorStaffUserId).sort()).toEqual([organizer.id, admin.id].sort());
    expect(trail.map((row) => row.createdAt.toISOString()).sort()).toEqual([NOW.toISOString(), minutes(5).toISOString()]);
  });

  it("keeps the line breaks, trims the ends and counts characters, not bytes", () => {
    expect(parseNoteBody("  una\r\ndoua\rtrei  ")).toBe("una\ndoua\ntrei");
    expect(parseNoteBody("😀".repeat(REGISTRATION_NOTE_MAX))).toHaveLength(REGISTRATION_NOTE_MAX * 2);
    expect(() => parseNoteBody("😀".repeat(REGISTRATION_NOTE_MAX + 1))).toThrow(/at most/);
  });

  it("refuses an empty or too long note, naming the box, and writes nothing", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const organizer = await staff("MODERATOR");
    for (const empty of ["", "   \n ", undefined, 42]) {
      expect(await failureOf(addRegistrationNote(db, organizer, id, empty, NOW))).toMatchObject({ code: "NOTE_EMPTY", fields: ["body"] });
    }
    expect(await failureOf(addRegistrationNote(db, organizer, id, "x".repeat(REGISTRATION_NOTE_MAX + 1), NOW))).toMatchObject({ code: "NOTE_TOO_LONG", fields: ["body"] });
    await addRegistrationNote(db, organizer, id, "x".repeat(REGISTRATION_NOTE_MAX), NOW);
    expect(await db.select().from(registrationNotes)).toHaveLength(1);
  });

  it("answers NOT_FOUND for a registration that is not there, or an id that is not one", async () => {
    const organizer = await staff("MODERATOR");
    expect(await failureOf(addRegistrationNote(db, organizer, "00000000-0000-4000-8000-000000000000", WORDS, NOW))).toMatchObject({ code: "NOT_FOUND" });
    expect(await failureOf(addRegistrationNote(db, organizer, "not-a-uuid", WORDS, NOW))).toMatchObject({ code: "NOT_FOUND" });
    expect(await listRegistrationNotes(db, organizer, "not-a-uuid")).toEqual([]);
  });

  it("counts live notes per registration in one query, and leaves a registration with none out", async () => {
    const race = await createRace();
    const withTwo = await register(race);
    const withOne = await register(race);
    const without = await register(race);
    const organizer = await staff("MODERATOR");
    await addRegistrationNote(db, organizer, withTwo.id, "a", NOW);
    const { id: second } = await addRegistrationNote(db, organizer, withTwo.id, "b", NOW);
    await addRegistrationNote(db, organizer, withOne.id, "c", NOW);
    await addRegistrationNote(db, organizer, withOne.id, "d", NOW).then(({ id }) => deleteRegistrationNote(db, organizer, id, minutes(1)));
    expect(await countRegistrationNotes(db, organizer, [withTwo.id, withOne.id, without.id])).toEqual(
      new Map([
        [withTwo.id, 2],
        [withOne.id, 1],
      ]),
    );
    await deleteRegistrationNote(db, organizer, second, minutes(2));
    expect((await countRegistrationNotes(db, organizer, [withTwo.id])).get(withTwo.id)).toBe(1);
    expect(await countRegistrationNotes(db, organizer, [])).toEqual(new Map());
  });
});

describe("authorization on the server (BR-REQ-060-01)", () => {
  const MAY: readonly StaffRole[] = ["MODERATOR", "ADMIN", "SUPERADMIN"];

  it("lets exactly the Organizer, the Administrator and the Superadministrator read, count and write notes", async () => {
    expect(STAFF_ROLES.filter((role) => canKeepRegistrationNotes(role))).toEqual(MAY);
    const race = await createRace();
    const { id } = await register(race);
    const organizer = await staff("MODERATOR");
    await addRegistrationNote(db, organizer, id, WORDS, NOW);

    for (const role of STAFF_ROLES) {
      const actor = await staff(role, `Tester ${role}`);
      if (MAY.includes(role)) {
        // Each earlier writer's note is there too, so the list holds the Organizer's first and every one since.
        const seen = await listRegistrationNotes(db, actor, id);
        expect(seen.map((note) => note.body), role).toContain(WORDS);
        expect((await countRegistrationNotes(db, actor, [id])).get(id), role).toBe(seen.length);
        await expect(addRegistrationNote(db, actor, id, `de la ${role}`, NOW), role).resolves.toHaveProperty("id");
      } else {
        // Refused, never an empty list that looks like «no notes».
        expect(await failureOf(listRegistrationNotes(db, actor, id)), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(countRegistrationNotes(db, actor, [id])), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(addRegistrationNote(db, actor, id, "intrus", NOW)), role).toMatchObject({ code: "FORBIDDEN" });
      }
    }
    // Three more from the roles that may, none from the others.
    expect(await db.select().from(registrationNotes)).toHaveLength(1 + MAY.length);
  });

  it("lets a note be deleted by its author or an Administrator, and by nobody else", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const author = await staff("MODERATOR", "Ioana Organizer");
    const colleague = await staff("MODERATOR", "Mihai Organizer");
    const admin = await staff("ADMIN", "Andrei Admin");
    const superadmin = await staff("SUPERADMIN", "Sara Superadmin");
    const tehnic = await staff("DEV", "Tudor Tehnic");
    const volunteer = await staff("CONTRIBUTOR", "Vlad Volunteer");

    const { id: noteId } = await addRegistrationNote(db, author, id, WORDS, NOW);
    for (const stranger of [colleague, tehnic, volunteer]) {
      expect(await failureOf(deleteRegistrationNote(db, stranger, noteId, minutes(1))), stranger.role).toMatchObject({ code: "FORBIDDEN" });
    }
    // Still there, words and all.
    expect(await listRegistrationNotes(db, author, id)).toHaveLength(1);

    // The Organizer sees their own note as deletable and a colleague's as not; the Administrator, both.
    const { id: colleaguesNote } = await addRegistrationNote(db, colleague, id, "a colegului", minutes(2));
    expect((await listRegistrationNotes(db, author, id)).map((note) => [note.body, note.deletable])).toEqual([
      ["a colegului", false],
      [WORDS, true],
    ]);
    expect((await listRegistrationNotes(db, admin, id)).every((note) => note.deletable)).toBe(true);

    await expect(deleteRegistrationNote(db, admin, noteId, minutes(3))).resolves.toEqual({ registrationId: id });
    await expect(deleteRegistrationNote(db, superadmin, colleaguesNote, minutes(4))).resolves.toEqual({ registrationId: id });
    expect(await listRegistrationNotes(db, admin, id)).toEqual([]);
  });

  it("empties the words on a delete, keeps the row only as the trail's anchor and says who and when — never the words", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addRegistrationNote(db, author, id, WORDS, NOW);
    await deleteRegistrationNote(db, author, noteId, minutes(7));

    const [row] = await db.select().from(registrationNotes).where(eq(registrationNotes.id, noteId));
    expect(row).toMatchObject({ body: "", deletedAt: minutes(7) });
    expect(await listRegistrationNotes(db, author, id)).toEqual([]);
    expect((await countRegistrationNotes(db, author, [id])).size).toBe(0);

    const [trail] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_deleted"));
    expect(trail).toMatchObject({ actorStaffUserId: author.id, entityType: "registration", entityId: id, metadataJson: {}, createdAt: minutes(7) });
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain("tricou");

    // A second press, or a note that never was: NOT_FOUND, nothing more recorded.
    expect(await failureOf(deleteRegistrationNote(db, author, noteId, minutes(8)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await failureOf(deleteRegistrationNote(db, author, "not-a-uuid", minutes(8)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_deleted"))).toHaveLength(1);
  });
});

describe("the erase takes the notes with it (BR-REQ-037-06)", () => {
  it("leaves no words anywhere after an Administrator erases the registration, and an audit row that names none", async () => {
    const race = await createRace();
    const { id } = await register(race);
    const organizer = await staff("MODERATOR");
    const admin = await staff("ADMIN");
    await addRegistrationNote(db, organizer, id, WORDS, NOW);
    const { id: gone } = await addRegistrationNote(db, organizer, id, "ștearsă de mult", NOW);
    await deleteRegistrationNote(db, organizer, gone, minutes(1));

    await deleteRegistrationByStaff(db, admin, id, "cerere de ștergere", minutes(2));

    expect(await db.select().from(registrations).where(eq(registrations.id, id))).toHaveLength(0);
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
    const trail = JSON.stringify(await db.select().from(auditLogs));
    expect(trail).not.toContain("tricou");
    expect(trail).not.toContain("ștearsă de mult");
    // What stays is who and when: the two added, the one deleted, the erase.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.note_added"))).toHaveLength(2);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deleted_by_staff"))).toHaveLength(1);
  });
});

describe("«Toate datele unei persoane» lists the notes (art. 15 GDPR)", () => {
  it("shows the words, when, the event and the author's ROLE — not the colleague's name — and not a deleted note", async () => {
    const race = await createRace();
    const { id, email } = await register(race);
    const other = await register(race);
    const organizer = await staff("MODERATOR", "Ioana Secretname");
    const admin = await staff("ADMIN", "Andrei Admin");
    await addRegistrationNote(db, organizer, id, WORDS, NOW);
    const { id: removed } = await addRegistrationNote(db, admin, id, "ștearsă", minutes(1));
    await deleteRegistrationNote(db, admin, removed, minutes(2));
    await addRegistrationNote(db, organizer, other.id, "a altcuiva", minutes(3));

    const data = await viewPersonData(db, admin, email, minutes(10));
    expect(data.notes).toEqual([{ registrationId: id, eventId: race, eventTitle: null, body: WORDS, createdAt: NOW, authorRole: "MODERATOR" }]);
    // The role, never the name: what the file carries of the author is that one word.
    expect(JSON.stringify(data.notes)).not.toContain("Secretname");
    expect(JSON.stringify(data.notes)).not.toContain(organizer.id);

    // The file an access request is answered with carries them too, and the trail counts them without a word.
    const exported = await exportPersonData(db, admin, email, minutes(11));
    expect(exported.notes).toHaveLength(1);
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect(row.metadataJson).toMatchObject({ notes: 1 });
    expect(JSON.stringify(row)).not.toContain("tricou");
  });

  it("stays the Administrator's: the Organizer who may keep notes still cannot open a person's whole record", async () => {
    const race = await createRace();
    const { email } = await register(race);
    const organizer = await staff("MODERATOR");
    expect(await failureOf(viewPersonData(db, organizer, email, NOW))).toMatchObject({ code: "FORBIDDEN" });
    expect(await failureOf(exportPersonData(db, organizer, email, NOW))).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("where a note never appears", () => {
  it("is on no row of the list, the desk, the public list or the CSV", async () => {
    const race = await createRace();
    const { id } = await register(race, { listOptOut: false });
    const organizer = await staff("MODERATOR");
    await addRegistrationNote(db, organizer, id, WORDS, NOW);

    const list = await listRegistrationsForAdmin(db, { eventId: race });
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("tricou");
    expect(Object.keys(list[0]).filter((key) => /note/i.test(key))).toEqual([]);

    const desk = await listDeskRegistrations(db, { eventId: race, query: "", locale: "ro" });
    expect(desk).toHaveLength(1);
    expect(JSON.stringify(desk)).not.toContain("tricou");
    expect(Object.keys(desk[0]).filter((key) => /note/i.test(key))).toEqual([]);

    const publicList = await listPublicStartList(db, race);
    expect(JSON.stringify(publicList)).not.toContain("tricou");

    // The spreadsheet has no column for it: its header names none.
    const [header] = buildRegistrationsCsv([]).split("\n");
    expect(header).not.toMatch(/note/i);
  });
});
