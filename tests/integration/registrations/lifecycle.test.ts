import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmEmail,
  type EventForRegistration,
  signDeclaration,
  submitRegistration,
  unregister,
} from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-033-01 — confirmation, hold, declaration, confirmed. Also exercises BR-REQ-030-01
 * (internal mode only), BR-REQ-031-01 (no password/account surface), and BR-REQ-036-01
 * (self-unregistration).
 *
 * The concurrency requirements this same flow carries — BR-REQ-034-02, BR-REQ-034-03 — are
 * proven against real PostgreSQL in `tests/concurrency`, not here; PGlite is single-connection
 * and cannot race two transactions.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

async function approveLegalDocuments(db: TestDatabase, now: Date) {
  const privacy: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  const declaration: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Declarație", body: { sections: [{ paragraphs: ["d"] }] } },
    { locale: "en", title: "Declaration", body: { sections: [{ paragraphs: ["d"] }] } },
  ];

  await insertLegalDocumentVersion(db, {
    key: "PRIVACY_NOTICE",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(privacy),
    translations: privacy,
    now,
  });
  await insertLegalDocumentVersion(db, {
    key: "EVENT_DECLARATION",
    version: 1,
    effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    isApproved: true,
    contentSha256: computeContentHash(declaration),
    translations: declaration,
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
    publishedAt: NOW, // registration_opens_at defaults to publication when unset
  };
}

function submissionInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Ana Pop",
    email: "ana@example.ro",
    locale: "ro",
    privacyAcknowledged: true,
    resultsNameConsent: true,
    honeypot: "",
    renderedAt: new Date(NOW.getTime() - 10_000).toISOString(),
    ...overrides,
  };
}

async function findOneRegistration(db: TestDatabase, eventId: string) {
  const [row] = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
  return row;
}

