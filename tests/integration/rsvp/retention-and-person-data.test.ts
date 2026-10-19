import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { personSessions } from "@/db/schema/person-sessions";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { PRUNE_STEPS, pruneExpiredRows, RETENTION, totalPruned } from "@/modules/jobs/retention";
import { RETENTION_PERIODS } from "@/modules/jobs/domain/retention-periods";
import { eraseRsvpsOfPerson, exportPersonData, viewPersonData } from "@/modules/registrations/person-data";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn(), unstable_cache: vi.fn() }));

const NOW = new Date("2026-11-30T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/**
 * §811 («Vin!» part 1) — what the sweep takes and when (30 days after the event's end, 7 days unconfirmed, a cancelled event's at
 * the next run, a remembered browser past its year), what «Toate datele unei persoane» shows of an address's answers and browsers
 * (art. 15), and the Administrator's erase of them (art. 17) — one audit row with counts, never the address.
 */
describe("§811 the answers «Vin!» in the sweep and in everything held about a person", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => resetTables(db));

  async function staff(role: StaffRole): Promise<StaffUser> {
    const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
    return user;
  }
  async function seedEvent(startsAt: Date, overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db.insert(events).values({ type: "GROUP_RUN", startsAt, registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(startsAt.getTime() - 5 * DAY), ...overrides }).returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `a-${event.id.slice(0, 8)}`, title: "Alergarea de joi" },
      { eventId: event.id, locale: "en", slug: `r-${event.id.slice(0, 8)}`, title: "Thursday run" },
    ]);
    return event;
  }
  async function answer(eventId: string, email: string, over: Partial<typeof eventRsvps.$inferInsert> = {}) {
    const [row] = await db
      .insert(eventRsvps)
      .values({ eventId, deliveryEmail: email, canonicalEmail: email.toLowerCase(), canonicalizationVersion: 2, locale: "ro", privacyNoticeVersion: 1, confirmedAt: NOW, createdAt: NOW, ...over })
      .returning();
    return row;
  }
  const emails = async (eventId: string) => (await db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId))).map((row) => row.canonicalEmail).sort();

  describe("the sweep", () => {
    it("is a step of its own, with the periods the notice states", () => {
      expect(PRUNE_STEPS).toContain("rsvps");
      expect(PRUNE_STEPS).toContain("person-sessions");
      expect(RETENTION.rsvpDaysAfterEvent).toBe(30);
      expect(RETENTION.rsvpUnconfirmedDays).toBe(7);
      expect(RETENTION_PERIODS.rsvpDaysAfterEvent).toBe(30);
    });

    it("deletes the answers of an event thirty days after its end — its start when it has none — and keeps a younger event's", async () => {
      const long = await seedEvent(new Date(NOW.getTime() - 40 * DAY));
      const justOver = await seedEvent(new Date(NOW.getTime() - 31 * DAY));
      const recent = await seedEvent(new Date(NOW.getTime() - 29 * DAY));
      const ahead = await seedEvent(new Date(NOW.getTime() + 2 * DAY));
      // An event that ran for days: thirty days from its END, not its start.
      const longRunning = await seedEvent(new Date(NOW.getTime() - 40 * DAY), { endsAt: new Date(NOW.getTime() - 20 * DAY) });
      for (const event of [long, justOver, recent, ahead, longRunning]) await answer(event.id, "ana@example.test");
      const outcome = await pruneExpiredRows(db, NOW);
      expect(outcome.failures).toEqual([]);
      expect(outcome.rsvps).toBe(2);
      expect(await emails(long.id)).toEqual([]);
      expect(await emails(justOver.id)).toEqual([]);
      expect(await emails(recent.id)).toEqual(["ana@example.test"]);
      expect(await emails(ahead.id)).toEqual(["ana@example.test"]);
      expect(await emails(longRunning.id)).toEqual(["ana@example.test"]);
    });

    it("deletes an answer whose address never used the link seven days after it was typed, and keeps a confirmed one that old", async () => {
      const event = await seedEvent(new Date(NOW.getTime() + 20 * DAY));
      await answer(event.id, "stale@example.test", { confirmedAt: null, createdAt: new Date(NOW.getTime() - 8 * DAY) });
      await answer(event.id, "fresh@example.test", { confirmedAt: null, createdAt: new Date(NOW.getTime() - 6 * DAY) });
      await answer(event.id, "counted@example.test", { confirmedAt: new Date(NOW.getTime() - 8 * DAY), createdAt: new Date(NOW.getTime() - 9 * DAY) });
      const outcome = await pruneExpiredRows(db, NOW);
      expect(outcome.rsvps).toBe(1);
      expect(await emails(event.id)).toEqual(["counted@example.test", "fresh@example.test"]);
    });

    it("deletes a cancelled event's answers at the next run, with their links, and nobody else's", async () => {
      const cancelled = await seedEvent(new Date(NOW.getTime() + 3 * DAY), { eventStatus: "CANCELLED" });
      const going = await seedEvent(new Date(NOW.getTime() + 3 * DAY));
      const mine = await answer(cancelled.id, "ana@example.test");
      await answer(going.id, "ana@example.test");
      await db.insert(eventRsvpTokens).values({ rsvpId: mine.id, purpose: "RSVP_WITHDRAW", tokenHash: "a".repeat(64), expiresAt: new Date(NOW.getTime() + DAY), createdAt: NOW });
      const outcome = await pruneExpiredRows(db, NOW);
      expect(outcome.rsvps).toBe(1);
      expect(await emails(cancelled.id)).toEqual([]);
      expect(await emails(going.id)).toEqual(["ana@example.test"]);
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
    });

    it("deletes the remembered browsers past their year, and counts both in the total the job logs", async () => {
      const event = await seedEvent(new Date(NOW.getTime() - 40 * DAY));
      await answer(event.id, "ana@example.test");
      await db.insert(personSessions).values([
        { canonicalEmail: "ana@example.test", deliveryEmail: "ana@example.test", canonicalizationVersion: 2, secretHash: "b".repeat(64), expiresAt: new Date(NOW.getTime() - DAY) },
        { canonicalEmail: "ion@example.test", deliveryEmail: "ion@example.test", canonicalizationVersion: 2, secretHash: "c".repeat(64), expiresAt: new Date(NOW.getTime() + DAY) },
      ]);
      const outcome = await pruneExpiredRows(db, NOW);
      expect(outcome.personSessions).toBe(1);
      expect(outcome.rsvps).toBe(1);
      expect(totalPruned(outcome)).toBeGreaterThanOrEqual(2);
      expect((await db.select().from(personSessions)).map((row) => row.canonicalEmail)).toEqual(["ion@example.test"]);
    });
  });

  describe("everything held about a person", () => {
    it("lists the answers and the remembered browsers of one canonical address — every column of an answer, never a browser's secret", async () => {
      const admin = await staff("ADMIN");
      const event = await seedEvent(new Date(NOW.getTime() + 2 * DAY));
      await answer(event.id, "Ana.Pop@gmail.com", { canonicalEmail: "ana.pop@gmail.com", displayName: "Ana", showName: true, privacyNoticeVersion: 4 });
      await answer((await seedEvent(new Date(NOW.getTime() + 5 * DAY))).id, "ana.pop@gmail.com", { confirmedAt: null, askedAt: NOW });
      await answer(event.id, "other@example.test");
      await db.insert(personSessions).values({ canonicalEmail: "ana.pop@gmail.com", deliveryEmail: "Ana.Pop@gmail.com", displayName: "Ana", canonicalizationVersion: 2, secretHash: "d".repeat(64), expiresAt: new Date(NOW.getTime() + 300 * DAY) });

      const data = await viewPersonData(db, admin, "ana.pop@gmail.com", NOW);
      expect(data.rsvpAnswers).toHaveLength(2);
      expect(data.rsvpAnswers[0]).toMatchObject({ deliveryEmail: "Ana.Pop@gmail.com", displayName: "Ana", showName: true, locale: "ro", privacyNoticeVersion: 4, eventTitle: "Alergarea de joi" });
      expect(data.rsvpAnswers[0].confirmedAt).not.toBeNull();
      expect(data.rsvpAnswers[1].confirmedAt).toBeNull();
      // The «Vii?» email's unanswered question is data held, and the view says it was asked (§NNN), not answered.
      expect(data.rsvpAnswers[0].askedAt).toBeNull();
      expect(data.rsvpAnswers[1].askedAt).toEqual(NOW);
      expect(data.rememberedBrowsers).toHaveLength(1);
      expect(JSON.stringify(data.rememberedBrowsers)).not.toContain("d".repeat(64));
      expect(Object.keys(data.rememberedBrowsers[0]).sort()).toEqual(["createdAt", "deliveryEmail", "displayName", "expiresAt", "lastUsedAt"]);
      // Another person's answers are not here.
      expect(data.rsvpAnswers.map((row) => row.deliveryEmail)).not.toContain("other@example.test");
    });

    it("counts them in the export's audit row, never a value", async () => {
      const admin = await staff("ADMIN");
      const event = await seedEvent(new Date(NOW.getTime() + 2 * DAY));
      await answer(event.id, "ana@example.test");
      await exportPersonData(db, admin, "ana@example.test", NOW);
      const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.data_exported"));
      expect(row.metadataJson).toMatchObject({ rsvpAnswers: 1, rememberedBrowsers: 0 });
      expect(JSON.stringify(row.metadataJson)).not.toContain("ana@example.test");
    });

    it("erases an address's answers and browsers for an Administrator alone, with one audit row of counts", async () => {
      const admin = await staff("ADMIN");
      const organizer = await staff("MODERATOR");
      const event = await seedEvent(new Date(NOW.getTime() + 2 * DAY));
      const mine = await answer(event.id, "ana@example.test");
      await answer(event.id, "ion@example.test");
      await db.insert(eventRsvpTokens).values({ rsvpId: mine.id, purpose: "RSVP_WITHDRAW", tokenHash: "e".repeat(64), expiresAt: new Date(NOW.getTime() + DAY), createdAt: NOW });
      await db.insert(personSessions).values([
        { canonicalEmail: "ana@example.test", deliveryEmail: "ana@example.test", canonicalizationVersion: 2, secretHash: "f".repeat(64), expiresAt: new Date(NOW.getTime() + DAY) },
        { canonicalEmail: "ana@example.test", deliveryEmail: "ana@example.test", canonicalizationVersion: 2, secretHash: "1".repeat(64), expiresAt: new Date(NOW.getTime() + DAY) },
        { canonicalEmail: "ion@example.test", deliveryEmail: "ion@example.test", canonicalizationVersion: 2, secretHash: "2".repeat(64), expiresAt: new Date(NOW.getTime() + DAY) },
      ]);

      const refused = await eraseRsvpsOfPerson(db, organizer, "ana@example.test", NOW).catch((e: unknown) => e);
      expect(isDomainError(refused) && refused.code).toBe("FORBIDDEN");
      expect(await emails(event.id)).toEqual(["ana@example.test", "ion@example.test"]);

      expect(await eraseRsvpsOfPerson(db, admin, "ana@example.test", NOW)).toEqual({ answers: 1, browsers: 2 });
      expect(await emails(event.id)).toEqual(["ion@example.test"]);
      expect((await db.select().from(personSessions)).map((row) => row.canonicalEmail)).toEqual(["ion@example.test"]);
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "participant.rsvps_erased"));
      expect(audit.actorStaffUserId).toBe(admin.id);
      expect(audit.metadataJson).toEqual({ answers: 1, browsers: 2 });
      expect(JSON.stringify(audit)).not.toContain("ana@example.test");
      // Nothing left to erase: still one honest row of zeros.
      expect(await eraseRsvpsOfPerson(db, admin, "ana@example.test", NOW)).toEqual({ answers: 0, browsers: 0 });
    });
  });
});
