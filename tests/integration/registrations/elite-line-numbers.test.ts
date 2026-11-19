import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canManageRegistrations, STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — every line of the race's elite list has a number (the owner, 2026-11-19, of «Ingrid» drawn grey on «Cronometrare»: «de ce
 * apare Ingrid separat?» — «vreau să apară la fel! și să o pot cronometra»; BR-REQ-038-01, BR-REQ-050-02, BR-REQ-060-01), on real
 * PostgreSQL (PGlite): a line added with no number typed — or moved from the internal list — draws the race's next free number
 * under the event's lock, nobody else's and never a spare, a result's or the hidden list's series; every later draw — a
 * confirmation's, «Alocă numerele», the hidden list's, a volunteer's, the print of spares, the desk's box and its suggestions —
 * steps over it; «Dă-i un număr» and «Dă număr elitelor fără număr» number exactly the lines without one, the Administrator's
 * alone and audited by id and number; and a line's «Număr» box keeps the add's checks, audits from and to, and is refused once a
 * result is stored on the line's number. The two-connection proof of the lock is `tests/concurrency/elite-line-numbers.test.ts`.
 */
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()), revalidatePublicContent: revalidate }));

const { addEliteEntry, giveEliteLineNumber, giveEliteNumbers, listEliteEntries, setEliteEntryNumber } = await import("@/modules/registrations/elite-list");
const { assignBibNumbers, bibNumberInUse, freeSpareBibNumbers, pickEliteLineNumber, pickVolunteerNumber, reserveSpareBibs, spareCardState, suggestFreeBibNumbers } = await import(
  "@/modules/registrations/bibs"
);
const { recordFinish } = await import("@/modules/results/results");

const NOW = new Date("2026-11-19T10:00:00.000Z");
const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let serial = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  revalidate.mockClear();
  admin = await staff("ADMIN");
});

async function staff(role: StaffRole): Promise<StaffUser> {
  serial += 1;
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${serial}@dev.test`, displayName: `Colleague ${role}`, role }).returning();
  return user;
}

/** A race whose numbers start at `bibStartNumber`; the hidden list's own series and the desk's spares only when given. */
async function race(over: Partial<typeof events.$inferInsert> = {}): Promise<string> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: new Date("2099-11-21T08:00:00.000Z"), registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: NOW, capacity: 50, ...over })
    .returning();
  return event.id;
}

/** A real registration of the race, in the state given, wearing `bibNumber` (and an old held number, `provisional`). */
async function runner(eventId: string, over: { bibNumber?: number | null; status?: "CONFIRMED" | "CANCELLED" | "PENDING_DECLARATION"; provisional?: number; outsideCapacity?: boolean } = {}) {
  serial += 1;
  const email = `runner-${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const status = over.status ?? "CONFIRMED";
  const [row] = await db
    .insert(registrations)
    .values({
      eventId,
      participantId: participant.id,
      kind: "REAL",
      locale: "ro",
      registeredName: `Runner ${serial}`,
      displayName: `Runner ${serial}`,
      privacyNoticeVersion: 1,
      privacyAcknowledgedAt: NOW,
      resultsNameConsent: false,
      resultsConsentVersion: 1,
      status,
      confirmedAt: status === "PENDING_DECLARATION" ? null : NOW,
      bibNumber: over.bibNumber ?? null,
      provisionalBibNumber: over.provisional ?? null,
      outsideCapacity: over.outsideCapacity ?? false,
    })
    .returning({ id: registrations.id });
  return row.id;
}

/** A line of the elite list as written before every line drew a number: production still holds some («Ingrid»). */
async function oldLine(eventId: string, name: string, bibNumber: number | null = null, minute = 0) {
  const [line] = await db.insert(eventEliteEntries).values({ eventId, name, bibNumber, createdByStaffUserId: admin.id, createdAt: later(minute) }).returning();
  return line;
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

const numbersOf = async (eventId: string) => (await listEliteEntries(db, admin, eventId)).map((line) => [line.name, line.bibNumber]);
const trailOf = async (eventId: string, action: string) =>
  (await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, eventId), eq(auditLogs.action, action)))).map((row) => [row.actorStaffUserId, row.metadataJson]);

