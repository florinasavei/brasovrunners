import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import {
  confirmByStaff,
  confirmEmail,
  type EventForRegistration,
  readPublicAvailability,
  signDeclaration,
  submitRegistration,
} from "@/modules/registrations/service";
import { signingInput } from "../../helpers/declaration-signing";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §16.2 registration maintenance — a liveness mechanism. Every case here has already
 * been proven correct at the moment of the participant's own request in `lifecycle.test.ts`;
 * this file proves the *scheduled* path reaches the same states without anyone clicking anything.
 *
 * Since `DECISIONS.md` §160 a lapsed declaration hold is released only when somebody is waiting
 * for the place or the event has started; the first three cases are the three sides of that.
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

async function approveDeclaration(db: TestDatabase, now: Date) {
  const translations: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
  ];
  await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
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
      type: "GROUP_RUN",
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
    resultsNameConsent: true,
    listOptOut: false,
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

  it("keeps a lapsed declaration hold while nobody waits, and the late signature — online or on paper — confirms it (§160)", async () => {
    await approveDeclaration(db, NOW);
    const online = await createInternalEvent(db, { capacity: 1 });
    const desk = await createInternalEvent(db, { capacity: 1 });
    for (const event of [online, desk]) {
      await submitRegistration(db, event, submissionInput("late@example.ro"), NOW);
      const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
      const held = await confirmEmail(db, event, pending.id, NOW);
      expect(held.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
    }

    // The thirty minutes pass, nobody is waiting: the job has no event to visit, and each
    // hold is still a hold — the place is the person's.
    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    const result = await runRegistrationMaintenance(db, past31Minutes);
    expect(result.eventsProcessed).toBe(0);
    for (const event of [online, desk]) {
      const [kept] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
      expect(kept.status).toBe("PENDING_DECLARATION");
      expect(kept.expiryReason).toBeNull();
    }

    // Signed online, a day late.
    const [lateOnline] = await db.select().from(registrations).where(eq(registrations.eventId, online.id));
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60_000);
    const signed = await signDeclaration(db, online, lateOnline.id, await signingInput(db, nextDay, "Ana Pop"), nextDay);
    expect(signed.status).toBe("CONFIRMED");
    expect(signed.holdExpiresAt).toBeNull();

    // Signed on paper at the desk, on race morning, the hold weeks past its deadline.
    const [volunteer] = await db.insert(staffUsers).values({ email: "volunteer@dev.test", displayName: "Volunteer", role: "CONTRIBUTOR" }).returning();
    const [lateAtDesk] = await db.select().from(registrations).where(eq(registrations.eventId, desk.id));
    const raceMorning = new Date(desk.startsAt.getTime() - 60 * 60_000);
    const onPaper = await confirmByStaff(db, desk, lateAtDesk.id, { id: volunteer.id }, raceMorning);
    expect(onPaper.status).toBe("CONFIRMED");
    expect(onPaper.bibNumber).not.toBeNull();
  });

  it("releases one kept hold per person waiting, oldest deadline first, and no more (§160)", async () => {
    const event = await createInternalEvent(db, { capacity: 3 });
    const held: string[] = [];
    // Three holds, taken a minute apart so their deadlines are ordered, all left unsigned.
    for (const [index, email] of ["a@example.ro", "b@example.ro", "c@example.ro"].entries()) {
      const at = new Date(NOW.getTime() + index * 60_000);
      await submitRegistration(db, event, { ...submissionInput(email), renderedAt: new Date(at.getTime() - 10_000).toISOString() }, at);
      const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
      const fresh = rows.find((row) => !held.includes(row.id))!;
      await confirmEmail(db, event, fresh.id, at);
      held.push(fresh.id);
    }

    // All three past their thirty minutes, nobody waiting: three kept places, none free.
    const later = new Date(NOW.getTime() + 40 * 60_000);
    expect(await readPublicAvailability(db, event, later)).toBe(0);

    // One newcomer. Exactly one place is wanted, so exactly one hold is released — the
    // oldest — and it goes to the person who wanted it, not back on public sale.
    await submitRegistration(db, event, { ...submissionInput("d@example.ro"), renderedAt: new Date(later.getTime() - 10_000).toISOString() }, later);
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const newcomer = all.find((row) => !held.includes(row.id))!;
    const outcome = await confirmEmail(db, event, newcomer.id, later);
    expect(outcome.status).toBe("WAITLIST_OFFERED");

    const after = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const statusOf = (id: string) => after.find((row) => row.id === id)!.status;
    expect(statusOf(held[0])).toBe("EXPIRED");
    expect(statusOf(held[1])).toBe("PENDING_DECLARATION");
    expect(statusOf(held[2])).toBe("PENDING_DECLARATION");
    expect(await readPublicAvailability(db, event, later)).toBe(0);
  });

  it("selects only the event somebody is waiting on, never its neighbour's kept hold (§160)", async () => {
    const waited = await createInternalEvent(db, { capacity: 1 });
    const quiet = await createInternalEvent(db, { capacity: 1 });
    const kept: Record<string, string> = {};
    for (const event of [waited, quiet]) {
      await submitRegistration(db, event, submissionInput("held@example.ro"), NOW);
      const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
      await confirmEmail(db, event, pending.id, NOW);
      kept[event.id] = pending.id;
    }
    // One event gets a queue while the hold is still live — so nothing is released yet — and
    // the other never does. The scan must tell them apart.
    await submitRegistration(db, waited, submissionInput("waiter@example.ro"), NOW);
    const onWaited = await db.select().from(registrations).where(eq(registrations.eventId, waited.id));
    const waiter = onWaited.find((row) => row.id !== kept[waited.id])!;
    expect((await confirmEmail(db, waited, waiter.id, NOW)).status).toBe("WAITLISTED");

    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    expect((await runRegistrationMaintenance(db, past31Minutes)).eventsProcessed).toBe(1);

    const [released] = await db.select().from(registrations).where(eq(registrations.id, kept[waited.id]));
    expect(released.status).toBe("EXPIRED");
    const [promoted] = await db.select().from(registrations).where(eq(registrations.id, waiter.id));
    expect(promoted.status).toBe("WAITLIST_OFFERED");
    const [untouched] = await db.select().from(registrations).where(eq(registrations.id, kept[quiet.id]));
    expect(untouched.status).toBe("PENDING_DECLARATION");
  });

  it("closes a lapsed declaration hold on a cancelled event, so nobody holds a place on a race that will not run", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });
    await submitRegistration(db, event, submissionInput("late@example.ro"), NOW);
    const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, pending.id, NOW);
    await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));

    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    expect((await runRegistrationMaintenance(db, past31Minutes)).eventsProcessed).toBe(1);

    const [closed] = await db.select().from(registrations).where(eq(registrations.id, pending.id));
    expect(closed.status).toBe("EXPIRED");
    expect(closed.expiryReason).toBe("DECLARATION_HOLD_LAPSED");
  });

  it("closes a lapsed declaration hold once the event has started, even with nobody waiting", async () => {
    const startsAt = new Date(NOW.getTime() + 60 * 60_000);
    const event = await createInternalEvent(db, { capacity: 1, startsAt });
    await submitRegistration(db, event, submissionInput("late@example.ro"), NOW);
    const [pending] = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    await confirmEmail(db, event, pending.id, NOW);

    const afterStart = new Date(startsAt.getTime() + 1000);
    const result = await runRegistrationMaintenance(db, afterStart);
    expect(result.eventsProcessed).toBe(1);

    const [closed] = await db.select().from(registrations).where(eq(registrations.id, pending.id));
    expect(closed.status).toBe("EXPIRED");
    expect(closed.expiryReason).toBe("DECLARATION_HOLD_LAPSED");
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