describe("BR-REQ-033-01 registration lifecycle", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db, NOW);
  });

  it("BR-REQ-031-01: the submission surface asks only for name, email, locale, and consent — no password", async () => {
    const event = await createInternalEvent(db);
    const result = await submitRegistration(db, event, submissionInput(), NOW);

    expect(result).toEqual({ ok: true });
    const registration = await findOneRegistration(db, event.id);
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
    // Nothing resembling an account exists on the row or the schema this test can reach.
    expect(Object.keys(registration)).not.toContain("password");
  });

  it("creates no place until email is confirmed", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });
    await submitRegistration(db, event, submissionInput(), NOW);

    const registration = await findOneRegistration(db, event.id);
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
    expect(registration.holdExpiresAt).toBeNull();
  });

  it("holds a place for 30 minutes on confirmation, when capacity allows", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);

    const confirmed = await confirmEmail(db, event, pending.id, NOW);

    expect(confirmed.status).toBe("PENDING_DECLARATION");
    expect(confirmed.holdExpiresAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
  });

  it("expires the declaration hold after 30 minutes with the right reason", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);

    const past31Minutes = new Date(NOW.getTime() + 31 * 60_000);
    // Signing after the deadline re-runs allocation rather than confirming a lapsed hold —
    // with capacity still free, a fresh hold is granted rather than a refusal.
    const resigned = await signDeclaration(
      db,
      event,
      pending.id,
      { accepted: true, typedName: "Ana Pop" },
      past31Minutes,
    );
    expect(resigned.status).toBe("CONFIRMED");
  });

  it("signing the declaration confirms and records an immutable acceptance", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);

    const confirmed = await signDeclaration(
      db,
      event,
      pending.id,
      { accepted: true, typedName: "Ana Pop" },
      new Date(NOW.getTime() + 60_000),
    );

    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(confirmed.holdExpiresAt).toBeNull();

    const [acceptance] = await db
      .select()
      .from(declarationAcceptances)
      .where(eq(declarationAcceptances.registrationId, confirmed.id));
    expect(acceptance.typedName).toBe("Ana Pop");
    expect(acceptance.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("BR-REQ-036-01: self-unregistration is idempotent and releases the place", async () => {
    const event = await createInternalEvent(db, { capacity: 10 });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);
    await confirmEmail(db, event, pending.id, NOW);
    const confirmed = await signDeclaration(
      db,
      event,
      pending.id,
      { accepted: true, typedName: "Ana Pop" },
      NOW,
    );

    const cancelled = await unregister(db, event, confirmed.id, "PARTICIPANT", NOW);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationSource).toBe("PARTICIPANT");

    // Opening the cancel link a second time is not an error.
    const cancelledAgain = await unregister(db, event, confirmed.id, "PARTICIPANT", NOW);
    expect(cancelledAgain.status).toBe("CANCELLED");
  });

  it("refuses self-unregistration once the event has started", async () => {
    const startsAt = new Date(NOW.getTime() + 60_000);
    const event = await createInternalEvent(db, { capacity: 10, startsAt });
    await submitRegistration(db, event, submissionInput(), NOW);
    const pending = await findOneRegistration(db, event.id);

    const afterStart = new Date(startsAt.getTime() + 1000);
    await expect(unregister(db, event, pending.id, "PARTICIPANT", afterStart)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("waitlists a confirmation when the event is already full", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    // Fill the one place.
    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const first = await db
      .select()
      .from(registrations)
      .where(eq(registrations.eventId, event.id))
      .then((rows) => rows[0]);
    await confirmEmail(db, event, first.id, NOW);

    // A second participant, confirming afterwards, finds no direct place.
    await submitRegistration(db, event, submissionInput({ email: "second@example.ro" }), NOW);
    const second = await db
      .select()
      .from(registrations)
      .where(
        and(eq(registrations.eventId, event.id), eq(registrations.registeredName, "Ana Pop")),
      )
      .then((rows) => rows.find((row) => row.id !== first.id)!);

    const result = await confirmEmail(db, event, second.id, NOW);
    expect(result.status).toBe("WAITLISTED");
    expect(result.waitlistedAt).toEqual(NOW);
  });

  it("a cancellation frees the place for the front of the waiting list", async () => {
    const event = await createInternalEvent(db, { capacity: 1 });

    await submitRegistration(db, event, submissionInput({ email: "first@example.ro" }), NOW);
    const first = await findOneRegistration(db, event.id);
    const confirmedFirst = await confirmEmail(db, event, first.id, NOW);
    await signDeclaration(db, event, confirmedFirst.id, { accepted: true, typedName: "Ana Pop" }, NOW);

    await submitRegistration(db, event, submissionInput({ email: "second@example.ro" }), new Date(NOW.getTime() + 1000));
    const all = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    const second = all.find((row) => row.id !== confirmedFirst.id)!;
    const waitlisted = await confirmEmail(db, event, second.id, new Date(NOW.getTime() + 2000));
    expect(waitlisted.status).toBe("WAITLISTED");

    await unregister(db, event, confirmedFirst.id, "PARTICIPANT", new Date(NOW.getTime() + 3000));

    const promoted = await db
      .select()
      .from(registrations)
      .where(eq(registrations.id, second.id))
      .then((rows) => rows[0]);
    expect(promoted.status).toBe("WAITLIST_OFFERED");
    expect(promoted.holdExpiresAt).not.toBeNull();

    const outboxRow = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.messageType, "WAITLIST_SPOT_OFFER"));
    expect(outboxRow).toHaveLength(1);
  });

  it("BR-REQ-030-01: refuses local registration on a non-internal event", async () => {
    const event = await createInternalEvent(db);
    event.registrationMode = "NONE";

    await expect(submitRegistration(db, event, submissionInput(), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("refuses registration when no privacy notice has been approved", async () => {
    await resetTables(db); // no approveLegalDocuments this time
    const event = await createInternalEvent(db);

    await expect(submitRegistration(db, event, submissionInput(), NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR",
    );
  });

  it("answers a honeypot-tripped or too-fast submission exactly like success, and creates nothing", async () => {
    const event = await createInternalEvent(db);

    const spamResult = await submitRegistration(
      db,
      event,
      submissionInput({ honeypot: "http://spam.example" }),
      NOW,
    );
    expect(spamResult).toEqual({ ok: true });

    const tooFastResult = await submitRegistration(
      db,
      event,
      submissionInput({ renderedAt: new Date(NOW.getTime() - 500).toISOString() }),
      NOW,
    );
    expect(tooFastResult).toEqual({ ok: true });

    const rows = await db.select().from(registrations).where(eq(registrations.eventId, event.id));
    expect(rows).toHaveLength(0);
  });
});