describe("§NNN a line added with no number draws the race's next free one, nobody else's", () => {
  it("steps over every number somebody wears, wore or holds, the spares, a stored result and the hidden list's series", async () => {
    // The race counts from 1; the hidden list's own series from 40, above it; the desk's spares 10–14, 13 stepped over by a print.
    const eventId = await race({ bibStartNumber: 1, hiddenListEnabled: true, hiddenListBibStart: 40, walkInBibStart: 10, walkInBibCount: 5 });
    await runner(eventId, { bibNumber: 1 });
    await runner(eventId, { bibNumber: 2, status: "CANCELLED" });
    await runner(eventId, { provisional: 3, status: "PENDING_DECLARATION" });
    // An erased number (§311), a number replaced by hand (§548) and a deleted volunteer's (§948): retired through their trail rows.
    await db.insert(auditLogs).values([
      { actorStaffUserId: admin.id, action: "registration.deleted_by_staff", entityType: "registration", metadataJson: { eventId, bibNumber: 4 } },
      { actorStaffUserId: admin.id, action: "registration.bib_set", entityType: "registration", metadataJson: { eventId, from: 5, to: 30 } },
      { actorStaffUserId: admin.id, action: "volunteer.deleted", entityType: "event", entityId: eventId, metadataJson: { bibNumber: 8 } },
      { actorStaffUserId: admin.id, action: "registration.bib_spares_reserved", entityType: "event", entityId: eventId, metadataJson: { from: 10, to: 14, skipped: [13] } },
    ]);
    await oldLine(eventId, "Faith Kipyegon", 6, -1);
    await db.insert(eventVolunteers).values({ eventId, name: "Vlad Voluntar", source: "STAFF", state: "CONFIRMED", bibNumber: 7 });
    // A runner typed on «Clasament» under 9, whom no registration and no line holds: a line given 9 would take that row for its own.
    await db.insert(eventResults).values({ eventId, registrationId: null, bibNumber: 9, displayName: "Ion Venit", status: "DNS" });

    const { id, bibNumber } = await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW);
    // 1–9 are somebody's, 10–14 the desk's spares: 15.
    expect(bibNumber).toBe(15);
    expect(await numbersOf(eventId)).toEqual([
      ["Faith Kipyegon", 6],
      ["Ingrid Pop", 15],
    ]);
    // The trail: the add by the line's id, and the number it drew by the id and the number alone — never the name.
    expect(await trailOf(eventId, "event_elite.added")).toEqual([[admin.id, { entryId: id }]]);
    expect(await trailOf(eventId, "event_elite.number_given")).toEqual([[admin.id, { entryId: id, bibNumber: 15 }]]);
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toContain("Ingrid");
    // The next line, the next number; the run fills to 39, and never reaches the hidden list's 40.
    const filled: number[] = [];
    for (let index = 0; index < 24; index += 1) filled.push((await addEliteEntry(db, admin, eventId, { name: `Elita ${index}`, bibNumber: "" }, later(index + 1))).bibNumber);
    expect(filled[0]).toBe(16);
    expect(filled.at(-1)).toBe(39);
    expect(filled.every((number) => number < 40)).toBe(true);
    // Room no more in the race's series: refused in words on the number's box, nothing written — a typed number still goes in.
    const before = (await db.select().from(eventEliteEntries)).length;
    const refused = await failureOf(addEliteEntry(db, admin, eventId, { name: "Fără loc", bibNumber: "" }, later(30)));
    expect([refused.code, refused.fields]).toEqual(["ELITE_NO_FREE_NUMBER", ["bibNumber"]]);
    expect(await db.select().from(eventEliteEntries)).toHaveLength(before);
    expect((await addEliteEntry(db, admin, eventId, { name: "Cu număr", bibNumber: "77" }, later(31))).bibNumber).toBe(77);
  });

  it("stays in the race's own series when the hidden list's sits below it, and draws from the race's first number", async () => {
    const eventId = await race({ bibStartNumber: 100, hiddenListEnabled: true, hiddenListBibStart: 1 });
    await runner(eventId, { bibNumber: 1, outsideCapacity: true });
    expect((await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW)).bibNumber).toBe(100);
    // The switch off, the hidden list draws from the race's series like everybody: the same rule, the race's first free number.
    const plain = await race({ bibStartNumber: 1, hiddenListEnabled: false, hiddenListBibStart: 3 });
    await runner(plain, { bibNumber: 1 });
    await runner(plain, { bibNumber: 2 });
    expect((await addEliteEntry(db, admin, plain, { name: "Ingrid Pop", bibNumber: "" }, NOW)).bibNumber).toBe(3);
  });

  it("gives two adds pressed together two different numbers, each under the event's lock", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    await runner(eventId, { bibNumber: 1 });
    const [first, second] = await Promise.all([
      addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW),
      addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "" }, NOW),
    ]);
    expect([first.bibNumber, second.bibNumber].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

describe("§NNN every later draw steps over a line's number", () => {
  it("«Alocă numerele» — the race's series and the hidden list's — and a confirmation's draw never hand out a line's number", async () => {
    const eventId = await race({ bibStartNumber: 1, hiddenListEnabled: true, hiddenListBibStart: 50 });
    await runner(eventId, { bibNumber: 1 });
    // The line draws 2; a number typed for another line on the hidden list's first number, 50.
    expect((await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW)).bibNumber).toBe(2);
    await addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "50" }, NOW);
    const onRace = await runner(eventId, { bibNumber: null });
    const onHidden = await runner(eventId, { bibNumber: null, outsideCapacity: true });
    expect(await assignBibNumbers(db, { actor: admin, eventId, now: later(1) })).toMatchObject({ assigned: 2 });
    const numberOf = async (id: string) => (await db.select({ number: registrations.bibNumber }).from(registrations).where(eq(registrations.id, id)))[0].number;
    expect(await numberOf(onRace)).toBe(3);
    expect(await numberOf(onHidden)).toBe(51);
    // The draw a confirmation makes reads the same set: the line's 2 is never the next number.
    expect(await pickEliteLineNumber(db, eventId)).toBe(4);
  });

  it("the print of spares, its extension and the desk's free spares step over a line's number", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    await runner(eventId, { bibNumber: 1 });
    await runner(eventId, { bibNumber: 2 });
    expect((await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW)).bibNumber).toBe(3);
    // The first print starts after the highest number anybody has — the line's 3 included.
    expect((await spareCardState(db, eventId)).candidates.slice(0, 2)).toEqual([4, 5]);
    expect(await reserveSpareBibs(db, { actor: admin, eventId, count: 2, now: later(1) })).toMatchObject({ from: 4, to: 5 });
    // A line typed just after the band: the next print's extension steps over it, and it is never a free spare.
    await addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "7" }, later(2));
    expect(await reserveSpareBibs(db, { actor: admin, eventId, count: 2, now: later(3) })).toMatchObject({ from: 6, to: 8 });
    expect((await freeSpareBibNumbers(db, eventId)).free).toEqual([4, 5, 6, 8]);
    // A line added now draws past the band: the spares are the desk's.
    expect((await addEliteEntry(db, admin, eventId, { name: "Ana Lungu", bibNumber: "" }, later(4))).bibNumber).toBe(9);
  });

  it("a volunteer's draw, the desk's box and its suggestions treat a line's number as worn", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    expect((await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW)).bibNumber).toBe(1);
    await addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "500" }, NOW);
    expect(await pickVolunteerNumber(db, eventId, 500)).toBe(501);
    expect(await bibNumberInUse(db, { eventId, number: 1 })).toBe(true);
    expect(await suggestFreeBibNumbers(db, eventId, 1, 3)).toEqual([2, 3, 4]);
  });
});

