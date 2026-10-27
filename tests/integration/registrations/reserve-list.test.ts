import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventReserveEntries } from "@/db/schema/event-reserve-entries";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { REGISTRATION_NOTE_MAX, registrationNotes } from "@/db/schema/registration-notes";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { addReserveEntry, deleteReserveEntry, findReserveEntry, listReserveEntries, saveReserveNote, settleReserveEntry } from "@/modules/registrations/reserve-list";
import { canKeepRegistrationNotes, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Lista internă de așteptare» (§854; BR-REQ-037-05, BR-REQ-060-01) — the owner, 2026-10-26: people who asked
 * through the contact form, put on a waiting list by hand without being told or emailed, with internal notes,
 * and moved to the official list later. Read from a real database (PGlite, the same migrations as Neon).
 */
const NOW = new Date("2026-10-26T10:00:00.000Z");
const later = (n: number) => new Date(NOW.getTime() + n * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => resetTables(db));

async function createRace(): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 1 })
    .returning();
  return event.id;
}

async function staff(role: StaffRole): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

async function register(eventId: string, email: string): Promise<string> {
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: "Ana Pop", preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: "Ana Pop",
      displayName: resolveDisplayName({ legalName: "Ana Pop" }),
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status: "PENDING_EMAIL_CONFIRMATION",
    })
    .returning({ id: registrations.id });
  return created.id;
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

const ENTRY = { firstName: " Ana ", lastName: "Pop", email: "ana@example.org", note: "a scris pe contact pe 20 oct" };

describe("the internal waiting list", () => {
  it("keeps a person for one event in the order written down, and sends nothing and registers nobody", async () => {
    const race = await createRace();
    const organizer = await staff("MODERATOR");
    await addReserveEntry(db, organizer, race, ENTRY, NOW);
    await addReserveEntry(db, organizer, race, { firstName: "Ion", lastName: "Ionescu", email: "", note: "" }, later(1));

    const rows = await listReserveEntries(db, organizer, race);
    expect(rows.map((row) => [row.firstName, row.lastName, row.email, row.note, row.createdByName])).toEqual([
      ["Ana", "Pop", "ana@example.org", "a scris pe contact pe 20 oct", "Colleague MODERATOR"],
      ["Ion", "Ionescu", null, null, "Colleague MODERATOR"],
    ]);
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    expect(await db.select().from(registrations)).toHaveLength(0);
    expect(await db.select().from(participants)).toHaveLength(0);
  });

  it("is the Organizer's and above, and nobody else's — reading included", async () => {
    const race = await createRace();
    for (const role of STAFF_ROLES) {
      const actor = await staff(role);
      if (canKeepRegistrationNotes(role)) {
        await addReserveEntry(db, actor, race, ENTRY, NOW);
        continue;
      }
      expect((await failureOf(addReserveEntry(db, actor, race, ENTRY, NOW))).code).toBe("FORBIDDEN");
      expect((await failureOf(listReserveEntries(db, actor, race))).code).toBe("FORBIDDEN");
    }
  });

  it("refuses a missing name, a malformed address and a note past the limit, naming the box", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    expect((await failureOf(addReserveEntry(db, admin, race, { ...ENTRY, firstName: "  " }, NOW))).fields).toEqual(["firstName"]);
    expect((await failureOf(addReserveEntry(db, admin, race, { ...ENTRY, email: "nu-e-adresa" }, NOW))).fields).toEqual(["email"]);
    expect((await failureOf(addReserveEntry(db, admin, race, { ...ENTRY, note: "x".repeat(REGISTRATION_NOTE_MAX + 1) }, NOW))).fields).toEqual(["note"]);
    expect(await db.select().from(eventReserveEntries)).toHaveLength(0);
  });

  it("edits and clears the note, deletes the line, and the trail never carries a name, an address or the words", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    const { id } = await addReserveEntry(db, admin, race, ENTRY, NOW);
    expect(await saveReserveNote(db, admin, id, "a sunat din nou", later(1))).toEqual({ eventId: race, changed: true });
    expect(await saveReserveNote(db, admin, id, "a sunat din nou", later(2))).toEqual({ eventId: race, changed: false });
    await saveReserveNote(db, admin, id, "   ", later(3));
    expect((await findReserveEntry(db, admin, id))?.note).toBeNull();
    await deleteReserveEntry(db, admin, id, later(4));
    expect(await db.select().from(eventReserveEntries)).toHaveLength(0);

    const trail = await db.select().from(auditLogs);
    expect(trail.map((row) => row.action)).toEqual(["event_reserve.added", "event_reserve.note_saved", "event_reserve.note_saved", "event_reserve.deleted"]);
    const words = JSON.stringify(trail);
    for (const typed of ["Ana", "Pop", "ana@example.org", "contact", "sunat"]) expect(words).not.toContain(typed);
  });

  it("goes with its event", async () => {
    const race = await createRace();
    await addReserveEntry(db, await staff("ADMIN"), race, ENTRY, NOW);
    await db.delete(events).where(eq(events.id, race));
    expect(await db.select().from(eventReserveEntries)).toHaveLength(0);
  });

  it("moved to the official list: the note becomes the registration's internal note and the line is gone", async () => {
    const race = await createRace();
    const admin = await staff("ADMIN");
    const { id } = await addReserveEntry(db, admin, race, ENTRY, NOW);
    const registrationId = await register(race, "ana@example.org");

    await settleReserveEntry(db, admin, id, registrationId, later(1));

    expect(await db.select().from(eventReserveEntries)).toHaveLength(0);
    const notes = await db.select().from(registrationNotes).where(eq(registrationNotes.registrationId, registrationId));
    expect(notes.map((note) => note.body)).toEqual(["a scris pe contact pe 20 oct"]);
    const [moved] = await db.select().from(auditLogs).where(eq(auditLogs.action, "event_reserve.moved"));
    expect(moved.metadataJson).toEqual({ entryId: id, registrationId });
  });

  it("never carries a note onto another event's registration", async () => {
    const race = await createRace();
    const other = await createRace();
    const admin = await staff("ADMIN");
    const { id } = await addReserveEntry(db, admin, race, ENTRY, NOW);
    const elsewhere = await register(other, "ana@example.org");

    await settleReserveEntry(db, admin, id, elsewhere, later(1));

    expect(await db.select().from(eventReserveEntries)).toHaveLength(1);
    expect(await db.select().from(registrationNotes)).toHaveLength(0);
  });
});
