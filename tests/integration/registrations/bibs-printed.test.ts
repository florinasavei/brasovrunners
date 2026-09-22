import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { type RegistrationKind, type RegistrationStatus, registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import {
  assignBibNumbers,
  countBibs,
  listBibs,
  markBibsPrinted,
  setBibPrinted,
} from "@/modules/registrations/bibs";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-038-01, `DECISIONS.md` §264 — which bibs are already on paper.
 *
 * The owner: "ar trebui să pot descărca BID-urile din pagina de înscrieri ca și batch! și să pot
 * marca 'BID printat'". Numbers arrive in waves — somebody registers on Thursday, the sheet went
 * to the printer on Wednesday — so what is protected here is the one thing that makes the mark
 * worth having: **the unprinted scope is exactly the batch nobody has printed**, the marking is
 * idempotent so a second press does not rewrite when the first batch went out, and nothing
 * unprintable can be marked.
 */
describe("§264 the bibs that are already printed", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let admin: StaffUser;
  let volunteer: StaffUser;
  let eventId: string;
  let counter = 0;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    [volunteer] = await db
      .insert(staffUsers)
      .values({ email: "vol@dev.test", displayName: "Colaborator", role: "CONTRIBUTOR" })
      .returning();
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    eventId = event.id;
    counter = 0;
  });

  async function register(
    name: string,
    options: { status?: RegistrationStatus; kind?: RegistrationKind } = {},
  ) {
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
        confirmedAt: new Date(Date.UTC(2026, 8, 1, 10, counter)),
      })
      .returning();
    return row;
  }

  const printedAt = () =>
    db
      .select({ name: registrations.registeredName, printed: registrations.bibPrintedAt })
      .from(registrations)
      .orderBy(asc(registrations.registeredName));

  it("marks the unprinted batch, and leaves the ones already printed alone", async () => {
    await register("Prima");
    await register("A doua");
    await assignBibNumbers(db, { actor: admin, eventId });

    const wednesday = new Date("2026-11-18T09:00:00Z");
    const first = await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" }, now: wednesday });
    expect(first).toEqual({ marked: 2 });

    // Somebody registers on Thursday and is confirmed.
    await register("A treia");
    await assignBibNumbers(db, { actor: admin, eventId });
    expect(await countBibs(db, eventId)).toEqual({ total: 3, unprinted: 1 });

    const thursday = new Date("2026-11-19T18:00:00Z");
    const second = await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" }, now: thursday });
    expect(second).toEqual({ marked: 1 });

    // The whole point: the first two still say Wednesday. A mark that rewrote them would lose
    // the only fact that distinguishes "printed with the first sheet" from "printed just now".
    const rows = await printedAt();
    expect(rows.find((row) => row.name === "Prima")?.printed).toEqual(wednesday);
    expect(rows.find((row) => row.name === "A doua")?.printed).toEqual(wednesday);
    expect(rows.find((row) => row.name === "A treia")?.printed).toEqual(thursday);
  });

  it("gives the sheet exactly the unprinted numbers when asked", async () => {
    await register("Prima");
    await register("A doua");
    await assignBibNumbers(db, { actor: admin, eventId });
    await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" } });
    const late = await register("A treia");
    await assignBibNumbers(db, { actor: admin, eventId });

    const unprinted = await listBibs(db, eventId, { only: "unprinted" });
    expect(unprinted.map((row) => row.id)).toEqual([late.id]);
    // And the whole sheet is still the whole sheet.
    expect(await listBibs(db, eventId)).toHaveLength(3);
  });

  it("counts nothing to mark rather than failing, when everything is printed", async () => {
    await register("Prima");
    await assignBibNumbers(db, { actor: admin, eventId });
    await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" } });
    expect(await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" } })).toEqual({ marked: 0 });
    // And no audit row for a press that changed nothing.
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bibs_printed"));
    expect(rows).toHaveLength(1);
    expect(rows[0].metadataJson).toMatchObject({ count: 1 });
  });

  it("takes the whole event's marks back off for a reprint", async () => {
    await register("Prima");
    await register("A doua");
    await assignBibNumbers(db, { actor: admin, eventId });
    await markBibsPrinted(db, { actor: admin, eventId, scope: { only: "unprinted" } });

    expect(await markBibsPrinted(db, { actor: admin, eventId, printed: false })).toEqual({ marked: 2 });
    expect(await countBibs(db, eventId)).toEqual({ total: 2, unprinted: 2 });
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.bibs_unprinted"));
    expect(rows).toHaveLength(1);
  });

  it("marks one bib, for the one that came out of the printer creased", async () => {
    const row = await register("Prima");
    await assignBibNumbers(db, { actor: admin, eventId });

    await setBibPrinted(db, { actor: admin, registrationId: row.id, printed: true });
    expect((await countBibs(db, eventId)).unprinted).toBe(0);
    await setBibPrinted(db, { actor: admin, registrationId: row.id, printed: false });
    expect((await countBibs(db, eventId)).unprinted).toBe(1);
    // The row names the registration, and the batch's names the event (§67's rule about what an
    // audit row may carry).
    const rows = await db.select().from(auditLogs);
    const single = rows.filter((entry) => entry.entityType === "registration");
    expect(single.map((entry) => entry.action).sort()).toEqual([
      "registration.bibs_printed",
      "registration.bibs_unprinted",
    ]);
  });

  it("refuses a registration with nothing to print", async () => {
    // No number at all: waiting-list, test rows and anybody unconfirmed are never on a sheet
    // (`AGENTS.md` §12.6), so there is nothing to record about their bib.
    const waiting = await register("În așteptare", { status: "WAITLISTED" });
    const test = await register("De probă", { kind: "TEST" });
    await assignBibNumbers(db, { actor: admin, eventId });

    for (const id of [waiting.id, test.id]) {
      await expect(setBibPrinted(db, { actor: admin, registrationId: id, printed: true })).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "NOT_FOUND",
      );
    }
    expect(await countBibs(db, eventId)).toEqual({ total: 0, unprinted: 0 });
  });

  it("is the Administrator's, like the sheet itself", async () => {
    const row = await register("Prima");
    await assignBibNumbers(db, { actor: admin, eventId });

    // The desk roles work a phone and never see a list of names (§15.11, §10.2); the sheet is
    // Administrator-only and so is the record of having printed it.
    for (const call of [
      () => markBibsPrinted(db, { actor: volunteer, eventId, scope: { only: "unprinted" } }),
      () => setBibPrinted(db, { actor: volunteer, registrationId: row.id, printed: true }),
    ]) {
      await expect(call()).rejects.toSatisfy(
        (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
      );
    }
    expect((await countBibs(db, eventId)).unprinted).toBe(1);
  });

  it("counts only this event's bibs", async () => {
    await register("Prima");
    await assignBibNumbers(db, { actor: admin, eventId });
    const [other] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-12-06T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    expect(await countBibs(db, other.id)).toEqual({ total: 0, unprinted: 0 });
    expect(await markBibsPrinted(db, { actor: admin, eventId: other.id, scope: { only: "unprinted" } })).toEqual({
      marked: 0,
    });
    expect((await countBibs(db, eventId)).unprinted).toBe(1);
  });
});
