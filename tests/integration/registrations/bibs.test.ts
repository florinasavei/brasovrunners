import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { assignBibNumbers, listBibs } from "@/modules/registrations/bibs";
import { isDomainError } from "@/shared/errors/domain-error";
import { expectViolation, SQLSTATE } from "../../helpers/constraints";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01 — race numbers.
 *
 * What is protected: the order (first confirmed, lowest number), that a number once given never
 * moves, that a later batch continues after the first, that test and unconfirmed registrations
 * are never numbered, that a cancelled registration keeps its number off the sheet without
 * freeing it, and that the database refuses two runners with one number at one event.
 */
describe("BR-REQ-038-01 race numbers", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let moderator: StaffUser;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [moderator] = await db.insert(staffUsers).values({ email: "mod@dev.test", displayName: "Mod", role: "MODERATOR" }).returning();
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-11T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    eventId = event.id;
    counter = 0;
  });

  // Per test, so each registration's default confirmedAt is distinct and increasing: the order
  // being tested is the confirmation order, not the id tie-break.
  let counter = 0;
  async function register(name: string, options: { status?: RegistrationStatus; kind?: RegistrationKind; confirmedAt?: Date } = {}) {
    counter += 1;
    const email = `${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name })
      .returning();
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status: options.status ?? "CONFIRMED",
        kind: options.kind ?? "REAL",
        locale: "ro",
        registeredName: name,
        displayName: name,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: new Date("2026-09-01T00:00:00Z"),
        confirmedAt: options.confirmedAt ?? new Date(Date.UTC(2026, 8, 1, 10, counter)),
      })
      .returning();
    return row;
  }

  const numbered = () =>
    db.select({ name: registrations.registeredName, bib: registrations.bibNumber }).from(registrations).orderBy(asc(registrations.bibNumber), asc(registrations.registeredName));

  it("numbers confirmed registrations in order of confirmation, and only those", async () => {
    await register("Cel de-al treilea", { confirmedAt: new Date("2026-09-03T10:00:00Z") });
    await register("Prima", { confirmedAt: new Date("2026-09-01T10:00:00Z") });
    await register("A doua", { confirmedAt: new Date("2026-09-02T10:00:00Z") });
    await register("În așteptare", { status: "WAITLISTED" });
    await register("De probă", { kind: "TEST" });

    const result = await assignBibNumbers(db, { actor: admin, eventId });
    expect(result).toEqual({ assigned: 3, total: 3 });

    const rows = await numbered();
    expect(rows.filter((row) => row.bib !== null).map((row) => `${row.bib} ${row.name}`)).toEqual([
      "1 Prima",
      "2 A doua",
      "3 Cel de-al treilea",
    ]);
    expect(rows.find((row) => row.name === "În așteptare")?.bib).toBeNull();
    expect(rows.find((row) => row.name === "De probă")?.bib).toBeNull();

    // Once, as a batch, about the event — never about a participant.
    const trail = await db.select().from(auditLogs);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("registration.bibs_assigned");
    expect(trail[0].participantId).toBeNull();
    expect(trail[0].metadataJson).toEqual({ assigned: 3, from: 1, to: 3 });
  });

  it("never renumbers, and a later batch continues after the first", async () => {
    await register("Prima");
    await register("A doua");
    await assignBibNumbers(db, { actor: admin, eventId });

    // A late confirmation, then somebody confirmed *earlier* than the first batch: neither
    // disturbs the numbers already printed. Order among the new ones is still by confirmation.
    await register("Târzie", { confirmedAt: new Date("2026-09-20T10:00:00Z") });
    await register("Timpurie dar întârziată", { confirmedAt: new Date("2026-08-01T10:00:00Z") });
    const second = await assignBibNumbers(db, { actor: admin, eventId });
    expect(second).toEqual({ assigned: 2, total: 4 });

    const rows = await numbered();
    expect(rows.map((row) => `${row.bib} ${row.name}`)).toEqual([
      "1 Prima",
      "2 A doua",
      "3 Timpurie dar întârziată",
      "4 Târzie",
    ]);

    // Nothing to do is not an error, and writes no audit row.
    expect(await assignBibNumbers(db, { actor: admin, eventId })).toEqual({ assigned: 0, total: 4 });
    expect(await db.select().from(auditLogs)).toHaveLength(2);
  });

  it("keeps a cancelled registration's number off the sheet without freeing it", async () => {
    const cancelled = await register("Renunță");
    await register("Rămâne");
    await assignBibNumbers(db, { actor: admin, eventId });
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, cancelled.id));

    expect((await listBibs(db, eventId)).map((row) => `${row.bibNumber} ${row.registeredName}`)).toEqual(["2 Rămâne"]);
    // The number stays with the row: nobody else can be given 1.
    await register("Nou");
    await assignBibNumbers(db, { actor: admin, eventId });
    expect((await listBibs(db, eventId)).map((row) => row.bibNumber)).toEqual([2, 3]);
  });

  it("lists a range, for a reprint or the late batch", async () => {
    for (const name of ["a", "b", "c", "d", "e"]) await register(name);
    await assignBibNumbers(db, { actor: admin, eventId });
    expect((await listBibs(db, eventId, { from: 2, to: 4 })).map((row) => row.bibNumber)).toEqual([2, 3, 4]);
    expect((await listBibs(db, eventId, { from: 5 })).map((row) => row.bibNumber)).toEqual([5]);
  });

  it("is the Administrator's, and the database refuses a duplicate number at one event", async () => {
    await register("x");
    const refused = await assignBibNumbers(db, { actor: moderator, eventId }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");

    await assignBibNumbers(db, { actor: admin, eventId });
    const second = await register("y");
    await expectViolation(
      db.update(registrations).set({ bibNumber: 1 }).where(eq(registrations.id, second.id)),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "registrations_event_bib_number_unique" },
    );
  });
});