describe("§NNN «Dă-i un număr» and «Dă număr elitelor fără număr»", () => {
  it("number exactly the lines without one, in the order typed, each the race's next free number, audited by id and number", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    await runner(eventId, { bibNumber: 1 });
    await runner(eventId, { bibNumber: 2 });
    const kept = await oldLine(eventId, "Faith Kipyegon", 5, 0);
    const ingrid = await oldLine(eventId, "Ingrid Pop", null, 1);
    const paul = await oldLine(eventId, "Paul Stan", null, 2);

    const { numbered } = await giveEliteNumbers(db, admin, eventId, later(5));
    expect(numbered).toEqual([
      { entryId: ingrid.id, bibNumber: 3, given: true },
      { entryId: paul.id, bibNumber: 4, given: true },
    ]);
    expect(await numbersOf(eventId)).toEqual([
      ["Faith Kipyegon", 5],
      ["Ingrid Pop", 3],
      ["Paul Stan", 4],
    ]);
    expect(await trailOf(eventId, "event_elite.number_given")).toEqual([
      [admin.id, { entryId: ingrid.id, bibNumber: 3 }],
      [admin.id, { entryId: paul.id, bibNumber: 4 }],
    ]);
    expect(JSON.stringify(await db.select().from(auditLogs))).not.toMatch(/Ingrid|Paul|Faith/);
    // The line that had a number is untouched; a second press finds nothing to number and writes nothing.
    expect((await db.select().from(eventEliteEntries).where(eq(eventEliteEntries.id, kept.id)))[0].bibNumber).toBe(5);
    expect(await giveEliteNumbers(db, admin, eventId, later(6))).toEqual({ numbered: [] });
    expect(await trailOf(eventId, "event_elite.number_given")).toHaveLength(2);
  });

  it("«Dă-i un număr» numbers its one line, and a second press — a colleague first — answers its number and writes nothing", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    await runner(eventId, { bibNumber: 1 });
    const ingrid = await oldLine(eventId, "Ingrid Pop");
    await oldLine(eventId, "Paul Stan", null, 1);
    expect(await giveEliteLineNumber(db, admin, ingrid.id, later(1))).toEqual({ eventId, entryId: ingrid.id, bibNumber: 2, given: true });
    expect(await giveEliteLineNumber(db, admin, ingrid.id, later(2))).toEqual({ eventId, entryId: ingrid.id, bibNumber: 2, given: false });
    // Only the line pressed: the other keeps waiting for its own press.
    expect(await numbersOf(eventId)).toEqual([
      ["Ingrid Pop", 2],
      ["Paul Stan", null],
    ]);
    expect(await trailOf(eventId, "event_elite.number_given")).toEqual([[admin.id, { entryId: ingrid.id, bibNumber: 2 }]]);
    expect((await failureOf(giveEliteLineNumber(db, admin, "00000000-0000-4000-8000-000000000000", later(3)))).code).toBe("NOT_FOUND");
    expect((await failureOf(giveEliteLineNumber(db, admin, "not-a-line", later(3)))).code).toBe("NOT_FOUND");
  });

  it("refuses every role that may not write the elite list, writing nothing", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    const ingrid = await oldLine(eventId, "Ingrid Pop");
    for (const role of STAFF_ROLES.filter((one) => !canManageRegistrations(one))) {
      const actor = await staff(role);
      expect((await failureOf(giveEliteLineNumber(db, actor, ingrid.id, NOW))).code, role).toBe("FORBIDDEN");
      expect((await failureOf(giveEliteNumbers(db, actor, eventId, NOW))).code, role).toBe("FORBIDDEN");
      expect((await failureOf(setEliteEntryNumber(db, actor, ingrid.id, "9", NOW))).code, role).toBe("FORBIDDEN");
    }
    expect(await numbersOf(eventId)).toEqual([["Ingrid Pop", null]]);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });

  it("refuses the whole press when the race's series has no free number left, writing none of it", async () => {
    const eventId = await race({ bibStartNumber: 1, hiddenListEnabled: true, hiddenListBibStart: 3 });
    await runner(eventId, { bibNumber: 1 });
    await oldLine(eventId, "Ingrid Pop", null, 0);
    await oldLine(eventId, "Paul Stan", null, 1);
    // One number left, 2, for two lines: neither is numbered.
    expect((await failureOf(giveEliteNumbers(db, admin, eventId, NOW))).code).toBe("ELITE_NO_FREE_NUMBER");
    expect(await numbersOf(eventId)).toEqual([
      ["Ingrid Pop", null],
      ["Paul Stan", null],
    ]);
    expect(await db.select().from(auditLogs)).toEqual([]);
  });
});

