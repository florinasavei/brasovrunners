import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { cancelRegistrationByStaff, deleteRegistrationByStaff, setBibNumberByStaff } from "@/modules/registrations/admin-service";
import { countBibs, listBibs, markBibsPrinted, pickBibNumber, setBibPrinted, voidBibsFor } from "@/modules/registrations/bibs";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01 criterion 16, `DECISIONS.md` §306 — a printed bib of a cancelled entry is void.
 *
 * The owner: "trebuie sa avem mare grija cu cele anulate, mai ales daca BID-ul a fost deja
 * printat!". A settled number is never reused (§173), which is right; what it leaves behind is a
 * piece of paper with a valid-looking number and nobody entitled to wear it. What is protected
 * here: `voidBibsFor` names exactly those bibs — printed, settled, real, on a registration that is
 * over — and nothing else; the sheet never prints one again, in a batch or in a range; the
 * unprinted count never quietly absorbs one; and a staff cancellation writes the fact into its
 * own audit row so the timeline can say it without a join.
 */
describe("§306 the printed bibs of cancelled registrations", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let eventId: string;
  let counter = 0;

  const NOW = new Date("2026-11-18T09:00:00Z");

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    eventId = event.id;
    counter = 0;
  });

  async function register(
    name: string,
    options: { status?: RegistrationStatus; kind?: RegistrationKind; bib?: number; printedAt?: Date; provisional?: number } = {},
  ) {
    counter += 1;
    const email = `${counter}@example.test`;
    const [participant] = await db
      .insert(participants)
      .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name })
      .returning();
    const status = options.status ?? "CONFIRMED";
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        kind: options.kind ?? "REAL",
        locale: "ro",
        registeredName: name,
        displayName: name,
        bibNumber: options.bib ?? null,
        provisionalBibNumber: options.provisional ?? null,
        bibPrintedAt: options.printedAt ?? null,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2026-09-01T00:00:00Z"),
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        submittedAt: new Date("2026-09-01T00:00:00Z"),
        confirmedAt: new Date(Date.UTC(2026, 8, 1, 10, counter)),
        // The pair each terminal status is written with (`registrations.ts`).
        ...(status === "CANCELLED" ? { cancelledAt: new Date("2026-10-12T10:00:00Z"), cancellationSource: "PARTICIPANT" as const } : {}),
        ...(status === "EXPIRED" ? { expiredAt: new Date("2026-10-13T10:00:00Z"), expiryReason: "DECLARATION_HOLD_LAPSED" as const } : {}),
      })
      .returning();
    return row;
  }

  it("lists a printed-then-cancelled bib, with its number, name, state and the day it went", async () => {
    const printed = new Date("2026-10-01T09:00:00Z");
    const gone = await register("Plecată", { bib: 27, printedAt: printed });
    await register("Rămâne", { bib: 12, printedAt: printed });

    // Cancelled the way the participant's link does it: the number and the mark stay on the row.
    await cancelRegistrationByStaff(db, admin, gone.id, "s-a răzgândit", NOW);

    const voided = await voidBibsFor(db, eventId);
    expect(voided).toHaveLength(1);
    expect(voided[0]).toMatchObject({ id: gone.id, bibNumber: 27, registeredName: "Plecată", status: "CANCELLED", voidedAt: NOW });
  });

  it("lists nothing for a cancelled row whose bib was never printed, a test row, or a confirmed one", async () => {
    // Settled but never on paper: there is no piece of paper to pull.
    await register("Anulată neprintată", { status: "CANCELLED", bib: 5 });
    // A test row never wears a number the club sees (§12.6); even planted, it is not counted.
    await register("De probă", { status: "CANCELLED", kind: "TEST", bib: 6, printedAt: NOW });
    // Confirmed and printed: the bib is right, the runner is coming.
    await register("Vine", { bib: 7, printedAt: NOW });
    // A provisional number is printed nowhere (§214), so a cancelled row cannot be void by it —
    // and the transition releases it anyway. Planted here to show the reader ignores it.
    await register("Provizoriu", { status: "CANCELLED", provisional: 8, printedAt: NOW });

    expect(await voidBibsFor(db, eventId)).toEqual([]);
  });

  it("lists an expired row too, sorted by number, and dates each by its own pair", async () => {
    await register("Expirată", { status: "EXPIRED", bib: 31, printedAt: NOW });
    await register("Anulată", { status: "CANCELLED", bib: 12, printedAt: NOW });
    await register("Anulată și ea", { status: "CANCELLED", bib: 27, printedAt: NOW });

    const voided = await voidBibsFor(db, eventId);
    expect(voided.map((bib) => bib.bibNumber)).toEqual([12, 27, 31]);
    expect(voided[0].voidedAt).toEqual(new Date("2026-10-12T10:00:00Z"));
    expect(voided[2]).toMatchObject({ status: "EXPIRED", voidedAt: new Date("2026-10-13T10:00:00Z") });
  });

  /**
   * What "the number was later changed by hand" means here (§173, §286): a confirmed runner's
   * settled number cannot be changed at all, so the only hand-given number that can be void is
   * one typed **before** confirmation and then carried through. The desk's provisional number is
   * the other case, and it is not void because it is never printed and is released with the
   * place (§214).
   */
  it("a number typed by hand is settled, and once printed and cancelled it is void under that number", async () => {
    const typed = await register("Preferențial", { status: "PENDING_DECLARATION" });
    await setBibNumberByStaff(db, admin, typed.id, 900, NOW);
    await db.update(registrations).set({ status: "CONFIRMED" }).where(eq(registrations.id, typed.id));
    await setBibPrinted(db, { actor: admin, registrationId: typed.id, printed: true, now: NOW });

    // Refused: a confirmed runner with a number keeps it, so nothing can move 900 to somebody
    // else and leave the printed bib pointing at nobody (§173).
    await expect(setBibNumberByStaff(db, admin, typed.id, 901, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    await cancelRegistrationByStaff(db, admin, typed.id, "accidentare", NOW);
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([900]);
  });

  it("never prints a void number again: a range of 1–50 around a cancelled printed 27 is 49 bibs", async () => {
    for (let n = 1; n <= 50; n += 1) {
      await register(`Runner ${n}`, { bib: n, printedAt: n === 27 ? NOW : undefined });
    }
    const [twentySeven] = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.bibNumber, 27));
    await cancelRegistrationByStaff(db, admin, twentySeven.id, "nu mai vine", NOW);

    const reprint = await listBibs(db, eventId, { from: 1, to: 50 });
    expect(reprint).toHaveLength(49);
    expect(reprint.map((bib) => bib.bibNumber)).not.toContain(27);
    // Nor in the club's weekly batch, which is "everybody not yet on paper": 27 is on paper and
    // is not somebody's any more, so it is in neither pile the sheet prints.
    expect((await listBibs(db, eventId, { only: "unprinted" })).map((bib) => bib.bibNumber)).not.toContain(27);
    // And the count the panel shows is the sheet's own: 49 confirmed, none of them printed.
    expect(await countBibs(db, eventId)).toEqual({ total: 49, unprinted: 49 });
    // 27 is the void line's business.
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([27]);
  });

  it("keeps the void mark when the club says none of the sheet is printed, so the paper is still named", async () => {
    await register("Rămâne", { bib: 1, printedAt: NOW });
    await register("Plecată", { status: "CANCELLED", bib: 2, printedAt: NOW });

    // "Niciunul nu e printat" is about the sheet's own rows — a reprint of the confirmed —
    // and must not erase the only record that a void bib exists somewhere in a pile.
    expect(await markBibsPrinted(db, { actor: admin, eventId, printed: false, now: NOW })).toEqual({ marked: 1 });
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([2]);
    // And the single mark refuses the cancelled row either way: the void mark is read, not toggled.
    const [plecata] = await db.select({ id: registrations.id }).from(registrations).where(eq(registrations.bibNumber, 2));
    await expect(setBibPrinted(db, { actor: admin, registrationId: plecata.id, printed: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes the printed bib into the staff cancellation's audit row — the number and the fact, never the name", async () => {
    const printed = await register("Tipărită", { bib: 27, printedAt: NOW });
    const unprinted = await register("Netipărită", { bib: 28 });

    await cancelRegistrationByStaff(db, admin, printed.id, "s-a răzgândit", NOW);
    await cancelRegistrationByStaff(db, admin, unprinted.id, "s-a răzgândit", NOW);

    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.cancelled_by_staff"));
    const ofPrinted = trail.find((row) => row.entityId === printed.id);
    const ofUnprinted = trail.find((row) => row.entityId === unprinted.id);
    expect(ofPrinted?.metadataJson).toEqual({ from: "CONFIRMED", reason: "s-a răzgândit", bibNumber: 27, bibPrinted: true });
    expect(ofUnprinted?.metadataJson).toEqual({ from: "CONFIRMED", reason: "s-a răzgândit" });
    expect(JSON.stringify(ofPrinted?.metadataJson)).not.toContain("Tipărită");
  });

  /**
   * The hole this work found and did not close (§306, still owed): erasing the registration
   * takes the number with it, and the draw reads live rows only — so an erased void 27 is
   * drawable again while the paper is in the pile. What is protected here is that the fact
   * survives in the erasure's own audit row — the event, the number, that it was printed — so
   * the retired-numbers reader the fix needs has something to read, and so the trail says it.
   */
  it("an erased void bib leaves the list and frees its number, and the erase row records the number", async () => {
    const gone = await register("Plecată", { status: "CANCELLED", bib: 27, printedAt: NOW });
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([27]);

    await deleteRegistrationByStaff(db, admin, gone.id, "a cerut ștergerea", NOW);

    expect(await voidBibsFor(db, eventId)).toEqual([]);
    // Named, not hidden: the number is free again to the allocator's draw. This is the gap.
    const taken = new Set<number>();
    for (let i = 0; i < 27; i += 1) await pickBibNumber(db, eventId, taken);
    expect(taken.has(27)).toBe(true);

    const [erasure] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deleted_by_staff"));
    expect(erasure.metadataJson).toEqual({ from: "CANCELLED", reason: "a cerut ștergerea", eventId, bibNumber: 27, bibPrinted: true });
    expect(JSON.stringify(erasure.metadataJson)).not.toContain("Plecată");
  });

  it("counts only this event's void bibs", async () => {
    await register("Plecată", { status: "CANCELLED", bib: 27, printedAt: NOW });
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-06T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    expect(await voidBibsFor(db, other.id)).toEqual([]);
    expect(await voidBibsFor(db, eventId)).toHaveLength(1);
  });
});
