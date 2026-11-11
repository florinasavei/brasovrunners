import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerNotes, VOLUNTEER_NOTE_MAX } from "@/db/schema/event-volunteer-notes";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import { canManageVolunteers, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { readPublicVolunteersList } from "@/modules/volunteers/public-list";
import {
  addVolunteerNote,
  countVolunteerNotes,
  deleteVolunteerNote,
  insertVolunteerNote,
  listVolunteerNotes,
  listVolunteerNotesForExport,
  parseVolunteerNoteBody,
} from "@/modules/volunteers/volunteer-notes";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Note interne» for volunteers (amending §754's single organizers' line, after §777 and §785; BR-REQ-050-02, BR-REQ-060-01,
 * BR-REQ-070-01) — the table and the service, read from a real database (PGlite, the same migrations as Neon).
 *
 * Whoever manages the volunteers (the Organizer, the Administrator, the Superadministrator) keeps notes on one; every other role
 * is refused in EVERY function of the service, never handed an empty list. A note is deleted by its author or by an Administrator,
 * the delete empties the words, the trail names who and when with `{ volunteerId }` and never the words, and «Șterge voluntarul»,
 * the sweep and an event's delete take the notes by the cascade. The made-up people here are nobody.
 */
const NOW = new Date("2026-11-11T10:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const MAY: readonly StaffRole[] = ["MODERATOR", "ADMIN", "SUPERADMIN"];
const WORDS = "vine doar dimineața\nare mașină";

let db: TestDatabase;
let close: () => Promise<void>;

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function createRace(): Promise<string> {
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), acceptsVolunteers: true }).returning();
  return event.id;
}

let serial = 0;
/** A volunteer as the public form writes one (an address and a telephone number), or one the club typed with none. */
async function volunteer(eventId: string, over: Partial<typeof eventVolunteers.$inferInsert> = {}): Promise<{ id: string; email: string }> {
  serial += 1;
  const email = `voluntar${serial}@example.org`;
  const [row] = await db
    .insert(eventVolunteers)
    .values({ eventId, name: `Voluntar ${serial}`, email, canonicalEmail: email, canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC", createdAt: NOW, updatedAt: NOW, ...over })
    .returning({ id: eventVolunteers.id });
  return { id: row.id, email };
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

/** How many queries the operation sends to the notes' table: a grouped read is one, whatever the number of volunteers. */
async function notesReadsOf(operation: () => Promise<unknown>): Promise<number> {
  let reads = 0;
  const real = db.select.bind(db);
  const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
    const query = (real as (...a: unknown[]) => { from: (table: unknown) => unknown })(...args);
    const from = query.from.bind(query);
    query.from = ((table: unknown) => {
      if (table === eventVolunteerNotes) reads += 1;
      return from(table);
    }) as never;
    return query as never;
  }) as never);
  try {
    await operation();
  } finally {
    spy.mockRestore();
  }
  return reads;
}

describe("the table and its cascade (migration 0196)", () => {
  it("keeps a note until its volunteer goes, and then keeps nothing — a deleted one too", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    const organizer = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, organizer, id, WORDS, NOW);
    await addVolunteerNote(db, organizer, id, "a doua", minutes(1));
    await deleteVolunteerNote(db, organizer, noteId, minutes(2));
    expect(await db.select().from(eventVolunteerNotes)).toHaveLength(2);

    // «Șterge voluntarul» and the thirty-day sweep delete the row: the notes go with it, by the table alone.
    await db.delete(eventVolunteers).where(eq(eventVolunteers.id, id));
    expect(await db.select().from(eventVolunteerNotes)).toHaveLength(0);
  });

  it("goes with the event's hard delete too, through the volunteer", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    await addVolunteerNote(db, await staff("ADMIN"), id, WORDS, NOW);
    await db.delete(events).where(eq(events.id, race));
    expect(await db.select().from(eventVolunteerNotes)).toHaveLength(0);
  });

  it("refuses a body past the limit in the table itself, not only in the service — the registrations' own limit", async () => {
    expect(VOLUNTEER_NOTE_MAX).toBe(2000);
    const race = await createRace();
    const { id } = await volunteer(race);
    await db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "x".repeat(VOLUNTEER_NOTE_MAX) });
    await expectViolation(db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "x".repeat(VOLUNTEER_NOTE_MAX + 1) }), {
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: "event_volunteer_notes_body_length",
    });
  });

  it("keeps the note when its author's account is removed, with nobody named for it", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    const author = await staff("MODERATOR", "Coleg Plecat");
    await addVolunteerNote(db, author, id, WORDS, NOW);
    await db.delete(staffUsers).where(eq(staffUsers.id, author.id));
    const [row] = await listVolunteerNotes(db, await staff("ADMIN"), id);
    expect(row).toMatchObject({ body: WORDS, authorName: null, deletable: true });
  });
});

