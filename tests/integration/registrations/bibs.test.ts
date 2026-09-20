import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { assignBibNumbers, BIB_RANGE, findEventForBibs, listBibs, pickBibNumber } from "@/modules/registrations/bibs";
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

  it("numbers confirmed registrations at random, and only those", async () => {
    await register("Cel de-al treilea", { confirmedAt: new Date("2026-09-03T10:00:00Z") });
    await register("Prima", { confirmedAt: new Date("2026-09-01T10:00:00Z") });
    await register("A doua", { confirmedAt: new Date("2026-09-02T10:00:00Z") });
    await register("În așteptare", { status: "WAITLISTED" });
    await register("De probă", { kind: "TEST" });

    const result = await assignBibNumbers(db, { actor: admin, eventId });
    expect(result).toEqual({ assigned: 3, total: 3 });

    const rows = await numbered();
    const given = rows.filter((row) => row.bib !== null);
    expect(given.map((row) => row.name).sort()).toEqual(["A doua", "Cel de-al treilea", "Prima"]);
    // Three distinct numbers, three digits at most (§94).
    const numbers = given.map((row) => row.bib as number);
    expect(new Set(numbers).size).toBe(3);
    for (const n of numbers) expect(n).toBeGreaterThanOrEqual(1);
    for (const n of numbers) expect(n).toBeLessThanOrEqual(BIB_RANGE.threeDigits);
    expect(rows.find((row) => row.name === "În așteptare")?.bib).toBeNull();
    expect(rows.find((row) => row.name === "De probă")?.bib).toBeNull();

    // Once, as a batch, about the event — never about a participant.
    const trail = await db.select().from(auditLogs);
    expect(trail).toHaveLength(1);
    expect(trail[0].action).toBe("registration.bibs_assigned");
    expect(trail[0].participantId).toBeNull();
    expect(trail[0].metadataJson).toEqual({ assigned: 3, numbers: [...numbers].sort((x, y) => x - y) });
  });

  it("draws a number never worn at the event, which is what confirmation uses (§87, §94)", async () => {
    await register("Ana");
    await register("Ion");
    await assignBibNumbers(db, { actor: admin, eventId });
    const worn = new Set((await listBibs(db, eventId)).map((row) => row.bibNumber));
    // A cancelled number stays taken.
    const cancelled = await register("Maria", { status: "CANCELLED" });
    await db.update(registrations).set({ bibNumber: 9 }).where(eq(registrations.id, cancelled.id));
    worn.add(9);
    for (let i = 0; i < 50; i += 1) {
      const n = await pickBibNumber(db, eventId);
      expect(worn.has(n)).toBe(false);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(BIB_RANGE.threeDigits);
    }
    // A shared `taken` set never draws the same number twice inside one batch.
    const taken = new Set<number>();
    const batch = await Promise.all([1, 2, 3, 4, 5].map(() => pickBibNumber(db, eventId, taken)));
    expect(new Set(batch).size).toBe(5);
  });

  it("never renumbers, and a later batch continues after the first", async () => {
    await register("Prima");
    await register("A doua");
    await assignBibNumbers(db, { actor: admin, eventId });

    // A late confirmation, then somebody confirmed *earlier* than the first batch: neither
    // disturbs the numbers already printed. Order among the new ones is still by confirmation.
    await register("Târzie", { confirmedAt: new Date("2026-09-20T10:00:00Z") });
    await register("Timpurie dar întârziată", { confirmedAt: new Date("2026-08-01T10:00:00Z") });
    const before = new Map((await numbered()).map((row) => [row.name, row.bib]));
    const second = await assignBibNumbers(db, { actor: admin, eventId });
    expect(second).toEqual({ assigned: 2, total: 4 });

    const rows = await numbered();
    expect(rows.find((row) => row.name === "Prima")?.bib).toBe(before.get("Prima"));
    expect(rows.find((row) => row.name === "A doua")?.bib).toBe(before.get("A doua"));
    expect(new Set(rows.map((row) => row.bib)).size).toBe(4);

    // Nothing to do is not an error, and writes no audit row.
    expect(await assignBibNumbers(db, { actor: admin, eventId })).toEqual({ assigned: 0, total: 4 });
    expect(await db.select().from(auditLogs)).toHaveLength(2);
  });

  it("keeps a cancelled registration's number off the sheet without freeing it", async () => {
    const cancelled = await register("Renunță");
    await register("Rămâne");
    await assignBibNumbers(db, { actor: admin, eventId });
    await db.update(registrations).set({ status: "CANCELLED" }).where(eq(registrations.id, cancelled.id));

    const cancelledNumber = (await db.select().from(registrations).where(eq(registrations.id, cancelled.id)))[0].bibNumber;
    expect((await listBibs(db, eventId)).map((row) => row.registeredName)).toEqual(["Rămâne"]);
    // The number stays with the row: nobody else can be given it.
    for (let i = 0; i < 20; i += 1) await register(`Nou ${i}`);
    await assignBibNumbers(db, { actor: admin, eventId });
    const sheet = await listBibs(db, eventId);
    expect(sheet).toHaveLength(21);
    expect(sheet.map((row) => row.bibNumber)).not.toContain(cancelledNumber);
  });

  it("lists a range, for a reprint or the late batch", async () => {
    for (const name of ["a", "b", "c", "d", "e"]) await register(name);
    await assignBibNumbers(db, { actor: admin, eventId });
    const all = (await listBibs(db, eventId)).map((row) => row.bibNumber);
    expect(all).toEqual([...all].sort((x, y) => x - y));
    const [lowest, second] = all;
    expect((await listBibs(db, eventId, { from: lowest, to: second })).map((row) => row.bibNumber)).toEqual([lowest, second]);
    expect((await listBibs(db, eventId, { from: all[4] })).map((row) => row.bibNumber)).toEqual([all[4]]);
  });

  /**
   * §180 — what the bib carries besides the number. The renderers draw the band in the event's
   * own colour and name its partners at the foot, and both read them from here, so a lookup
   * that dropped either would print a club-blue bib for a race the club coloured green and
   * leave the partners off the one thing every runner wears.
   */
  it("hands the renderers the event's colour and its partners, in the read locale", async () => {
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "crosul-aniversar", title: "Crosul aniversar" },
      { eventId, locale: "en", slug: "anniversary-cross", title: "The anniversary cross" },
    ]);
    await db
      .update(events)
      .set({ bibColour: "#1b7f3b", coHosts: [{ name: "Primăria Brașov", url: "https://brasovcity.ro" }, { name: "Salvamont", url: null }] })
      .where(eq(events.id, eventId));

    const ro = await findEventForBibs(db, eventId, "ro");
    expect(ro?.title).toBe("Crosul aniversar");
    expect(ro?.bibColour).toBe("#1b7f3b");
    expect(ro?.coHosts.map((host) => host.name)).toEqual(["Primăria Brașov", "Salvamont"]);
    expect((await findEventForBibs(db, eventId, "en"))?.title).toBe("The anniversary cross");

    // An event that names neither: null, and no partners — the renderers' fallback, not theirs.
    await db.update(events).set({ bibColour: null, coHosts: [] }).where(eq(events.id, eventId));
    const plain = await findEventForBibs(db, eventId, "ro");
    expect(plain?.bibColour).toBeNull();
    expect(plain?.coHosts).toEqual([]);
  });

  it("is the Administrator's, and the database refuses a duplicate number at one event", async () => {
    await register("x");
    const refused = await assignBibNumbers(db, { actor: moderator, eventId }).catch((e: unknown) => e);
    expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");

    await assignBibNumbers(db, { actor: admin, eventId });
    const [{ bibNumber: worn }] = await listBibs(db, eventId);
    const second = await register("y");
    await expectViolation(
      db.update(registrations).set({ bibNumber: worn }).where(eq(registrations.id, second.id)),
      { code: SQLSTATE.UNIQUE_VIOLATION, constraint: "registrations_event_bib_number_unique" },
    );
  });
});
