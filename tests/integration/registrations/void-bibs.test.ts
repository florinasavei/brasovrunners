import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { issueActionToken } from "@/modules/action-tokens/repository";
import {
  bulkCancelRegistrationsByStaff,
  cancelRegistrationByStaff,
  deleteRegistrationByStaff,
  setBibNumberByStaff,
} from "@/modules/registrations/admin-service";
import {
  countBibs,
  erasedBibNumbers,
  listBibs,
  markBibsPrinted,
  pickBibNumber,
  pickProvisionalBibNumber,
  setBibPrinted,
  settleBibNumbers,
  suggestFreeBibNumbers,
  voidBibsFor,
} from "@/modules/registrations/bibs";
import { consumeAndCancelFromMyRegistrations } from "@/modules/registrations/my-registrations";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01 criterion 16, `DECISIONS.md` §311 — a printed bib of a cancelled entry is void.
 *
 * The owner: "trebuie sa avem mare grija cu cele anulate, mai ales daca BID-ul a fost deja
 * printat!". A settled number is never reused (§173), which is right; what it leaves behind is a
 * piece of paper with a valid-looking number and nobody entitled to wear it. What is protected
 * here: `voidBibsFor` names exactly those bibs — printed, settled, real, on a registration that is
 * over — whoever cancelled it, and nothing else; the sheet never prints one again, in a batch or
 * in a range; the unprinted count never quietly absorbs one; a staff cancellation writes the fact
 * into its own audit row so the timeline can say it without a join, and the bulk cancel reports
 * the numbers it voided; a number on a row that is over cannot be cleared or replaced, whoever
 * posts the form (BR-REQ-060-01); and an erased registration's number stays out of every draw.
 */