describe("add, list, count and the words", () => {
  it("lists a volunteer's notes newest first with the author's display name, and records who and when — `{ volunteerId }`, never the words", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    const organizer = await staff("MODERATOR", "Ioana Organizatoare");
    const admin = await staff("ADMIN", "Andrei Administrator");
    await addVolunteerNote(db, organizer, id, "prima", NOW);
    await addVolunteerNote(db, admin, id, "a doua", minutes(5));

    expect((await listVolunteerNotes(db, admin, id)).map((note) => [note.body, note.authorName])).toEqual([
      ["a doua", "Andrei Administrator"],
      ["prima", "Ioana Organizatoare"],
    ]);
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_added"));
    expect(trail).toHaveLength(2);
    for (const row of trail) {
      // As every `volunteer.*` row: entity `event`, the event's id, the volunteer's id and nothing else.
      expect(row).toMatchObject({ entityType: "event", entityId: race, metadataJson: { volunteerId: id } });
      expect(Object.keys(row.metadataJson as object)).toEqual(["volunteerId"]);
      expect(JSON.stringify(row)).not.toMatch(/prima|a doua/);
    }
    expect(trail.map((row) => row.actorStaffUserId).sort()).toEqual([organizer.id, admin.id].sort());
  });

  it("keeps the line breaks, trims the ends and counts characters, refusing an empty or too long note on the box", async () => {
    expect(parseVolunteerNoteBody("  una\r\ndoua\rtrei  ")).toBe("una\ndoua\ntrei");
    expect(parseVolunteerNoteBody("😀".repeat(VOLUNTEER_NOTE_MAX))).toHaveLength(VOLUNTEER_NOTE_MAX * 2);
    const race = await createRace();
    const { id } = await volunteer(race);
    const organizer = await staff("MODERATOR");
    for (const empty of ["", "   \n ", undefined, 42]) {
      expect(await failureOf(addVolunteerNote(db, organizer, id, empty, NOW))).toMatchObject({ code: "NOTE_EMPTY", fields: ["body"] });
    }
    expect(await failureOf(addVolunteerNote(db, organizer, id, "x".repeat(VOLUNTEER_NOTE_MAX + 1), NOW))).toMatchObject({ code: "NOTE_TOO_LONG", fields: ["body"] });
    expect(await db.select().from(eventVolunteerNotes)).toHaveLength(0);
    expect(await failureOf(addVolunteerNote(db, organizer, "00000000-0000-4000-8000-000000000000", WORDS, NOW))).toMatchObject({ code: "NOT_FOUND" });
    expect(await failureOf(addVolunteerNote(db, organizer, "not-a-uuid", WORDS, NOW))).toMatchObject({ code: "NOT_FOUND" });
    expect(await listVolunteerNotes(db, organizer, "not-a-uuid")).toEqual([]);
  });

  it("counts the live notes of a page's volunteers in ONE grouped query, leaving one with none out", async () => {
    const race = await createRace();
    const people = await Promise.all([volunteer(race), volunteer(race), volunteer(race), volunteer(race), volunteer(race)]);
    const organizer = await staff("MODERATOR");
    await addVolunteerNote(db, organizer, people[0].id, "a", NOW);
    await addVolunteerNote(db, organizer, people[0].id, "b", NOW);
    await addVolunteerNote(db, organizer, people[1].id, "c", NOW);
    const { id: gone } = await addVolunteerNote(db, organizer, people[2].id, "d", NOW);
    await deleteVolunteerNote(db, organizer, gone, minutes(1));
    const ids = people.map((person) => person.id);
    expect(await countVolunteerNotes(db, organizer, ids)).toEqual(
      new Map([
        [people[0].id, 2],
        [people[1].id, 1],
      ]),
    );
    expect(await notesReadsOf(() => countVolunteerNotes(db, organizer, ids))).toBe(1);
    expect(await countVolunteerNotes(db, organizer, [])).toEqual(new Map());
  });

  it("reads the notes of every exported volunteer in ONE grouped query, newest first, the author's ROLE and never the name", async () => {
    const race = await createRace();
    const [ana, dan, ion] = await Promise.all([volunteer(race), volunteer(race), volunteer(race)]);
    const organizer = await staff("MODERATOR", "Nume Secret");
    const admin = await staff("ADMIN");
    await addVolunteerNote(db, organizer, ana.id, "prima", NOW);
    await addVolunteerNote(db, admin, ana.id, "a doua", minutes(1));
    const { id: gone } = await addVolunteerNote(db, admin, dan.id, "ștearsă", minutes(2));
    await deleteVolunteerNote(db, admin, gone, minutes(3));
    const ids = [ana.id, dan.id, ion.id];
    const notes = await listVolunteerNotesForExport(db, organizer, ids);
    expect(notes).toEqual(
      new Map([
        [
          ana.id,
          [
            { createdAt: minutes(1), authorRole: "ADMIN", body: "a doua" },
            { createdAt: NOW, authorRole: "MODERATOR", body: "prima" },
          ],
        ],
      ]),
    );
    expect(JSON.stringify([...notes])).not.toContain("Secret");
    expect(await notesReadsOf(() => listVolunteerNotesForExport(db, organizer, ids))).toBe(1);
  });
});

