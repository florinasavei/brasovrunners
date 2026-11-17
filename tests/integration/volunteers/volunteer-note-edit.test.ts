import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerNotes, VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageVolunteers, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN, BR-REQ-050-02, BR-REQ-060-01 — «Modifică» on a volunteer's internal note (the owner, 2026-11-17, on the «Voluntari» list:
 * «lasă-mă să editez și nota internă»), the service read from a real database (PGlite, the same migrations as Neon).
 *
 * `editVolunteerNote` has delete's gate: whoever manages the volunteers keeps notes, and a note is changed by its author or by an
 * Administrator — a colleague's to an Organizer is FORBIDDEN — every refusal writing nothing. The words are read as an add reads
 * them; a deleted, missing or malformed note is NOT_FOUND; the same words write and audit nothing. A change moves `body` and
 * `updated_at` only (the note keeps its moment and its author, so its place in the thread), records `volunteer.note_edited` with
 * `{ volunteerId }` and never the words, clears the old single line that held the old words, and tells nobody: no email, no
 * public cache tag. The made-up people here are nobody.
 */
vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
const { revalidatePath, revalidateTag, updateTag } = await import("next/cache");
const { addVolunteerNote, deleteVolunteerNote, editVolunteerNote, listVolunteerNotes, listVolunteerNotesForList } = await import("@/modules/volunteers/volunteer-notes");
const { changeVolunteer } = await import("@/modules/volunteers/volunteers");

const NOW = new Date("2026-11-17T08:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const MAY: readonly StaffRole[] = ["MODERATOR", "ADMIN", "SUPERADMIN"];

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  // The cache helper expires nothing outside a Next server: told it is in one, «nothing expired» proves something.
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  for (const spy of [revalidateTag, revalidatePath, updateTag]) vi.mocked(spy).mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function createRace(): Promise<string> {
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), acceptsVolunteers: true }).returning();
  return event.id;
}

let serial = 0;
async function volunteer(eventId: string, over: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<string> {
  serial += 1;
  const email = `voluntar${serial}@example.org`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name: `Voluntar ${serial}`, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC", createdAt: NOW, updatedAt: NOW, ...over })
    .returning({ id: eventVolunteers.id });
  return row.id;
}

async function staff(role: StaffRole, name = `Coleg ${role} ${++serial}`): Promise<StaffUser> {
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

const noteRow = async (id: string) => (await db.select().from(eventVolunteerNotes).where(eq(eventVolunteerNotes.id, id)))[0];
const edits = async () => db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_edited"));

describe("«Modifică» — who may change a note (BR-REQ-060-01)", () => {
  it("lets the author Organizer change their own note, the Administrator and the Superadministrator anybody's, and refuses a colleague Organizer — writing nothing", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR", "Ioana Organizatoare");
    const colleague = await staff("MODERATOR", "Mihai Organizator");
    const admin = await staff("ADMIN");
    const superadmin = await staff("SUPERADMIN");
    const { id: noteId } = await addVolunteerNote(db, author, id, "sotia lui Stefan", NOW);

    // A colleague's note to an Organizer: FORBIDDEN, as «Șterge» — the words, the moment and the trail as they were.
    expect(await failureOf(editVolunteerNote(db, colleague, noteId, "altceva", minutes(1)))).toMatchObject({ code: "FORBIDDEN" });
    expect(await noteRow(noteId)).toMatchObject({ body: "sotia lui Stefan", updatedAt: NOW });
    expect(await edits()).toEqual([]);

    await expect(editVolunteerNote(db, author, noteId, "soția lui Ștefan", minutes(2))).resolves.toEqual({ volunteerId: id, changed: true });
    await expect(editVolunteerNote(db, admin, noteId, "soția lui Ștefan, vine la 7", minutes(3))).resolves.toEqual({ volunteerId: id, changed: true });
    await expect(editVolunteerNote(db, superadmin, noteId, "soția lui Ștefan, vine la 7:30", minutes(4))).resolves.toEqual({ volunteerId: id, changed: true });
    expect(await noteRow(noteId)).toMatchObject({ body: "soția lui Ștefan, vine la 7:30", authorStaffUserId: author.id, createdAt: NOW, updatedAt: minutes(4) });
    expect((await edits()).map((row) => row.actorStaffUserId)).toEqual([author.id, admin.id, superadmin.id]);
  });

  it("leaves a note nobody can be named for (a carried line, an author's account gone) to the Administrator, not to an Organizer", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const organizer = await staff("MODERATOR");
    const admin = await staff("ADMIN");
    const [carried] = await db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "fără autor", createdAt: NOW, updatedAt: NOW }).returning();
    expect(await failureOf(editVolunteerNote(db, organizer, carried.id, "a mea acum", minutes(1)))).toMatchObject({ code: "FORBIDDEN" });
    await expect(editVolunteerNote(db, admin, carried.id, "corectată", minutes(2))).resolves.toEqual({ volunteerId: id, changed: true });
    expect(await noteRow(carried.id)).toMatchObject({ body: "corectată", authorStaffUserId: null });
  });

  it("refuses every role that may not manage volunteers — Tehnic, the Redactor, the desk Volunteer, a member — FORBIDDEN before anything is read, nothing written", async () => {
    expect(STAFF_ROLES.filter((role) => canManageVolunteers(role))).toEqual(MAY);
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, author, id, "vine doar dimineața", NOW);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      const actor = await staff(role);
      expect(await failureOf(editVolunteerNote(db, actor, noteId, `de la ${role}`, minutes(1))), role).toMatchObject({ code: "FORBIDDEN" });
      // Refused before the words are read: an empty box, a missing note — the same answer.
      expect(await failureOf(editVolunteerNote(db, actor, noteId, "", minutes(1))), role).toMatchObject({ code: "FORBIDDEN" });
      expect(await failureOf(editVolunteerNote(db, actor, "not-a-uuid", "x", minutes(1))), role).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await noteRow(noteId)).toMatchObject({ body: "vine doar dimineața", updatedAt: NOW });
    expect(await edits()).toEqual([]);
  });

  it("says on every note of the person's page and of the list whether the reader may change it — the delete's own answer", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const colleague = await staff("MODERATOR");
    const admin = await staff("ADMIN");
    await addVolunteerNote(db, author, id, "a autorului", NOW);
    await addVolunteerNote(db, colleague, id, "a colegului", minutes(1));
    for (const reader of [author, colleague, admin]) {
      const page = await listVolunteerNotes(db, reader, id);
      expect(page.map((note) => note.editable), reader.displayName).toEqual(page.map((note) => note.deletable));
      const list = (await listVolunteerNotesForList(db, reader, [id])).get(id)!;
      expect(list.map((note) => [note.id, note.editable])).toEqual(page.map((note) => [note.id, note.editable]));
    }
    expect((await listVolunteerNotes(db, author, id)).map((note) => [note.body, note.editable])).toEqual([
      ["a colegului", false],
      ["a autorului", true],
    ]);
    expect((await listVolunteerNotes(db, admin, id)).every((note) => note.editable)).toBe(true);
  });
});

