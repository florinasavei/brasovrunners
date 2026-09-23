import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { computeContentHash } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { pruneExpiredRows, RETENTION } from "@/modules/jobs/retention";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * The retention sweep (`AGENTS.md` §16.2, `DECISIONS.md` §45).
 *
 * Every test here is really the same test asked twice: **does it delete the spent row, and does
 * it leave the live one standing?** A sweep that is too eager is worse than no sweep — it breaks
 * a link somebody has in their inbox, or removes the bounce an organizer is trying to explain —
 * so each case below pairs one row that should go with one that must not.
 */
const NOW = new Date("2026-09-06T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60_000);

describe("retention sweep", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let participantId: string;
  let registrationId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);

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
    participantId = participant.id;

    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: new Date("2026-10-01T09:00:00.000Z"),
        registrationMode: "INTERNAL",
      })
      .returning();

    const [registration] = await db
      .insert(registrations)
      .values({
        eventId: event.id,
        participantId,
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Ana Pop",
        displayName: "Ana P.",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    registrationId = registration.id;
  });

  it("keeps recent job runs and deletes the ones past the window", async () => {
    await db.insert(jobRuns).values([
      { jobName: "email-outbox", startedAt: daysAgo(RETENTION.jobRunsDays + 1) },
      { jobName: "email-outbox", startedAt: daysAgo(1) },
    ]);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.jobRuns).toBe(1);
    const remaining = await db.select().from(jobRuns);
    expect(remaining).toHaveLength(1);
    // The newest survives, which is the only one /api/health ever reads.
    expect(remaining[0].startedAt).toEqual(daysAgo(1));
  });

  it("deletes throttle buckets whose window has passed", async () => {
    await db.insert(rateLimitBuckets).values([
      { scope: "registration-submit", key: "old", windowStartsAt: daysAgo(3), count: 5 },
      { scope: "registration-submit", key: "live", windowStartsAt: NOW, count: 1 },
    ]);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.rateLimitBuckets).toBe(1);
    const [survivor] = await db.select().from(rateLimitBuckets);
    expect(survivor.key).toBe("live");
  });

  it("deletes a token thirty days after it was used, and never one that is still live in somebody's inbox", async () => {
    await db.insert(emailActionTokens).values([
      {
        // Used thirty-one days ago, with an expiry still months ahead (§322): it can never be
        // accepted again, and the old rule kept it until that expiry.
        participantId,
        registrationId,
        purpose: "MANAGE_REGISTRATION",
        tokenHash: "a".repeat(64),
        // `created_at` is explicit throughout: the table refuses a token that expires before it
        // was created, and these fixtures back-date expiry.
        createdAt: daysAgo(40),
        expiresAt: new Date(NOW.getTime() + 60 * 24 * 60 * 60_000),
        usedAt: daysAgo(RETENTION.spentTokensDays + 1),
      },
      {
        // Used yesterday: inside the thirty days, kept to answer "did this link work?".
        participantId,
        registrationId,
        purpose: "WAITLIST_OFFER",
        tokenHash: "d".repeat(64),
        createdAt: daysAgo(2),
        expiresAt: daysAgo(1),
        usedAt: daysAgo(1),
      },
      {
        // Expired an hour ago and never used: still inside the window, so it stays as evidence
        // that the link existed at all.
        participantId,
        registrationId,
        purpose: "MANAGE_REGISTRATION",
        tokenHash: "b".repeat(64),
        createdAt: daysAgo(1),
        expiresAt: new Date(NOW.getTime() - 60 * 60_000),
      },
      {
        // The one that must never be touched: unexpired, so the link still works. Its own
        // purpose because the table allows only one *active* token per registration and
        // purpose, and the row above is active too.
        participantId,
        registrationId,
        purpose: "COMPLETE_DECLARATION",
        tokenHash: "c".repeat(64),
        createdAt: daysAgo(1),
        expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60_000),
      },
    ]);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.actionTokens).toBe(1);
    expect(counts.failures).toEqual([]);
    const hashes = (await db.select().from(emailActionTokens)).map((row) => row.tokenHash);
    expect(hashes.sort()).toEqual(["b".repeat(64), "c".repeat(64), "d".repeat(64)]);
  });

  it("deletes long-sent messages and keeps the ones somebody investigates", async () => {
    await db.insert(emailOutbox).values([
      {
        participantId,
        registrationId,
        messageType: "REGISTRATION_CONFIRMED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "old-sent",
        status: "SENT",
        sentAt: daysAgo(RETENTION.sentOutboxDays + 1),
      },
      {
        participantId,
        registrationId,
        messageType: "REGISTRATION_CONFIRMED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "old-bounced",
        status: "BOUNCED",
        sentAt: daysAgo(RETENTION.sentOutboxDays + 1),
      },
      {
        participantId,
        registrationId,
        messageType: "REGISTRATION_CONFIRMED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "recent-sent",
        status: "SENT",
        sentAt: daysAgo(1),
      },
    ]);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.outboxMessages).toBe(1);
    const keys = (await db.select().from(emailOutbox)).map((row) => row.idempotencyKey).sort();
    // The bounce stays however old it is: it is the row an organizer goes looking for.
    expect(keys).toEqual(["old-bounced", "recent-sent"]);
  });

  it("keeps a registration for three years after its event, then removes it with the participant — never the event", async () => {
    const year = 365.25 * 24 * 60 * 60_000;
    // Two years and eleven months after the event (2026-10-01): still the club's record.
    const before = await pruneExpiredRows(db, new Date(Date.UTC(2029, 8, 1)));
    expect(before.registrations).toBe(0);
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(1);
    expect(await db.select().from(participants)).toHaveLength(1);

    // Past three years (`DECISIONS.md` §95, the limitation period): the registration, the
    // declaration and the participant go; the event stays — it is the club's history.
    const after = await pruneExpiredRows(db, new Date(Date.UTC(2026, 9, 1) + 3 * year + 24 * 60 * 60_000));
    expect(after.registrations).toBe(1);
    expect(after.participants).toBe(1);
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(0);
    expect(await db.select().from(participants)).toHaveLength(0);
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("is safe to run again, which it is every five minutes", async () => {
    await db.insert(jobRuns).values({ jobName: "email-outbox", startedAt: daysAgo(60) });

    expect((await pruneExpiredRows(db, NOW)).jobRuns).toBe(1);
    expect((await pruneExpiredRows(db, NOW)).jobRuns).toBe(0);
  });

  it("takes the identity document and the health note out seven days after the event, and the audit log after three years (§95)", async () => {
    const translations = [
      { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["{{idDocument}}"] }] } },
      { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["{{idDocument}}"] }] } },
    ];
    const version = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: NOW,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    await db.insert(declarationAcceptances).values({
      registrationId,
      legalDocumentId: version,
      declarationVersion: 1,
      contentSha256: computeContentHash(translations),
      locale: "ro",
      typedName: "Ana Pop",
      idDocument: "BV 123456",
      acceptedAt: NOW,
    });
    await db.update(registrations).set({ healthNotes: "astm", healthConsentVersion: 1, healthConsentAt: NOW }).where(eq(registrations.id, registrationId));
    await db.insert(auditLogs).values({ actorStaffUserId: null, action: "registration.cancelled_by_staff", entityType: "registration", entityId: registrationId, metadataJson: {}, createdAt: NOW });

    // Six days after the event (2026-10-01): everything still there.
    const soon = await pruneExpiredRows(db, new Date("2026-10-07T09:00:00.000Z"));
    expect(soon.identityDocuments).toBe(0);
    expect((await db.select().from(declarationAcceptances))[0].idDocument).toBe("BV 123456");

    // Eight days after: the two fields go; the rows stay.
    const later = await pruneExpiredRows(db, new Date("2026-10-09T10:00:00.000Z"));
    expect(later.identityDocuments).toBe(1);
    expect(later.healthNotes).toBe(1);
    const [acceptance] = await db.select().from(declarationAcceptances);
    expect(acceptance.idDocument).toBeNull();
    expect(acceptance.typedName).toBe("Ana Pop");
    const [registration] = await db.select().from(registrations).where(eq(registrations.id, registrationId));
    expect(registration.healthNotes).toBeNull();
    expect(registration.healthConsentAt).toBeNull();
    expect(later.auditLogs).toBe(0);

    // Three years and a day after the action: the audit row goes.
    const old = await pruneExpiredRows(db, new Date("2029-09-07T12:00:00.000Z"));
    expect(old.auditLogs).toBe(1);
  });

  /** A participant of their own, so the orphan-participant delete is visible in the counts. */
  async function participant(email: string): Promise<string> {
    const identity = canonicalizeEmail(email);
    const [row] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: email,
      })
      .returning();
    return row.id;
  }

  async function lapsedRegistration(email: string, expiredDaysAgo: number): Promise<string> {
    const [{ eventId }] = await db.select({ eventId: registrations.eventId }).from(registrations).where(eq(registrations.id, registrationId));
    const [row] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: await participant(email),
        status: "EXPIRED",
        expiryReason: "EMAIL_CONFIRMATION_LAPSED",
        expiredAt: daysAgo(expiredDaysAgo),
        locale: "ro",
        registeredName: email,
        displayName: email,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: daysAgo(expiredDaysAgo + 2),
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    return row.id;
  }

  /**
   * §322 — "an address never confirmed, a place never held: nothing to prove". A registration
   * whose email link lapsed goes thirty days after it lapsed, with the participant it leaves
   * behind; one inside the thirty days stays, and so does a registration that lapsed for any
   * other reason.
   */
  it("deletes a registration whose address lapsed unconfirmed thirty days ago, and keeps a younger one", async () => {
    const old = await lapsedRegistration("old@example.ro", RETENTION.unconfirmedRegistrationDays + 1);
    const young = await lapsedRegistration("young@example.ro", RETENTION.unconfirmedRegistrationDays - 1);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.failures).toEqual([]);
    expect(counts.unconfirmedRegistrations).toBe(1);
    expect(counts.participants).toBe(1);
    expect(await db.select().from(registrations).where(eq(registrations.id, old))).toHaveLength(0);
    expect(await db.select().from(registrations).where(eq(registrations.id, young))).toHaveLength(1);
    // The confirmed registration of the fixture is untouched, and so is its participant.
    expect(await db.select().from(registrations).where(eq(registrations.id, registrationId))).toHaveLength(1);
    expect(await db.select().from(participants).where(eq(participants.id, participantId))).toHaveLength(1);
  });

  /**
   * §322 — a message about nobody (no registration, no participant) has no row that will ever
   * take it away with it, so it goes ninety days after it was queued, whatever its status.
   */
  it("deletes a message about nobody after ninety days, whatever its status", async () => {
    await db.insert(emailOutbox).values([
      {
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_OPENED",
        locale: "ro",
        recipientEmail: "interest@example.ro",
        payloadJson: {},
        idempotencyKey: "orphan-old-bounced",
        status: "BOUNCED",
        createdAt: daysAgo(RETENTION.orphanOutboxDays + 1),
      },
      {
        participantId: null,
        registrationId: null,
        messageType: "REGISTRATION_OPENED",
        locale: "ro",
        recipientEmail: "interest@example.ro",
        payloadJson: {},
        idempotencyKey: "orphan-recent-bounced",
        status: "BOUNCED",
        createdAt: daysAgo(RETENTION.orphanOutboxDays - 1),
      },
      {
        // As old, but about somebody: the registration takes it with it, not this rule.
        participantId,
        registrationId,
        messageType: "REGISTRATION_CONFIRMED",
        locale: "ro",
        recipientEmail: "ana@example.ro",
        payloadJson: {},
        idempotencyKey: "registration-old-bounced",
        status: "BOUNCED",
        createdAt: daysAgo(RETENTION.orphanOutboxDays + 1),
      },
    ]);

    const counts = await pruneExpiredRows(db, NOW);

    expect(counts.orphanOutboxMessages).toBe(1);
    const keys = (await db.select().from(emailOutbox)).map((row) => row.idempotencyKey).sort();
    expect(keys).toEqual(["orphan-recent-bounced", "registration-old-bounced"]);
  });

  /**
   * §322 — each step on its own, and the seven-day clearing first. A three-year step that throws
   * (here: the database refusing to delete a declaration, as a lock timeout or a constraint
   * would) is reported by name, and the identity documents are still cleared and the audit log
   * still pruned.
   */
  it("clears identity documents and runs the later steps even when the three-year step throws", async () => {
    const translations = [
      { locale: "ro" as const, title: "Declarație", body: { sections: [{ paragraphs: ["{{idDocument}}"] }] } },
      { locale: "en" as const, title: "Declaration", body: { sections: [{ paragraphs: ["{{idDocument}}"] }] } },
    ];
    const version = await insertLegalDocumentVersion(db, {
      key: "EVENT_DECLARATION",
      version: 1,
      effectiveAt: NOW,
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
    // An event four years ago, whose registration the three-year step will try to delete.
    const [oldEvent] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2022-09-01T09:00:00.000Z"), registrationMode: "INTERNAL" })
      .returning();
    const [oldRegistration] = await db
      .insert(registrations)
      .values({
        eventId: oldEvent.id,
        participantId: await participant("veteran@example.ro"),
        status: "CONFIRMED",
        locale: "ro",
        registeredName: "Veteran",
        displayName: "Veteran",
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: new Date("2022-08-01T09:00:00.000Z"),
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
      })
      .returning();
    for (const id of [oldRegistration.id]) {
      await db.insert(declarationAcceptances).values({
        registrationId: id,
        legalDocumentId: version,
        declarationVersion: 1,
        contentSha256: computeContentHash(translations),
        locale: "ro",
        typedName: "Veteran",
        idDocument: "BV 999999",
        acceptedAt: new Date("2022-08-02T09:00:00.000Z"),
      });
    }
    await db.insert(auditLogs).values({
      actorStaffUserId: null,
      action: "registration.cancelled_by_staff",
      entityType: "registration",
      entityId: oldRegistration.id,
      metadataJson: {},
      createdAt: new Date("2022-08-03T09:00:00.000Z"),
    });

    // The stub: the database refuses to delete any declaration while the trigger exists.
    await db.execute(sql`CREATE OR REPLACE FUNCTION refuse_declaration_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'stubbed failure'; END $$ LANGUAGE plpgsql`);
    await db.execute(sql`CREATE TRIGGER refuse_declaration_delete BEFORE DELETE ON declaration_acceptances FOR EACH ROW EXECUTE FUNCTION refuse_declaration_delete()`);
    try {
      const counts = await pruneExpiredRows(db, NOW);

      expect(counts.failures.map((failure) => failure.step)).toEqual(["registrations-after-event"]);
      // The seven-day clearing ran, and ran first.
      expect(counts.identityDocuments).toBe(1);
      const [acceptance] = await db.select().from(declarationAcceptances).where(eq(declarationAcceptances.registrationId, oldRegistration.id));
      expect(acceptance.idDocument).toBeNull();
      // The failed step rolled back as a whole: the registration is still there.
      expect(await db.select().from(registrations).where(eq(registrations.id, oldRegistration.id))).toHaveLength(1);
      // And the step after it still ran.
      expect(counts.auditLogs).toBe(1);
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS refuse_declaration_delete ON declaration_acceptances`);
      await db.execute(sql`DROP FUNCTION IF EXISTS refuse_declaration_delete()`);
    }
  });
});