describe("authorization on the server, in every function (BR-REQ-060-01)", () => {
  it("lets exactly the three roles that manage volunteers read, count, export, add and delete — and refuses the four others everywhere", async () => {
    expect(STAFF_ROLES.filter((role) => canManageVolunteers(role))).toEqual(MAY);
    const race = await createRace();
    const { id } = await volunteer(race);
    const organizer = await staff("MODERATOR");
    const { id: seeded } = await addVolunteerNote(db, organizer, id, WORDS, NOW);

    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (MAY.includes(role)) {
        const seen = await listVolunteerNotes(db, actor, id);
        expect(seen.map((note) => note.body), role).toContain(WORDS);
        expect((await countVolunteerNotes(db, actor, [id])).get(id), role).toBe(seen.length);
        expect((await listVolunteerNotesForExport(db, actor, [id])).get(id), role).toHaveLength(seen.length);
        const { id: own } = await addVolunteerNote(db, actor, id, `de la ${role}`, NOW);
        await expect(deleteVolunteerNote(db, actor, own, minutes(1)), role).resolves.toEqual({ volunteerId: id });
        await db.transaction(async (tx) => {
          await expect(insertVolunteerNote(tx, actor, { id, eventId: race }, `în tranzacție, ${role}`, NOW), role).resolves.toHaveProperty("id");
        });
      } else {
        // Refused, never an empty list that looks like «no notes».
        expect(await failureOf(listVolunteerNotes(db, actor, id)), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(countVolunteerNotes(db, actor, [id])), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(listVolunteerNotesForExport(db, actor, [id])), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(addVolunteerNote(db, actor, id, "intrus", NOW)), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(deleteVolunteerNote(db, actor, seeded, NOW)), role).toMatchObject({ code: "FORBIDDEN" });
        expect(await failureOf(db.transaction((tx) => insertVolunteerNote(tx, actor, { id, eventId: race }, "intrus", NOW))), role).toMatchObject({ code: "FORBIDDEN" });
      }
    }
    // The seeded note, and one kept from each «în tranzacție» of the three roles; nothing from the others.
    const live = await listVolunteerNotes(db, organizer, id);
    expect(live.map((note) => note.body).sort()).toEqual([WORDS, ...MAY.map((role) => `în tranzacție, ${role}`)].sort());
  });

  it("lets a note be deleted by its author or an Administrator, and by nobody else — a colleague Organizer included", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    const author = await staff("MODERATOR", "Ioana Organizatoare");
    const colleague = await staff("MODERATOR", "Mihai Organizator");
    const admin = await staff("ADMIN");
    const superadmin = await staff("SUPERADMIN");
    const { id: noteId } = await addVolunteerNote(db, author, id, WORDS, NOW);
    expect(await failureOf(deleteVolunteerNote(db, colleague, noteId, minutes(1)))).toMatchObject({ code: "FORBIDDEN" });
    expect(await listVolunteerNotes(db, author, id)).toHaveLength(1);

    const { id: colleaguesNote } = await addVolunteerNote(db, colleague, id, "a colegului", minutes(2));
    expect((await listVolunteerNotes(db, author, id)).map((note) => [note.body, note.deletable])).toEqual([
      ["a colegului", false],
      [WORDS, true],
    ]);
    expect((await listVolunteerNotes(db, admin, id)).every((note) => note.deletable)).toBe(true);
    // A note nobody can be named for (a carried line with no author) is the Administrator's to delete, not an Organizer's.
    const [carried] = await db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "fără autor", createdAt: minutes(3) }).returning();
    expect((await listVolunteerNotes(db, author, id)).find((note) => note.id === carried.id)?.deletable).toBe(false);
    expect(await failureOf(deleteVolunteerNote(db, author, carried.id, minutes(4)))).toMatchObject({ code: "FORBIDDEN" });

    await expect(deleteVolunteerNote(db, admin, noteId, minutes(5))).resolves.toEqual({ volunteerId: id });
    await expect(deleteVolunteerNote(db, superadmin, colleaguesNote, minutes(6))).resolves.toEqual({ volunteerId: id });
    await expect(deleteVolunteerNote(db, admin, carried.id, minutes(7))).resolves.toEqual({ volunteerId: id });
    expect(await listVolunteerNotes(db, admin, id)).toEqual([]);
  });

  it("empties the words on a delete and says who and when — `{ volunteerId }`, never the words; a second press is NOT_FOUND", async () => {
    const race = await createRace();
    const { id } = await volunteer(race);
    const author = await staff("MODERATOR");
    const { id: noteId } = await addVolunteerNote(db, author, id, WORDS, NOW);
    await deleteVolunteerNote(db, author, noteId, minutes(7));

    const [row] = await db.select().from(eventVolunteerNotes).where(eq(eventVolunteerNotes.id, noteId));
    expect(row).toMatchObject({ body: "", deletedAt: minutes(7) });
    expect(await listVolunteerNotes(db, author, id)).toEqual([]);
    const [trail] = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_deleted"));
    expect(trail).toMatchObject({ actorStaffUserId: author.id, entityType: "event", entityId: race, metadataJson: { volunteerId: id }, createdAt: minutes(7) });
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain("dimineața");

    expect(await failureOf(deleteVolunteerNote(db, author, noteId, minutes(8)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await failureOf(deleteVolunteerNote(db, author, "not-a-uuid", minutes(8)))).toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.note_deleted"))).toHaveLength(1);
  });
});

