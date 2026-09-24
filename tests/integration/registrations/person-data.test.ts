import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrationInterests } from "@/db/schema/registration-interests";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { deleteRegistrationByStaff } from "@/modules/registrations/admin-service";
import {
  canonicalLookupOf,
  exportPersonData,
  openPersonLookup,
  PERSON_LOOKUP_MINUTES,
  sealPersonLookup,
  viewPersonData,
} from "@/modules/registrations/person-data";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-070-01, BR-REQ-060-01 — everything held about one person, for an access request
 * (art. 15 GDPR) and before an erasure (§322).
 *
 * Looked up by the canonical address through the canonicalizer, never a raw compare (AGENTS.md
 * §10.4): a Gmail `+tag` and a capital letter find the same person, and the "Anunță-mă" list is
 * matched the same way. Administrator only. The address never travels in a URL: the lookup is
 * sealed, and a sealed lookup stops opening after half an hour. Viewing records a read of each
 * registration's emergency details; the file records an export with counts and no value.
 */
const NOW = new Date("2026-09-04T10:00:00.000Z");

describe("BR-REQ-070-01 everything held about a person", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;
  let participantId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  async function staff(role: StaffRole): Promise<StaffUser> {
    const [user] = await db
      .insert(staffUsers)
      .values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role })
      .returning();
    return user;
  }

  beforeEach(async () => {
    await resetTables(db);
    await db.delete(registrationInterests);
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();
    eventId = event.id;
    const identity = canonicalizeEmail("Ana.Pop+club@Gmail.com");
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
    participantId = participant.id;
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId,
        status: "CANCELLED",
        cancelledAt: NOW,
        cancellationSource: "PARTICIPANT",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 3,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: true,
        resultsConsentVersion: 3,
        city: "Brașov",
        healthNotes: "astm",
        healthConsentVersion: 3,
        healthConsentAt: NOW,
      })
      .returning();
    registrationId = registration.id;
    await db.insert(emailOutbox).values({
      participantId,
      registrationId,
      messageType: "REGISTRATION_CANCELLED",
      locale: "ro",
      recipientEmail: identity.deliveryEmail,
      payloadJson: {},
      idempotencyKey: "cancelled-1",
      status: "SENT",
      sentAt: NOW,
    });
    const interest = canonicalizeEmail("ana.pop@gmail.com");
    await db.insert(registrationInterests).values({
      eventId,
      deliveryEmail: interest.deliveryEmail,
      canonicalEmail: interest.canonicalEmail,
      canonicalizationVersion: interest.canonicalizationVersion,
      locale: "ro",
    });
  });

  it("finds the person by the canonical address, whichever spelling was typed", async () => {
    const admin = await staff("ADMIN");

    const data = await viewPersonData(db, admin, canonicalLookupOf("ANA.POP+other@gmail.com"), NOW);

    expect(data.participant?.id).toBe(participantId);
    // Every registration in every status, with every stored column — the consents and their versions included.
    expect(data.registrations).toHaveLength(1);
    expect(data.registrations[0]).toMatchObject({
      id: registrationId,
      status: "CANCELLED",
      city: "Brașov",
      healthNotes: "astm",
      privacyNoticeVersion: 3,
      listOptOut: true,
    });
    expect(data.messages.map((message) => [message.messageType, message.status])).toEqual([["REGISTRATION_CANCELLED", "SENT"]]);
    // The "Anunță-mă" address is matched the same way, and it is its own row: no participant.
    expect(data.announcementRequests).toHaveLength(1);

    // Viewing is a read of the emergency details, recorded for each registration shown.
    const trail = await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.health_viewed"));
    expect(trail.map((entry) => [entry.actorStaffUserId, entry.entityId, entry.metadataJson])).toEqual([
      [admin.id, registrationId, { via: "PERSON_VIEW" }],
    ]);
  });

  it("records the file as an export, with counts and no value", async () => {
    const admin = await staff("SUPERADMIN");

    const data = await exportPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW);

    expect(data.registrations).toHaveLength(1);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect([entry.actorStaffUserId, entry.entityType, entry.entityId]).toEqual([admin.id, "participant", participantId]);
    expect(entry.metadataJson).toEqual({ registrations: 1, declarationAcceptances: 0, messages: 1, announcementRequests: 1, auditRows: 0 });
    expect(JSON.stringify(entry.metadataJson)).not.toMatch(/astm|gmail|Ana/);
  });

  /**
   * §322 — the export's row is about the person, so it carries their uuid in `entity_id` as well
   * as in `participant_id`. The foreign key nulls only the second when the participant row goes;
   * erasing the last registration must take the first as well.
   */
  it("forgets whose file it was when the erasure takes the person's last registration", async () => {
    const admin = await staff("ADMIN");
    await exportPersonData(db, admin, canonicalLookupOf("ana.pop@gmail.com"), NOW);

    await deleteRegistrationByStaff(db, admin, registrationId, "cerere de ștergere", NOW);

    expect(await db.select().from(participants).where(eq(participants.id, participantId))).toHaveLength(0);
    const [entry] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
    expect([entry.actorStaffUserId, entry.entityType, entry.participantId, entry.entityId]).toEqual([admin.id, "participant", null, null]);
    // The row still says a file was made, and of how much.
    expect(entry.metadataJson).toMatchObject({ registrations: 1 });
    const trail = await db.select().from(auditLogs);
    expect(JSON.stringify(trail)).not.toContain(participantId);
  });

  it.each(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV"] as const)("is refused to a %s (BR-REQ-060-01)", async (role) => {
    const actor = await staff(role);
    const canonical = canonicalLookupOf("ana.pop@gmail.com");

    for (const call of [viewPersonData(db, actor, canonical, NOW), exportPersonData(db, actor, canonical, NOW)]) {
      await expect(call).rejects.toSatisfy((error: unknown) => isDomainError(error) && error.code === "FORBIDDEN");
    }
    expect(await db.select().from(auditLogs)).toHaveLength(0);
  });

  it("refuses an address the canonicalizer refuses, as a field error", () => {
    expect(() => canonicalLookupOf("not an address")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }));
  });

  it("carries the address sealed, never readable, and only for half an hour", () => {
    const sealed = sealPersonLookup("ana.pop@gmail.com", NOW) ?? "";

    expect(sealed).not.toContain("ana");
    expect(openPersonLookup(sealed, NOW)).toBe("ana.pop@gmail.com");
    expect(openPersonLookup(sealed, new Date(NOW.getTime() + (PERSON_LOOKUP_MINUTES - 1) * 60_000))).toBe("ana.pop@gmail.com");
    expect(openPersonLookup(sealed, new Date(NOW.getTime() + (PERSON_LOOKUP_MINUTES + 1) * 60_000))).toBeNull();
    // Tampered or made for something else: nothing.
    expect(openPersonLookup(`${sealed.slice(0, -2)}xx`, NOW)).toBeNull();
    expect(openPersonLookup("ana.pop@gmail.com", NOW)).toBeNull();
  });
});
