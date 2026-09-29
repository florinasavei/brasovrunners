import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { listWorkbookDetails } from "@/modules/registrations/admin-repository";
import { readEmergencyDetails, readEmergencySheet } from "@/modules/registrations/admin-service";
import { publicFormEvent } from "@/modules/registrations/public-form-event";
import { type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { workbookExtras } from "@/modules/registrations/workbook";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN (amending §47 and §171 on the form, §322 on where it shows; §554's pattern) — the health note (BR-REQ-031-05) only when the event asks
 * it: «Condiții de participare» → «Informații medicale» (`events.ask_health_note`, false by default).
 * With the tick off, a posted note is ignored — never refused, even without its consent — and the
 * row stores null; with it on, the note is kept as before. Decided off the locked row at every
 * door; the backoffice page and the emergency sheet show a note only for an event that asks it,
 * and the export never carries one. Real PostgreSQL in process (PGlite).
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");
const RACE_DAY = new Date("2026-10-01T09:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["PRIVACY_NOTICE", "TERMS"] as const) {
    await insertLegalDocumentVersion(db, {
      key,
      version: 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(text),
      translations: text,
      now: NOW,
    });
  }
}

/** The event as the public form hands it to the service: the whole row, through `publicFormEvent`. */
async function createInternalEvent(db: TestDatabase, askHealthNote: boolean): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", startsAt: RACE_DAY, registrationMode: "INTERNAL", capacity: null, askHealthNote })
    .returning();
  return publicFormEvent(event, NOW);
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "FEMALE",
    nationality: "RO",
    country: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email: "ana@example.org",
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    termsAccepted: true,
    rulesAcknowledged: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

const NOTE = { healthNotes: "astm, inhalator în buzunar", healthConsent: true };

describe("§NNN the health note only when the event asks it", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let organizer: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
    [organizer] = await db.insert(staffUsers).values({ email: "org@dev.test", displayName: "Org", role: "MODERATOR" }).returning();
  });

  const rowsOf = (eventId: string) => db.select().from(registrations).where(eq(registrations.eventId, eventId));

  it("starts off: a new event asks no health note", async () => {
    const [event] = await db.insert(events).values({ type: "RACE", startsAt: RACE_DAY, registrationMode: "INTERNAL" }).returning();
    expect(event.askHealthNote).toBe(false);
  });

  it("ignores a note posted to an event that does not ask it, and stores null with no consent", async () => {
    const event = await createInternalEvent(db, false);
    await submitRegistration(db, event, submissionInput(NOTE), NOW);
    const [row] = await rowsOf(event.id);
    expect(row).toMatchObject({ healthNotes: null, healthConsentVersion: null, healthConsentAt: null });
    // The emergency contact is not part of the switch: it is kept as it always was.
    expect(row).toMatchObject({ emergencyContactName: "Contact Urgență", emergencyContactPhone: "+40722222222" });
  });

  it("never refuses a stale form: a note without its consent, for an event that does not ask it, passes and stores nothing", async () => {
    const event = await createInternalEvent(db, false);
    await submitRegistration(db, event, submissionInput({ healthNotes: "alergie", healthConsent: false }), NOW);
    const [row] = await rowsOf(event.id);
    expect(row.healthNotes).toBeNull();
  });

  it("keeps the note and its consent for an event that asks it", async () => {
    const event = await createInternalEvent(db, true);
    await submitRegistration(db, event, submissionInput(NOTE), NOW);
    const [row] = await rowsOf(event.id);
    expect(row.healthNotes).toBe("astm, inhalator în buzunar");
    expect(row.healthConsentVersion).toBe(1);
    expect(row.healthConsentAt).toEqual(NOW);
  });

  it("still refuses a note without its consent on an event that asks it (BR-REQ-031-05 criterion 2)", async () => {
    const event = await createInternalEvent(db, true);
    await expect(submitRegistration(db, event, submissionInput({ healthNotes: "alergie", healthConsent: false }), NOW)).rejects.toMatchObject({
      fields: ["healthConsent"],
    });
    expect(await rowsOf(event.id)).toHaveLength(0);
  });

  it("decides from the locked row, never the caller's: the tick taken off after the page was read is honoured", async () => {
    const event = await createInternalEvent(db, true);
    await db.update(events).set({ askHealthNote: false }).where(eq(events.id, event.id));
    await submitRegistration(db, event, submissionInput(NOTE), NOW);
    expect((await rowsOf(event.id))[0].healthNotes).toBeNull();
  });

  it("follows the same switch on a staff entry", async () => {
    const staff = { source: "STAFF" as const, createdByStaffUserId: null };
    const without = await createInternalEvent(db, false);
    await submitRegistration(db, without, submissionInput(NOTE), NOW, "REAL", staff);
    expect((await rowsOf(without.id))[0].healthNotes).toBeNull();

    const asking = await createInternalEvent(db, true);
    await submitRegistration(db, asking, submissionInput({ ...NOTE, email: "b@example.org" }), NOW, "REAL", staff);
    expect((await rowsOf(asking.id))[0].healthNotes).toBe("astm, inhalator în buzunar");
  });

  it("shows the note on the registration's page and the emergency sheet only while the event asks it", async () => {
    const event = await createInternalEvent(db, true);
    await submitRegistration(db, event, submissionInput(NOTE), NOW);
    const [row] = await rowsOf(event.id);
    await db.update(registrations).set({ status: "CONFIRMED", confirmedAt: NOW }).where(eq(registrations.id, row.id));

    expect(await readEmergencyDetails(db, organizer, row.id, NOW)).toMatchObject({ healthNotes: "astm, inhalator în buzunar", eventAsksHealthNote: true });
    const asking = await readEmergencySheet(db, organizer, event.id, NOW);
    expect(asking.asksHealthNote).toBe(true);
    expect(asking.rows.map((sheetRow) => sheetRow.healthNotes)).toEqual(["astm, inhalator în buzunar"]);

    // The tick comes off: the row keeps the note until the seven-day purge, and no screen shows it.
    await db.update(events).set({ askHealthNote: false }).where(eq(events.id, event.id));
    expect(await readEmergencyDetails(db, organizer, row.id, NOW)).toMatchObject({ healthNotes: null, healthConsentAt: null, eventAsksHealthNote: false });
    const notAsking = await readEmergencySheet(db, organizer, event.id, NOW);
    expect(notAsking.asksHealthNote).toBe(false);
    expect(notAsking.rows.map((sheetRow) => sheetRow.healthNotes)).toEqual([null]);
    expect((await rowsOf(event.id))[0].healthNotes).toBe("astm, inhalator în buzunar");
  });

  it("carries no health note in the export, whether the event asks it or not", async () => {
    const event = await createInternalEvent(db, true);
    await submitRegistration(db, event, submissionInput(NOTE), NOW);
    const [row] = await rowsOf(event.id);
    const extras = workbookExtras((await listWorkbookDetails(db, [row.id])).get(row.id));
    expect(JSON.stringify(extras)).not.toContain("astm");
  });

  it("is migration 0111, expand only: one column, false by default", () => {
    const sql = readFileSync(path.join("src/db/migrations", "0111_event_ask_health_note.sql"), "utf8");
    expect(sql.trim()).toBe('ALTER TABLE "events" ADD COLUMN "ask_health_note" boolean DEFAULT false NOT NULL;');
  });
});
