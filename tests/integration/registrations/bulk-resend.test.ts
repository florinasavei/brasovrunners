import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import { readActionTokenContext } from "@/modules/action-tokens/repository";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { consumeRateLimit, RATE_LIMITS, readRateLimitCounts } from "@/modules/rate-limit/service";
import {
  BULK_RESEND_CLOSED,
  BULK_RESEND_LIMITED,
  resendDeclarationToAllPending,
  resendRegistrationMessage,
} from "@/modules/registrations/admin-service";
import { previewDeclarationResend } from "@/modules/registrations/bulk-resend";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-02, §606 (amending §540) — «Retrimite declarația tuturor care nu au semnat»: one press
 * queues a fresh `COMPLETE_DECLARATION` for every registration of the event still waiting to sign,
 * through the single resend's own path (the registration's hourly limit, `isManualResend`), skipping
 * — and counting — those whose declaration email is still queued or left within the hour, and those
 * whose limit is spent. One audit row for the press, three presses an hour per event, Administrator
 * only, and no registration's state moves (§79).
 */
const NOW = new Date("2026-09-04T10:05:00.000Z");
const MINUTE = 60_000;

describe("§606 the declaration resent to everyone who has not signed, in one press", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let adminId: string;
  let eventId: string;
  const admin = () => ({ id: adminId, role: "ADMIN" as const });

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  beforeEach(async () => {
    await resetTables(db);
    const [staff] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    adminId = staff.id;
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-10-01T09:00:00.000Z"), registrationMode: "INTERNAL", capacity: 50 })
      .returning();
    eventId = event.id;
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "crosul-retrimiterii", title: "Crosul retrimiterii", excerpt: "x" },
      { eventId, locale: "en", slug: "resend-cross", title: "The resend cross", excerpt: "x" },
    ]);
  });

  /** One person on their own address, registered at the event in `status`. */
  async function person(name: string, status: "PENDING_DECLARATION" | "CONFIRMED", kind: "REAL" | "TEST" = "REAL") {
    const identity = canonicalizeEmail(`${name.toLowerCase()}@example.ro`);
    const [participant] = await db
      .insert(participants)
      .values({
        deliveryEmail: identity.deliveryEmail,
        normalizedEmail: identity.normalizedEmail,
        canonicalEmail: identity.canonicalEmail,
        canonicalizationVersion: identity.canonicalizationVersion,
        defaultName: `${name} Pop`,
      })
      .returning();
    const [registration] = await db
      .insert(registrations)
      .values({
        eventId,
        participantId: participant.id,
        status,
        kind,
        locale: "ro",
        registeredName: `${name} Pop`,
        displayName: `${name} P.`,
        privacyNoticeVersion: 1,
        privacyAcknowledgedAt: NOW,
        resultsNameConsent: false,
        listOptOut: false,
        resultsConsentVersion: 1,
        holdExpiresAt: status === "PENDING_DECLARATION" ? new Date(NOW.getTime() + 30 * MINUTE) : null,
        confirmedAt: status === "CONFIRMED" ? NOW : null,
      })
      .returning();
    return { registration, participant };
  }

  /** A declaration email of the participant's own, as the lifecycle queued it: still waiting, or left at `sentAt`. */
  async function declarationEmail(who: Awaited<ReturnType<typeof person>>, sentAt: Date | null) {
    await db.insert(emailOutbox).values({
      participantId: who.participant.id,
      registrationId: who.registration.id,
      messageType: "COMPLETE_DECLARATION",
      locale: "ro",
      recipientEmail: who.participant.deliveryEmail,
      payloadJson: {},
      idempotencyKey: `registration:${who.registration.id}:declaration:${(sentAt ?? NOW).toISOString()}`,
      status: sentAt ? "SENT" : "PENDING",
      createdAt: new Date((sentAt ?? NOW).getTime() - MINUTE),
      sentAt,
    });
  }

  /** The brief's event: five waiting to sign, one confirmed, one whose email left ten minutes ago, one still queued. */
  async function theEvent() {
    const pending = [];
    for (const name of ["Ana", "Bogdan", "Corina", "Dan", "Elena"]) pending.push(await person(name, "PENDING_DECLARATION"));
    const confirmed = await person("Florin", "CONFIRMED");
    const justSent = await person("Gabriela", "PENDING_DECLARATION");
    await declarationEmail(justSent, new Date(NOW.getTime() - 10 * MINUTE));
    const stillQueued = await person("Horia", "PENDING_DECLARATION");
    await declarationEmail(stillQueued, null);
    return { pending, confirmed, justSent, stillQueued };
  }

  const manualResends = () =>
    db
      .select()
      .from(emailOutbox)
      .where(and(eq(emailOutbox.isManualResend, true), eq(emailOutbox.messageType, "COMPLETE_DECLARATION")));
  const audit = (action: "registration.bulk_resend" | "registration.bulk_resend_rate_limited") =>
    db.select().from(auditLogs).where(eq(auditLogs.action, action));
  const refusedWith = (code: string, field?: string) => (error: unknown) =>
    isDomainError(error) && error.code === code && (field === undefined || error.fields.includes(field));

  it("queues the declaration for exactly the five waiting, each a manual resend, and audits the press with its counts", async () => {
    const { pending, confirmed, justSent, stillQueued } = await theEvent();

    const result = await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    expect(result).toEqual({ queued: 5, skippedRecent: 2, skippedLimited: 0, test: { queued: 0, skippedRecent: 0, skippedLimited: 0 } });

    const rows = (await manualResends()).filter((row) => row.participantId !== null);
    expect(rows.map((row) => row.registrationId).sort()).toEqual(pending.map((who) => who.registration.id).sort());
    for (const row of rows) {
      expect(row.requestedByStaffUserId).toBe(adminId);
      expect(row.status).toBe("PENDING");
      // Per registration and per press instant (§12.11): a deliberate resend is its own trigger.
      expect(row.idempotencyKey).toBe(`registration:${row.registrationId}:manual-resend:${NOW.toISOString()}`);
    }
    for (const left of [confirmed, justSent, stillQueued]) {
      expect(rows.some((row) => row.registrationId === left.registration.id)).toBe(false);
    }

    // Each row as the single press leaves it, under the queue (§540): its outbox row and the hour's count — no «now» row.
    expect(await db.select().from(auditLogs).where(eq(auditLogs.action, "registration.sent_now"))).toHaveLength(0);
    const spent = await readRateLimitCounts(db, "admin-resend", pending.map((who) => who.registration.id), NOW);
    for (const who of pending) expect(spent.get(who.registration.id)).toBe(1);

    const [press] = await audit("registration.bulk_resend");
    expect(press).toMatchObject({ actorStaffUserId: adminId, entityType: "event", entityId: eventId, participantId: null });
    expect(press.metadataJson).toMatchObject({ queued: 5, skippedRecent: 2, skippedLimited: 0 });
    // Never a name or an address on the press's row.
    expect(JSON.stringify(press.metadataJson)).not.toMatch(/@|Pop/);
  });

  it("changes no registration's state, hold or deadline (§79)", async () => {
    await theEvent();
    const before = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    const after = await db.select().from(registrations).where(eq(registrations.eventId, eventId));
    const shape = (rows: typeof before) =>
      rows.map((row) => ({ id: row.id, status: row.status, holdExpiresAt: row.holdExpiresAt, confirmedAt: row.confirmedAt })).sort((a, b) => a.id.localeCompare(b.id));
    expect(shape(after)).toEqual(shape(before));
  });

  it("says before the press what the press does: the preview's counts are the press's own", async () => {
    await theEvent();
    const preview = await previewDeclarationResend(db, eventId, NOW);
    expect(preview).toEqual({
      pending: 7,
      counts: { queued: 5, skippedRecent: 2, skippedLimited: 0 },
      testPending: 0,
      testCounts: { queued: 0, skippedRecent: 0, skippedLimited: 0 },
      refusal: null,
    });
    // Reading wrote nothing: no outbox row, no limit spent (GET mutates nothing).
    expect(await manualResends()).toHaveLength(0);
    expect((await readRateLimitCounts(db, "admin-bulk-resend", [eventId], NOW)).size).toBe(0);
    const result = await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    expect({ queued: result.queued, skippedRecent: result.skippedRecent, skippedLimited: result.skippedLimited }).toEqual(preview?.counts);
  });

  it("a second press within the hour queues nothing: the first press's emails are still queued", async () => {
    await theEvent();
    await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    const second = await resendDeclarationToAllPending(db, admin(), eventId, new Date(NOW.getTime() + 5 * MINUTE));
    expect(second).toMatchObject({ queued: 0, skippedRecent: 7, skippedLimited: 0 });
    expect((await manualResends()).filter((row) => row.participantId !== null)).toHaveLength(5);
    // And once those have left, still nothing within the hour of their leaving.
    await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(NOW.getTime() + 6 * MINUTE) }).where(eq(emailOutbox.isManualResend, true));
    const third = await resendDeclarationToAllPending(db, admin(), eventId, new Date(NOW.getTime() + 7 * MINUTE));
    expect(third).toMatchObject({ queued: 0, skippedRecent: 7 });
  });

  it("skips and counts a registration whose own resend limit is spent", async () => {
    const { pending } = await theEvent();
    // Three of the five have had the hour's five resends already (the single press, five times).
    for (const who of pending.slice(0, 3)) {
      for (let i = 0; i < RATE_LIMITS["admin-resend"].limit; i++) await consumeRateLimit(db, "admin-resend", who.registration.id, NOW);
    }
    expect((await previewDeclarationResend(db, eventId, NOW))?.counts).toEqual({ queued: 2, skippedRecent: 2, skippedLimited: 3 });
    const result = await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    expect(result).toMatchObject({ queued: 2, skippedRecent: 2, skippedLimited: 3 });
    const rows = (await manualResends()).filter((row) => row.participantId !== null);
    expect(rows.map((row) => row.registrationId).sort()).toEqual(pending.slice(3).map((who) => who.registration.id).sort());
    // A skip is not a refused attempt: the spent counters did not move.
    const counts = await readRateLimitCounts(db, "admin-resend", pending.slice(0, 3).map((who) => who.registration.id), NOW);
    for (const who of pending.slice(0, 3)) expect(counts.get(who.registration.id)).toBe(RATE_LIMITS["admin-resend"].limit);
    const [press] = await audit("registration.bulk_resend");
    expect(press.metadataJson).toMatchObject({ queued: 2, skippedRecent: 2, skippedLimited: 3 });
  });

  it("allows three presses an hour per event and refuses the fourth, recording the refusal", async () => {
    await theEvent();
    for (let press = 0; press < 3; press++) await resendDeclarationToAllPending(db, admin(), eventId, new Date(NOW.getTime() + press * MINUTE));
    expect((await previewDeclarationResend(db, eventId, new Date(NOW.getTime() + 3 * MINUTE)))?.refusal).toBe("limited");
    await expect(resendDeclarationToAllPending(db, admin(), eventId, new Date(NOW.getTime() + 3 * MINUTE))).rejects.toSatisfy(
      refusedWith("VALIDATION_ERROR", BULK_RESEND_LIMITED),
    );
    expect(await audit("registration.bulk_resend")).toHaveLength(3);
    const [refused] = await audit("registration.bulk_resend_rate_limited");
    expect(refused).toMatchObject({ actorStaffUserId: adminId, entityType: "event", entityId: eventId });
    expect(refused.metadataJson).toMatchObject({ count: 4, limit: 3 });
  });

  it("refuses an Organizer, and every role below the Administrator, with nothing queued", async () => {
    await theEvent();
    for (const role of ["MODERATOR", "COPYWRITER", "CONTRIBUTOR", "DEV"] as const) {
      await expect(resendDeclarationToAllPending(db, { id: adminId, role }, eventId, NOW)).rejects.toSatisfy(refusedWith("FORBIDDEN"));
    }
    expect(await manualResends()).toHaveLength(0);
    expect((await readRateLimitCounts(db, "admin-bulk-resend", [eventId], NOW)).size).toBe(0);
  });

  it("refuses a cancelled, a completed and a started event, spending none of the hour's presses", async () => {
    await theEvent();
    for (const change of [{ eventStatus: "CANCELLED" as const }, { eventStatus: "COMPLETED" as const }, { startsAt: new Date(NOW.getTime() - MINUTE) }]) {
      await db.update(events).set({ eventStatus: "SCHEDULED", startsAt: new Date("2026-10-01T09:00:00.000Z"), ...change }).where(eq(events.id, eventId));
      expect((await previewDeclarationResend(db, eventId, NOW))?.refusal).toBe("closed");
      await expect(resendDeclarationToAllPending(db, admin(), eventId, NOW)).rejects.toSatisfy(refusedWith("VALIDATION_ERROR", BULK_RESEND_CLOSED));
    }
    expect(await manualResends()).toHaveLength(0);
    expect(await audit("registration.bulk_resend")).toHaveLength(0);
    expect((await readRateLimitCounts(db, "admin-bulk-resend", [eventId], NOW)).size).toBe(0);
  });

  it("sends to a test registration exactly as to a real one, and counts it apart (§12.6)", async () => {
    await theEvent();
    const test = await person("Ioana", "PENDING_DECLARATION", "TEST");
    const result = await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    expect(result).toEqual({ queued: 5, skippedRecent: 2, skippedLimited: 0, test: { queued: 1, skippedRecent: 0, skippedLimited: 0 } });
    expect((await manualResends()).some((row) => row.registrationId === test.registration.id)).toBe(true);
  });

  it("leaves the single resend as it was: its own press still queues the state's message", async () => {
    const { pending } = await theEvent();
    await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    // Another instant, another trigger: the single press is not refused by the bulk one's row.
    await resendRegistrationMessage(db, admin(), pending[0].registration.id, new Date(NOW.getTime() + MINUTE));
    const rows = (await manualResends()).filter((row) => row.registrationId === pending[0].registration.id && row.participantId !== null);
    expect(rows).toHaveLength(2);
  });

  it("each resent email carries a new working link, and the earlier link stops working", async () => {
    const { pending } = await theEvent();
    const who = pending[0];
    const secretOf = async (sentAt: Date) => {
      const [row] = (await manualResends()).filter((candidate) => candidate.registrationId === who.registration.id && candidate.status === "PENDING");
      const message = await renderOutboxMessage({ ...row, status: "PROCESSING", attemptCount: 1, lockedAt: sentAt }, db, sentAt);
      await db.update(emailOutbox).set({ status: "SENT", sentAt }).where(eq(emailOutbox.id, row.id));
      const match = /[/=]([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(message.text);
      if (!match) throw new Error("no action link in the declaration message");
      return match[1];
    };

    await resendDeclarationToAllPending(db, admin(), eventId, NOW);
    const first = await secretOf(NOW);
    expect((await readActionTokenContext(db, { secret: first, purpose: "COMPLETE_DECLARATION", now: NOW })).ok).toBe(true);

    // Two hours on: the first email left long ago, so the press sends again, with a link of its own.
    const later = new Date(NOW.getTime() + 120 * MINUTE);
    const again = await resendDeclarationToAllPending(db, admin(), eventId, later);
    // Hers, and the one whose email left two hours and ten minutes ago; the other four first-press rows
    // never left here, so they and the one still queued are skipped again.
    expect(again).toMatchObject({ queued: 2, skippedRecent: 5 });
    const second = await secretOf(later);
    expect(second).not.toBe(first);
    expect((await readActionTokenContext(db, { secret: second, purpose: "COMPLETE_DECLARATION", now: later })).ok).toBe(true);
    // The earlier live link is invalidated when the new one is minted (§12.8): only the newest opens.
    expect((await readActionTokenContext(db, { secret: first, purpose: "COMPLETE_DECLARATION", now: later })).ok).toBe(false);
  });
});