describe("the old single line (`event_volunteers.note`) after the carry", () => {
  it("is cleared by deleting the note that carries its words, in the same press — and left alone by any other delete", async () => {
    const race = await createRace();
    const { id } = await volunteer(race, { note: "Sună după 18" });
    const admin = await staff("ADMIN");
    const [carried] = await db.insert(eventVolunteerNotes).values({ volunteerId: id, body: "Sună după 18", createdAt: NOW }).returning();
    const { id: other } = await addVolunteerNote(db, admin, id, "alta", minutes(1));
    const oldLine = async () => (await db.select({ note: eventVolunteers.note }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].note;

    await deleteVolunteerNote(db, admin, other, minutes(2));
    expect(await oldLine()).toBe("Sună după 18");
    await deleteVolunteerNote(db, admin, carried.id, minutes(3));
    // The question says the words are gone: they are, in the old column too.
    expect(await oldLine()).toBeNull();
    expect(JSON.stringify(await db.select().from(eventVolunteers))).not.toContain("Sună după 18");
  });

  it("is kept when its words differ from the deleted note's — a line typed by the previous release after the carry", async () => {
    const race = await createRace();
    const { id } = await volunteer(race, { note: "Linie nouă" });
    const admin = await staff("ADMIN");
    const { id: noteId } = await addVolunteerNote(db, admin, id, "Linie veche", NOW);
    await deleteVolunteerNote(db, admin, noteId, minutes(1));
    expect((await db.select({ note: eventVolunteers.note }).from(eventVolunteers).where(eq(eventVolunteers.id, id)))[0].note).toBe("Linie nouă");
  });
});

describe("«Toate datele unei persoane» lists a volunteer's notes (art. 15 GDPR)", () => {
  it("shows each offer's live notes — words, moment, the author's ROLE, never a name — counts them in the file's trail, and the old line only while no note carries it", async () => {
    const race = await createRace();
    const other = await createRace();
    const first = await volunteer(race, { note: "Sună după 18" });
    // The same person on another event, found by the same address: a line no note carries yet is still printed.
    const second = await volunteer(other, { email: first.email, canonicalEmail: first.email, note: "Linie rămasă" });
    const organizer = await staff("MODERATOR", "Nume Secret");
    const admin = await staff("ADMIN", "Andrei Administrator");
    await db.insert(eventVolunteerNotes).values({ volunteerId: first.id, body: "Sună după 18", createdAt: NOW });
    await addVolunteerNote(db, organizer, first.id, WORDS, minutes(1));
    const { id: gone } = await addVolunteerNote(db, admin, first.id, "ștearsă", minutes(2));
    await deleteVolunteerNote(db, admin, gone, minutes(3));

    const data = await viewPersonData(db, admin, first.email, minutes(10));
    const offers = new Map(data.volunteerOffers.map((offer) => [offer.eventId, offer]));
    expect(offers.get(race)).toMatchObject({
      note: null,
      notes: [
        { body: "Sună după 18", createdAt: NOW, authorRole: null },
        { body: WORDS, createdAt: minutes(1), authorRole: "MODERATOR" },
      ],
    });
    expect(offers.get(other)).toMatchObject({ note: "Linie rămasă", notes: [] });
    expect(JSON.stringify(data.volunteerOffers)).not.toMatch(/Secret|Andrei|ștearsă/);
    expect(second.id).not.toBe(first.id);

    const exported = await exportPersonData(db, admin, first.email, minutes(11));
    expect(exported.volunteerOffers.flatMap((offer) => offer.notes)).toHaveLength(2);
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect(row.metadataJson).toMatchObject({ volunteerOffers: 2, volunteerNotes: 2 });
    expect(JSON.stringify(row)).not.toMatch(/dimineața|Sună/);
  });
});

describe("where a volunteer's note never appears", () => {
  it("is not on the public volunteers' list", async () => {
    const race = await createRace();
    const { id } = await volunteer(race, { state: "CONFIRMED", listOptIn: true, listOptInNoticeVersion: 1, name: "Ana Pe Listă" });
    await addVolunteerNote(db, await staff("MODERATOR"), id, WORDS, NOW);
    const shown = JSON.stringify(await readPublicVolunteersList(db, race, { firstListNoticeVersion: 1 }));
    // The person is named there (so the read is not empty by accident), and the note is not.
    expect(shown).toContain("Ana Pe Listă");
    expect(shown).not.toContain("dimineața");
  });
});
