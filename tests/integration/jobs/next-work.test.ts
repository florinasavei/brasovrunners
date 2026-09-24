import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import { nextMaintenanceWork, nextOutboxWork } from "@/modules/jobs/next-work";
import { PLAN_GRACE_MINUTES, planQuiet } from "@/modules/jobs/schedule";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-03 criterion 8 (§NNN) — each real run works out, from the database it already has
 * awake, the earliest instant its job will next have work. One case per duty the maintenance job
 * performs, each alone on an empty database so the instant is that duty's and nobody else's, and
 * the outbox's own. "Nothing at all" is null, which the plan turns into the hour-long cap.
 */
const NOW = new Date("2026-10-01T10:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(translations),
    translations,
    now: NOW,
  });
});

async function createEvent(overrides: Partial<typeof events.$inferInsert> = {}): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      startsAt: new Date(NOW.getTime() + 30 * DAY),
      registrationMode: "INTERNAL",
      capacity: 10,
      // No participation window unless a case asks for one: its opening is an instant of its own.
      confirmationOpensDaysBefore: 0,
      ...overrides,
    })
    .returning();
  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: event.capacity,
    raceId: null,
    publishedAt: new Date(NOW.getTime() - 30 * DAY),
  };
}

function submission(email: string, at: Date) {
  return {
    firstName: "Ana",
    lastName: "Pop",
    birthDate: "1990-05-17",
    sex: "UNSPECIFIED",
    nationality: "RO",
    city: "Brașov",
    phone: "+40711111111",
    emergencyContactName: "Contact Urgență",
    emergencyContactPhone: "+40722222222",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    fitnessDeclared: true,
    rulesAcknowledged: true,
    resultsNameConsent: true,
    listOptOut: false,
    honeypot: "",
    renderedAt: new Date(at.getTime() - 10_000).toISOString(),
  };
}

/** One registration on the event, submitted at `at`, then shaped by `changes`. */
async function register(event: EventForRegistration, changes: Partial<typeof registrations.$inferInsert> = {}, at = NOW) {
  await submitRegistration(db, event, submission(`runner-${Math.random().toString(36).slice(2)}@example.ro`, at), at);
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
  if (Object.keys(changes).length > 0) await db.update(registrations).set(changes).where(eq(registrations.id, row.id));
  return row.id;
}

