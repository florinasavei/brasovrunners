import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { findOrCreateParticipant } from "@/modules/participants/repository";
import { resendFamilyMessage } from "@/modules/registrations/admin-service";
import { familiesTogether } from "@/modules/registrations/family-marker";
import { insertPendingEmailRegistration } from "@/modules/registrations/repository";
import { confirmEmailOnAddress, type EventForRegistration } from "@/modules/registrations/service";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — one click of a verification link proves the inbox, not one person: every registration of
 * the address at the event still waiting for it, sent before the click, moves on with it, through
 * the one allocator; a form sent after the click still waits for its own. And «Retrimite familiei»
 * sends the address one email, Administrator only. Made-up people throughout.
 */
const NOW = new Date("2026-09-30T14:30:00.000Z");
const MINUTE = 60_000;

async function approveLegalDocuments(db: TestDatabase) {
  const text: LegalDocumentTranslationInput[] = [
    { locale: "ro", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
    { locale: "en", title: "Text", body: { sections: [{ paragraphs: ["p"] }] } },
  ];
  for (const key of ["TERMS", "PRIVACY_NOTICE", "EVENT_DECLARATION"] as const) {
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

describe("§NNN one click confirms the whole address", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approveLegalDocuments(db);
  });

  async function event(capacity: number | null): Promise<EventForRegistration> {
    const [row] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date("2026-10-20T09:00:00.000Z"), registrationMode: "INTERNAL", capacity })
      .returning();
    return {
      id: row.id,
      eventStatus: row.eventStatus,
      registrationMode: "INTERNAL",
      startsAt: row.startsAt,
      registrationOpensAt: row.registrationOpensAt,
      registrationClosesAt: row.registrationClosesAt,
      capacity,
      raceId: null,
      publishedAt: NOW,
    };
  }

  /** One address, one pending registration per name, each submitted at its own instant. */
  async function family(target: EventForRegistration, email: string, people: ReadonlyArray<[string, Date]>) {
    const participant = await findOrCreateParticipant(db, canonicalizeEmail(email), people[0][0], "ro", NOW);
    const ids: string[] = [];
    for (const [name, at] of people) {
      const row = await insertPendingEmailRegistration(db, {
        eventId: target.id,
        participantId: participant.id,
        locale: "ro",
        registeredName: name,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: at,
        raceId: null,
        resultsNameConsent: false,
        resultsConsentVersion: 1,
        listOptOut: false,
        emailLinkExpiresAt: new Date(at.getTime() + 48 * 60 * MINUTE),
        now: at,
      });
      await db.update(registrations).set({ submittedAt: at }).where(eq(registrations.id, row.id));
      ids.push(row.id);
    }
    return ids;
  }

  async function statuses(ids: readonly string[]) {
    const rows = await db.select({ id: registrations.id, status: registrations.status }).from(registrations).where(inArray(registrations.id, [...ids]));
    return ids.map((id) => rows.find((row) => row.id === id)?.status);
  }

  it("moves every earlier registration on the address with the click, and leaves one sent after it waiting", async () => {
    const target = await event(10);
    const [first, second, later] = await family(target, "familia@example.ro", [
      ["Ioana Test", new Date(NOW.getTime() - 5 * MINUTE)],
      ["Radu Test", new Date(NOW.getTime() - 4 * MINUTE)],
      ["Sorin Test", new Date(NOW.getTime() + MINUTE)],
    ]);

    // The owner's case: the second person's link is the one clicked.
    const result = await confirmEmailOnAddress(db, target, second, NOW);

    expect(result.registration.id).toBe(second);
    expect(result.alsoConfirmed.map((row) => row.id)).toEqual([first]);
    const [a, b, c] = await statuses([first, second, later]);
    expect(a).not.toBe("PENDING_EMAIL_CONFIRMATION");
    expect(b).not.toBe("PENDING_EMAIL_CONFIRMATION");
    expect(c).toBe("PENDING_EMAIL_CONFIRMATION");
  });

  it("never overbooks: one place left goes to the clicked person, the other joins the waiting list", async () => {
    const target = await event(1);
    const [first, second] = await family(target, "doi@example.ro", [
      ["Ioana Test", new Date(NOW.getTime() - 5 * MINUTE)],
      ["Radu Test", new Date(NOW.getTime() - 4 * MINUTE)],
    ]);

    await confirmEmailOnAddress(db, target, second, NOW);

    const [a, b] = await statuses([first, second]);
    expect(b).toBe("PENDING_DECLARATION");
    expect(a).toBe("WAITLISTED");
  });

  it("«Retrimite familiei» queues one email for the address, Administrator only, and is audited", async () => {
    const target = await event(10);
    const [first, second] = await family(target, "trei@example.ro", [
      ["Ioana Test", new Date(NOW.getTime() - 5 * MINUTE)],
      ["Radu Test", new Date(NOW.getTime() - 4 * MINUTE)],
    ]);
    const [admin] = await db.insert(staffUsers).values({ email: "admin@example.ro", displayName: "Admin", role: "ADMIN" }).returning();

    await expect(resendFamilyMessage(db, { id: admin.id, role: "MODERATOR" }, second, NOW)).rejects.toSatisfy(
      (error: unknown) => isDomainError(error) && error.code === "FORBIDDEN",
    );
    await resendFamilyMessage(db, { id: admin.id, role: "ADMIN" }, second, NOW);

    const queued = await db.select().from(emailOutbox).where(inArray(emailOutbox.registrationId, [first, second]));
    expect(queued.filter((row) => row.messageType === "VERIFY_REGISTRATION_EMAIL")).toHaveLength(1);
    // The earliest waiting person's link: its one click confirms both.
    expect(queued[0].registrationId).toBe(first);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "registration.family_resent"), eq(auditLogs.entityId, second)));
    expect(audit).toHaveLength(1);

    // The list keeps a family together where its first row falls.
    const rows = [
      { id: "1", participantId: "p", eventId: "e" },
      { id: "2", participantId: "q", eventId: "e" },
      { id: "3", participantId: "p", eventId: "e" },
    ];
    expect(familiesTogether(rows).map((row) => row.id)).toEqual(["1", "3", "2"]);
  });
});