describe("«Modifică» — the words", () => {
  it("reads them as an add does — line breaks kept, the ends trimmed — and refuses an empty or too long box naming it, writing nothing", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, author, id, "Fotograf", NOW);
    for (const empty of ["", "   \n ", undefined, 42]) {
      expect(await failureOf(editVolunteerNote(db, author, noteId, empty, minutes(1)))).toMatchObject({ code: "NOTE_EMPTY", fields: ["body"] });
    }
    expect(await failureOf(editVolunteerNote(db, author, noteId, "x".repeat(VOLUNTEER_NOTE_MAX + 1), minutes(1)))).toMatchObject({ code: "NOTE_TOO_LONG", fields: ["body"] });
    expect(await noteRow(noteId)).toMatchObject({ body: "Fotograf", updatedAt: NOW });
    expect(await edits()).toEqual([]);

    // The limit itself is kept, counted in characters as the table counts them.
    await expect(editVolunteerNote(db, author, noteId, "😀".repeat(VOLUNTEER_NOTE_MAX), minutes(2))).resolves.toMatchObject({ changed: true });
    await expect(editVolunteerNote(db, author, noteId, "  Fotograf,\r\nvine cu aparatul lui  ", minutes(3))).resolves.toMatchObject({ changed: true });
    expect((await noteRow(noteId)).body).toBe("Fotograf,\nvine cu aparatul lui");
  });

  it("answers a deleted note, one that is not there and a malformed id as NOT_FOUND, writing nothing", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const admin = await staff("ADMIN");
    const { id: noteId } = await addVolunteerNote(db, admin, id, "ștearsă curând", NOW);
    await deleteVolunteerNote(db, admin, noteId, minutes(1));
    expect(await failureOf(editVolunteerNote(db, admin, noteId, "înviată", minutes(2)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await noteRow(noteId)).toMatchObject({ body: "", deletedAt: minutes(1) });
    expect(await failureOf(editVolunteerNote(db, admin, "00000000-0000-4000-8000-000000000000", "x", minutes(2)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await failureOf(editVolunteerNote(db, admin, "not-a-uuid", "x", minutes(2)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await edits()).toEqual([]);
  });

  it("writes and audits nothing for the same words — after the reading, so spaces around them change nothing either", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, author, id, "vine cu soția", NOW);
    await expect(editVolunteerNote(db, author, noteId, "vine cu soția", minutes(1))).resolves.toEqual({ volunteerId: id, changed: false });
    await expect(editVolunteerNote(db, author, noteId, "  vine cu soția \r\n", minutes(2))).resolves.toEqual({ volunteerId: id, changed: false });
    expect(await noteRow(noteId)).toMatchObject({ body: "vine cu soția", updatedAt: NOW });
    expect(await edits()).toEqual([]);
  });
});

describe("«Modifică» — what a change writes", () => {
  it("changes the words and `updated_at` alone: the moment and the author stay, so the note keeps its place in the thread", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR", "Ioana Organizatoare");
    const admin = await staff("ADMIN", "Andrei Administrator");
    const { id: first } = await addVolunteerNote(db, author, id, "prima", NOW);
    await addVolunteerNote(db, author, id, "a doua", minutes(1));
    await addVolunteerNote(db, author, id, "a treia", minutes(2));

    // The Administrator changes the oldest: it is still the oldest, still Ioana's.
    await editVolunteerNote(db, admin, first, "prima, corectată", minutes(10));
    expect(await noteRow(first)).toMatchObject({ body: "prima, corectată", authorStaffUserId: author.id, createdAt: NOW, updatedAt: minutes(10), deletedAt: null });
    expect((await listVolunteerNotes(db, admin, id)).map((note) => [note.body, note.authorName, note.createdAt])).toEqual([
      ["a treia", "Ioana Organizatoare", minutes(2)],
      ["a doua", "Ioana Organizatoare", minutes(1)],
      ["prima, corectată", "Ioana Organizatoare", NOW],
    ]);
    // Nothing of the person moved.
    expect((await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0]).toMatchObject({ updatedAt: NOW, state: "REGISTERED" });
  });

  it("records who and when as `volunteer.note_edited` — entity `event`, the event's id, `{ volunteerId }` and nothing else: never the words, before or after", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, author, id, "Fotograf amator", NOW);
    await editVolunteerNote(db, author, noteId, "Fotograf profesionist", minutes(5));

    const [row, ...more] = await edits();
    expect(more).toEqual([]);
    expect(row).toMatchObject({ actorStaffUserId: author.id, entityType: "event", entityId: race, metadataJson: { volunteerId: id }, createdAt: minutes(5) });
    expect(Object.keys(row.metadataJson as object)).toEqual(["volunteerId"]);
    const trail = JSON.stringify(await db.select().from(auditLogs));
    expect(trail).not.toContain("amator");
    expect(trail).not.toContain("profesionist");
  });

  it("clears the old single line when it held the note's old words, in the same press — and leaves a line with other words alone", async () => {
    const race = await createRace();
    const carriedPerson = await volunteer(race, { note: "Sună după 18" });
    const otherPerson = await volunteer(race, { note: "Linie nouă" });
    const admin = await staff("ADMIN");
    const [carried] = await db.insert(eventVolunteerNotes).values({ volunteerId: carriedPerson, body: "Sună după 18", createdAt: NOW, updatedAt: NOW }).returning();
    const { id: other } = await addVolunteerNote(db, admin, otherPerson, "Linie veche", NOW);
    const oldLine = async (id: string) => (await db.select({ note: eventVolunteers.note }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].note;

    await editVolunteerNote(db, admin, carried.id, "Sună după 19", minutes(1));
    expect(await oldLine(carriedPerson)).toBeNull();
    expect(JSON.stringify(await db.select().from(eventVolunteers))).not.toContain("Sună după 18");

    await editVolunteerNote(db, admin, other, "Linie corectată", minutes(1));
    expect(await oldLine(otherPerson)).toBe("Linie nouă");
  });

  it("queues no email and expires no public cache tag — while a press a public page does read expires «places»", async () => {
    const race = await createRace();
    const id = await volunteer(race);
    const author = await staff("MODERATOR");
    const admin = await staff("ADMIN");
    const { id: noteId } = await addVolunteerNote(db, author, id, "vine doar dimineața", NOW);
    vi.mocked(revalidateTag).mockClear();

    await editVolunteerNote(db, author, noteId, "vine doar după-amiaza", minutes(1));
    await editVolunteerNote(db, admin, noteId, "vine toată ziua", minutes(2));
    await editVolunteerNote(db, admin, noteId, "vine toată ziua", minutes(3));
    expect(await db.select().from(emailOutbox)).toEqual([]);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(updateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();

    // The cache is listening: «Confirmă» changes what the volunteers' page counts, and says so.
    await changeVolunteer(db, admin, { kind: "setState", eventId: race, id, state: "CONFIRMED" }, minutes(4), { sendEmail: false });
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([["public:places", { expire: 0 }]]);
  });
});