describe("BR-REQ-090-03 criterion 8 the maintenance job's next work, duty by duty", () => {
  it("is nothing on an empty database, which the plan caps at an hour", async () => {
    const next = await nextMaintenanceWork(db, NOW);
    expect(next).toBeNull();
    expect(planQuiet({ ranAt: NOW, nextWorkAt: next, cadenceMinutes: 0, failed: false }).quietUntil).toEqual(
      new Date(NOW.getTime() + HOUR - PLAN_GRACE_MINUTES * MINUTE),
    );
  });

  it("is the moment an unconfirmed email link lapses, 48 hours after the submission", async () => {
    const event = await createEvent();
    await register(event, {}, new Date(NOW.getTime() - 40 * HOUR));
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 8 * HOUR));
  });

  it("is a declaration hold's expiry, once a hold is created", async () => {
    const event = await createEvent();
    const id = await register(event);
    const held = await confirmEmail(db, event, id, NOW);
    expect(held.status).toBe("PENDING_DECLARATION");
    expect(held.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * MINUTE));
    expect(await nextMaintenanceWork(db, NOW)).toEqual(held.holdExpiresAt);
  });

  it("is a waiting-list offer's deadline", async () => {
    const event = await createEvent();
    await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date(NOW.getTime() + 3 * HOUR) });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 3 * HOUR));
  });

  it("is the start of an event somebody is waiting for, when the waiting list closes", async () => {
    const event = await createEvent({ startsAt: new Date(NOW.getTime() + 20 * HOUR) });
    await register(event, { status: "WAITLISTED", waitlistedAt: NOW });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 20 * HOUR));
  });

  it("is the registration close, when the race numbers settle", async () => {
    const event = await createEvent({ registrationClosesAt: new Date(NOW.getTime() + 2 * HOUR) });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 2 * HOUR));
  });

  it("is two days before the start, when the reminders go", async () => {
    const event = await createEvent({ startsAt: new Date(NOW.getTime() + 5 * DAY) });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date(NOW.getTime() - 3 * DAY) });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 3 * DAY));
  });

  it("is a day after a confirmation inside those two days, when that reminder goes (§126)", async () => {
    const event = await createEvent({ startsAt: new Date(NOW.getTime() + 30 * HOUR) });
    await register(event, { status: "CONFIRMED", confirmedAt: new Date(NOW.getTime() - HOUR) });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 23 * HOUR));
  });

  it("is the participation window's opening, when the confirmation is asked again (§104)", async () => {
    const event = await createEvent({
      startsAt: new Date(NOW.getTime() + 10 * DAY),
      confirmationOpensDaysBefore: 7,
      confirmationDeadlineDaysBefore: 2,
    });
    await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() + 8 * DAY) });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 3 * DAY));
  });

  it("is the moment registration opens for an event with addresses waiting (§146)", async () => {
    const event = await createEvent({ registrationOpensAt: new Date(NOW.getTime() + 2 * HOUR) });
    await db.insert(registrationInterests).values({
      eventId: event.id,
      deliveryEmail: "waiting@example.ro",
      canonicalEmail: "waiting@example.ro",
      canonicalizationVersion: 1,
      locale: "ro",
      createdAt: NOW,
    });
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(NOW.getTime() + 2 * HOUR));
  });

  it("leaves a completed event alone, as the job does", async () => {
    const event = await createEvent({ startsAt: new Date(NOW.getTime() + 2 * HOUR) });
    await register(event, { status: "WAITLIST_OFFERED", holdExpiresAt: new Date(NOW.getTime() + HOUR) });
    await db.update(events).set({ eventStatus: "COMPLETED" }).where(eq(events.id, event.id));
    expect(await nextMaintenanceWork(db, NOW)).toBeNull();
  });

  it("looks only forward: a deadline already behind is the run's own work, not the next one's", async () => {
    const event = await createEvent();
    await register(event, { status: "PENDING_DECLARATION", holdExpiresAt: new Date(NOW.getTime() - MINUTE) });
    // A lapsed hold nobody waits for is kept (§160); what is left ahead is the event's own instants.
    expect(await nextMaintenanceWork(db, NOW)).toEqual(new Date(event.startsAt.getTime() - 2 * DAY));
  });
});

describe("BR-REQ-090-03 criterion 8 the outbox's next work", () => {
  async function queue(row: Partial<typeof emailOutbox.$inferInsert>) {
    await db.insert(emailOutbox).values({
      messageType: "VERIFY_REGISTRATION_EMAIL",
      locale: "ro",
      recipientEmail: "someone@example.ro",
      payloadJson: {},
      idempotencyKey: `key-${Math.random()}`,
      status: "PENDING",
      attemptCount: 0,
      createdAt: NOW,
      ...row,
    });
  }

  it("is nothing when nothing waits", async () => {
    expect(await nextOutboxWork(db)).toBeNull();
  });

  it("is now for a row never tried, which the drain left behind", async () => {
    await queue({ createdAt: new Date(NOW.getTime() - MINUTE) });
    expect(await nextOutboxWork(db)).toEqual(new Date(NOW.getTime() - MINUTE));
  });

  it("is the retry's own time after a transient failure", async () => {
    await queue({ attemptCount: 2, nextAttemptAt: new Date(NOW.getTime() + 4 * MINUTE) });
    expect(await nextOutboxWork(db)).toEqual(new Date(NOW.getTime() + 4 * MINUTE));
  });

  it("is the lock's timeout for a row a dead worker left claimed", async () => {
    await queue({ status: "PROCESSING", lockedAt: NOW, attemptCount: 1 });
    expect(await nextOutboxWork(db)).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
  });

  it("ignores what was sent", async () => {
    await queue({ status: "SENT", sentAt: NOW });
    expect(await nextOutboxWork(db)).toBeNull();
  });
});