describe("§311 the printed bibs of cancelled registrations", () => {
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

    // Cancelled by an Administrator: the transition keeps the number and the mark on the row.
    await cancelRegistrationByStaff(db, admin, gone.id, "s-a răzgândit", NOW);

    const voided = await voidBibsFor(db, eventId);
    expect(voided).toHaveLength(1);
    expect(voided[0]).toMatchObject({ id: gone.id, bibNumber: 27, registeredName: "Plecată", status: "CANCELLED", voidedAt: NOW });
  });

  /**
   * The participant's own door, which writes no audit row: the row is the whole record, so the
   * number and the mark have to survive `unregister` as they do from the staff side.
   */
  it("lists a bib cancelled from the participant's own link, which keeps its number and mark", async () => {
    const printed = new Date("2026-10-01T09:00:00Z");
    const gone = await register("Din link", { bib: 27, printedAt: printed });
    const secret = (
      await issueActionToken(db, {
        participantId: gone.participantId,
        registrationId: null,
        purpose: "MANAGE_PROFILE",
        expiresAt: new Date("2026-11-21T07:00:00Z"),
        now: NOW,
      })
    ).secret;

    const result = await consumeAndCancelFromMyRegistrations(db, secret, gone.id, NOW);
    expect(result.ok && result.registration).toMatchObject({ status: "CANCELLED", cancellationSource: "PARTICIPANT", bibNumber: 27 });
    expect(result.ok && result.registration.bibPrintedAt).toEqual(printed);

    expect(await voidBibsFor(db, eventId)).toEqual([
      { id: gone.id, bibNumber: 27, registeredName: "Din link", status: "CANCELLED", voidedAt: NOW },
    ]);
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

  /**
   * BR-REQ-060-01: the desk draws no number field on a row that is over, and that is not the
   * guard. A POST straight to the action — any desk role, a Voluntar included — used to clear or
   * move a cancelled runner's settled number, freeing 27 for the draw while the void bib was in
   * the pile.
   */
  it("refuses to clear or replace the number of a cancelled or expired row, so the void bib stays named", async () => {
    const volunteer = { id: admin.id, role: "CONTRIBUTOR" as const };
    const cancelled = await register("Anulată", { status: "CANCELLED", bib: 27, printedAt: NOW });
    const expired = await register("Expirată", { status: "EXPIRED", bib: 31, printedAt: NOW });
    const unprinted = await register("Neprintată", { status: "CANCELLED", bib: 40 });
    const numberless = await register("Fără număr", { status: "CANCELLED" });

    for (const [row, attempt] of [
      [cancelled, null],
      [cancelled, 901],
      [expired, null],
      [expired, 902],
      // Not printed, and still retired (§173): the email that named it is somebody's.
      [unprinted, null],
      // A number given to a registration that is over is a number retired for nothing.
      [numberless, 903],
    ] as const) {
      for (const actor of [volunteer, admin]) {
        await expect(setBibNumberByStaff(db, actor, row.id, attempt, NOW), `${row.registeredName} → ${attempt}`).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
      }
    }

    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([27, 31]);
    const numbers = await db.select({ id: registrations.id, bibNumber: registrations.bibNumber }).from(registrations);
    expect(new Map(numbers.map((row) => [row.id, row.bibNumber]))).toEqual(
      new Map([
        [cancelled.id, 27],
        [expired.id, 31],
        [unprinted.id, 40],
        [numberless.id, null],
      ]),
    );
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bib_set"))).toEqual([]);
  });

  /**
   * The one way a live row carries a printed mark without being confirmed: a cancelled entry that
   * restarted keeps both. Moving the number would leave the printed bib pointing at nobody.
   */
  it("refuses to move a printed number on a restarted registration too", async () => {
    const restarted = await register("Revenită", { status: "PENDING_DECLARATION", bib: 12, printedAt: NOW });
    await expect(setBibNumberByStaff(db, admin, restarted.id, 13, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(setBibNumberByStaff(db, admin, restarted.id, null, NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // Before anything is printed the preferential number is still the organizer's to give (§105).
    const fresh = await register("Nouă", { status: "PENDING_DECLARATION", bib: 14 });
    expect((await setBibNumberByStaff(db, admin, fresh.id, 15, NOW)).bibNumber).toBe(15);
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
   * The race-morning path (§67): the bulk cancel goes through the single one row by row, and
   * reports which printed numbers it has just made void so the saved banner can name them.
   */
  it("bulk-cancels row by row and reports the printed numbers it voided, lowest first", async () => {
    const twentySeven = await register("Douăzeci și șapte", { bib: 27, printedAt: NOW });
    const twelve = await register("Doisprezece", { bib: 12, printedAt: NOW });
    const five = await register("Cinci", { bib: 5 });
    const already = await register("Deja anulată", { status: "CANCELLED", bib: 3, printedAt: NOW });

    const outcome = await bulkCancelRegistrationsByStaff(db, admin, [twentySeven.id, twelve.id, five.id, already.id], "nu mai vin", NOW);
    // The already-cancelled row refuses and is counted, and voided nothing *now*: it is on the
    // bibs panel already, and the banner is about this press.
    expect(outcome).toEqual({ cancelled: 3, test: 0, failed: 1, voided: [12, 27] });
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([3, 12, 27]);
    // Each row wrote its own audit row, printed number and all.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.cancelled_by_staff"));
    expect(trail.find((row) => row.entityId === twelve.id)?.metadataJson).toMatchObject({ bibNumber: 12, bibPrinted: true });

    // The Administrator's verb, asserted here and not only by the action's gate (BR-REQ-060-01).
    const organizer = { id: admin.id, role: "MODERATOR" as const };
    await expect(bulkCancelRegistrationsByStaff(db, organizer, [five.id], "x", NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  /**
   * §173 against erasure. Erasing deletes the row, and every draw learns what is taken from the
   * rows — so, before §311's reader, an erased void 27 was "the lowest free number" again while
   * its paper was still in the pile. The erasure's own audit row keeps the event, the number and
   * whether it was printed (never who), and every draw reads it back.
   */
  it("keeps an erased printed 27 out of every draw in a band of 1–30, and the erase row records it", async () => {
    const gone = await register("Plecată", { status: "CANCELLED", bib: 27, printedAt: NOW });
    expect((await voidBibsFor(db, eventId)).map((bib) => bib.bibNumber)).toEqual([27]);

    await deleteRegistrationByStaff(db, admin, gone.id, "a cerut ștergerea", NOW);

    // The row and its line are gone; the number is not free.
    expect(await voidBibsFor(db, eventId)).toEqual([]);
    expect(await erasedBibNumbers(db, eventId)).toEqual([27]);

    // The final draw, thirty times from the band's start: 1–26, then 28 onwards — never 27.
    const final = new Set<number>();
    const drawn: number[] = [];
    for (let i = 0; i < 30; i += 1) drawn.push(await pickBibNumber(db, eventId, final));
    expect(drawn).not.toContain(27);
    expect(drawn.slice(25, 27)).toEqual([26, 28]);
    // The provisional draw, which would otherwise promote a provisional 27 to a final one.
    const provisional = new Set<number>();
    const held: number[] = [];
    for (let i = 0; i < 30; i += 1) held.push(await pickProvisionalBibNumber(db, eventId, provisional));
    expect(held).not.toContain(27);
    // The free-number hints beside the hand-typed field.
    expect(await suggestFreeBibNumbers(db, eventId, 25, 4)).toEqual([25, 26, 28, 29]);

    // Typed by hand, it is refused and nothing is written.
    const typing = await register("Preferențial", { status: "PENDING_DECLARATION" });
    await expect(setBibNumberByStaff(db, admin, typing.id, 27, NOW)).rejects.toMatchObject({ code: "CONFLICT" });
    const [still] = await db.select({ bibNumber: registrations.bibNumber }).from(registrations).where(eq(registrations.id, typing.id));
    expect(still.bibNumber).toBeNull();
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bib_set"))).toEqual([]);

    const [erasure] = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.deleted_by_staff"));
    expect(erasure.metadataJson).toEqual({ from: "CANCELLED", reason: "a cerut ștergerea", eventId, bibNumber: 27, bibPrinted: true });
    expect(JSON.stringify(erasure.metadataJson)).not.toContain("Plecată");
  });

  /**
   * The recompaction at the close runs from the band's start (§214), so it is the pass certain to
   * reach an erased number — and an unprinted one is retired as firmly as a printed one: the
   * runner was emailed it either way.
   */
  it("closes the settle around an erased number, printed or not", async () => {
    const printed = await register("Tipărită", { status: "CANCELLED", bib: 2, printedAt: NOW });
    const emailed = await register("Doar pe email", { status: "CANCELLED", bib: 4 });
    await deleteRegistrationByStaff(db, admin, printed.id, "ștergere", NOW);
    await deleteRegistrationByStaff(db, admin, emailed.id, "ștergere", NOW);
    for (const provisional of [1, 2, 3]) {
      await register(`Așteaptă ${provisional}`, { status: "PENDING_DECLARATION", provisional });
    }

    const settled = await settleBibNumbers(db, { eventId, bibStartNumber: 1, bibsSettledAt: null, now: NOW });
    expect(settled.map((bib) => bib.bibNumber)).toEqual([1, 3, 5]);
  });

  it("reads an erased number for its own event only", async () => {
    const gone = await register("Plecată", { status: "CANCELLED", bib: 27, printedAt: NOW });
    await deleteRegistrationByStaff(db, admin, gone.id, "ștergere", NOW);
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-06T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    expect(await erasedBibNumbers(db, other.id)).toEqual([]);
    expect(await suggestFreeBibNumbers(db, other.id, 26, 2)).toEqual([26, 27]);
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
