import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { confirmEmail, type EventForRegistration, submitRegistration } from "@/modules/registrations/service";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §16.2 registration maintenance — a liveness mechanism. Every case here has already
 * been proven correct at the moment of the participant's own request in `lifecycle.test.ts`;
 * this file proves the *scheduled* path reaches the same states without anyone clicking anything.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approvePrivacyNotice(db: TestDatabase, now: Date) {
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
    now,
  });
}

async function createInternalEvent(
  db: TestDatabase,
  overrides: { capacity?: number | null; startsAt?: Date } = {},
): Promise<EventForRegistration> {
  const [event] = await db
    .insert(events)
    .values({
      kind: "COMMUNITY_RUN",
      startsAt: overrides.startsAt ?? new Date("2026-10-01T09:00:00.000Z"),
      registrationMode: "INTERNAL",
      capacity: overrides.capacity ?? null,
    })
    .returning();

  return {
    id: event.id,
    eventStatus: event.eventStatus,
    registrationMode: "INTERNAL",
    startsAt: event.startsAt,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    capacity: overrides.capacity ?? null,
    raceId: null,
    publishedAt: NOW,
  };
}

function submissionInput(email: string) {
  return {
    name: "Ana Pop",
    email,
    locale: "ro",
    privacyAcknowledged: true,
    resultsNameConsent: true,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
  };
}

describe("AGENTS.md §16.2 registration maintenance", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approvePrivacyNotice(db, NOW);
  });

  it("expires a lapsed declaration hold and promotes the next waiting entry", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    await submitRegistration(db, event, submissionInput("first@example.ro"), NOW);
    const [first] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, first.id, NOW); // holds the one place, PENDING_DECLARATION

    await submitRegistration(db, event, submissionInput("second@example.ro"), NOW);
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const second = all.find((row) => row.id !== first.id)!;
    await confirmEmail(db, event, second.id, NOW); // WAITLISTED, no place free

    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    const result = await runRegistrationMaintenance(db, past31Minutes);
    expect(result.eventsProcessed).toBe(1);
    expect(result.errorCount).toBe(0);

    const firstAfter = await db.select().from(registrations).where(eq(registrations.id, first.id)).then((r) => r[0]);
    expect(firstAfter.status).toBe("EXPIRED");
    expect(firstAfter.expiryReason).toBe("DECLARATION_HOLD_LAPSED");

    const secondAfter = await db.select().from(registrations).where(eq(registrations.id, second.id)).then((r) => r[0]);
    expect(secondAfter.status).toBe("WAITLIST_OFFERED");
    expect(secondAfter.holdExpiresAt).not.toBeNull();

    const offerEmail = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
    expect(offerEmail).toHaveLength(1);
  });

  it("closes the waiting list once an event has started, with no message sent", async () => {
    const startsAt = new Date(NOW.getTime() + 60_000);
    const event = await createInternalEvent(db, { capacity: 1, startsAt });

    await submitRegistration(db, event, submissionInput("first@example.ro"), NOW);
    const [first] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, first.id, NOW);

    await submitRegistration(db, event, submissionInput("second@example.ro"), NOW);
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const second = all.find((row) => row.id !== first.id)!;
    await confirmEmail(db, event, second.id, NOW); // WAITLISTED

    const afterStart = new Date(startsAt.getTime() + 1000);
    await runRegistrationMaintenance(db, afterStart);

    const secondAfter = await db.select().from(registrations).where(eq(registrations.id, second.id)).then((r) => r[0]);
    expect(secondAfter.status).toBe("EXPIRED");
    expect(secondAfter.expiryReason).toBe("EVENT_STARTED");

    const outboxForSecond = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.registrationId, second.id));
    expect(outboxForSecond.filter((row) => row.messageType === "WAITLIST_OFFER_EXPIRED")).toHaveLength(0);
    expect(outboxForSecond.filter((row) => row.messageType === "WAITLIST_SPOT_OFFER")).toHaveLength(0);
  });

  it("records a job_runs row for every invocation, including one that finds nothing to do", async () => {
    await runRegistrationMaintenance(db, NOW);

    const runs = await db.select().from(jobRuns).where(eq(jobRuns.jobName, "registration-maintenance"));
    expect(runs).toHaveLength(1);
    expect(runs[0].finishedAt).not.toBeNull();
    expect(runs[0].itemsProcessed).toBe(0);
    expect(runs[0].errorCount).toBe(0);
  });

  it("is a no-op for an event with nothing due, run twice in a row", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput("first@example.ro"), NOW);
    const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));

    await runRegistrationMaintenance(db, NOW);
    await runRegistrationMaintenance(db, NOW);

    const after = await db.select().from(registrations).where(eq(registrations.id, pending.id)).then((r) => r[0]);
    // Still pending email confirmation — maintenance never touches capacity for a status that
    // does not hold a place, and the hold clock has not started.
    expect(after.status).toBe("PENDING_EMAIL_CONFIRMATION");
  });
});
