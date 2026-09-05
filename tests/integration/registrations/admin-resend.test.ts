import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { resendRegistrationMessage } from "@/modules/registrations/admin-service";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * AGENTS.md §15.8 — Admin resend. Administrator only, and it never changes state — this test
 * proves both, plus that a status with nothing to resend is refused rather than sending
 * something meaningless.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("AGENTS.md §15.8 admin resend", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let registrationId: string;
  let adminId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);

    const [admin] = await db
      .insert(staffUsers)
      .values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" })
      .returning();
    adminId = admin.id;

    const identity = canonicalizeEmail("ana@example.ro");
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: "Ana Pop",
      })
      .returning();

    const [event] = await db
      .insert(events)
      .values({ kind: "COMMUNITY_RUN", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId: participant.id,
        status: "PENDING_EMAIL_CONFIRMATION",
        locale: "ro",
        registeredName: "Ana Pop",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    registrationId = registration.id;
  });

  it("queues the right message type for the current status, marked as a manual resend", async () => {
    await resendRegistrationMessage(db, { id: adminId, role: "ADMIN" }, registrationId, NOW);

    const [outboxRow] = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId));
    expect(outboxRow.messageType).toBe("VERIFY_REGISTRATION_EMAIL");
    expect(outboxRow.isManualResend).toBe(true);
    expect(outboxRow.requestedByStaffUserId).toBe(adminId);
  });

  it("refuses an Author or Editor", async () => {
    for (const role of ["AUTHOR", "EDITOR"] as const) {
      await expect(
        resendRegistrationMessage(db, { id: adminId, role }, registrationId, NOW),
      ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }
  });

  it("never changes the registration's own state", async () => {
    await resendRegistrationMessage(db, { id: adminId, role: "ADMIN" }, registrationId, NOW);

    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    expect(registration.status).toBe("PENDING_EMAIL_CONFIRMATION");
  });

  it("refuses a status with nothing to resend", async () => {
    await db.update(registrations).set({ status: "WAITLISTED", waitlistedAt: NOW }).where(eq(registrations.id, registrationId));

    await expect(
      resendRegistrationMessage(db, { id: adminId, role: "ADMIN" }, registrationId, NOW),
    ).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "VALIDATION_ERROR");

    const outboxRows = await db.select().from(emailOutbox).where(eq(emailOutbox.registrationId, registrationId));
    expect(outboxRows).toHaveLength(0);
  });
});