describe("§NNN a line's «Număr» box", () => {
  it("changes the number with the add's checks, audits from and to, and frees the old one", async () => {
    const eventId = await race({ bibStartNumber: 1, walkInBibStart: 40, walkInBibCount: 5 });
    await runner(eventId, { bibNumber: 1 });
    await runner(eventId, { bibNumber: 2, status: "CANCELLED" });
    await db.insert(auditLogs).values({ actorStaffUserId: admin.id, action: "registration.deleted_by_staff", entityType: "registration", metadataJson: { eventId, bibNumber: 3 } });
    const { id } = await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW);
    await addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "20" }, NOW);
    expect((await listEliteEntries(db, admin, eventId)).find((line) => line.id === id)?.bibNumber).toBe(4);

    expect(await setEliteEntryNumber(db, admin, id, " 25 ", later(1))).toEqual({ eventId, changed: true });
    expect(await trailOf(eventId, "event_elite.number_set")).toEqual([[admin.id, { entryId: id, from: 4, to: 25 }]]);
    expect(await bibNumberInUse(db, { eventId, number: 25 })).toBe(true);
    expect(await bibNumberInUse(db, { eventId, number: 4 })).toBe(false);
    // The same number again writes nothing.
    expect(await setEliteEntryNumber(db, admin, id, "25", later(2))).toEqual({ eventId, changed: false });
    expect(await trailOf(eventId, "event_elite.number_set")).toHaveLength(1);

    // A registration's number, a cancelled one's, a retired one, another line's and a desk spare: refused on the box, nothing written.
    for (const number of ["1", "2", "3", "20", "42"]) {
      const refusal = await failureOf(setEliteEntryNumber(db, admin, id, number, later(3)));
      expect([refusal.code, refusal.fields], number).toEqual(["CONFLICT", ["bibNumber"]]);
    }
    // Not a whole number from 1 to 99 999, or nothing: refused, naming the box — a line keeps a number.
    for (const typed of ["", "  ", "0", "100000", "abc", "1.5"]) {
      const refusal = await failureOf(setEliteEntryNumber(db, admin, id, typed, later(4)));
      expect([refusal.code, refusal.fields], typed).toEqual(["VALIDATION_ERROR", ["bibNumber"]]);
    }
    expect((await listEliteEntries(db, admin, eventId)).find((line) => line.id === id)?.bibNumber).toBe(25);
    expect(await trailOf(eventId, "event_elite.number_set")).toHaveLength(1);
  });

  it("gives a line without a number its first one, `from` null", async () => {
    const eventId = await race({ bibStartNumber: 1 });
    const ingrid = await oldLine(eventId, "Ingrid Pop");
    expect(await setEliteEntryNumber(db, admin, ingrid.id, "12", NOW)).toEqual({ eventId, changed: true });
    expect(await trailOf(eventId, "event_elite.number_set")).toEqual([[admin.id, { entryId: ingrid.id, from: null, to: 12 }]]);
  });

  it("is refused once a result is stored on the line's number — a finish at the line or a decision of «Clasament»", async () => {
    const eventId = await race({ bibStartNumber: 1, startsAt: new Date("2026-11-21T07:00:00.000Z") });
    const { id, bibNumber } = await addEliteEntry(db, admin, eventId, { name: "Ingrid Pop", bibNumber: "" }, NOW);
    const volunteer = await staff("CONTRIBUTOR");
    // Timed at the line, by the number it drew: the line's own typed row.
    expect(await recordFinish(db, volunteer, { eventId, bibNumber }, new Date("2026-11-21T07:40:00.000Z"))).toMatchObject({ kind: "recorded", bibNumber, name: "Ingrid Pop" });
    const refusal = await failureOf(setEliteEntryNumber(db, admin, id, "30", new Date("2026-11-21T07:41:00.000Z")));
    expect([refusal.code, refusal.fields]).toEqual(["ELITE_NUMBER_HAS_RESULT", ["bibNumber"]]);
    expect((await listEliteEntries(db, admin, eventId))[0].bibNumber).toBe(bibNumber);
    expect(await trailOf(eventId, "event_elite.number_set")).toEqual([]);

    // A decision typed on «Clasament» — «Neprezentat», no time — holds the number too.
    const other = await addEliteEntry(db, admin, eventId, { name: "Paul Stan", bibNumber: "" }, NOW);
    await db.insert(eventResults).values({ eventId, registrationId: null, bibNumber: other.bibNumber, displayName: "Paul Stan", status: "DNS" });
    expect((await failureOf(setEliteEntryNumber(db, admin, other.id, "31", NOW))).code).toBe("ELITE_NUMBER_HAS_RESULT");
  });
});
