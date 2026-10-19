import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvpAsks, eventRsvps, rsvpAskRefusals, rsvpRefuseTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { newsletterSubscribers, type NewsletterTopic } from "@/db/schema/newsletter";
import { staffUsers } from "@/db/schema/staff-users";
import { updateDeadlines } from "@/modules/deadlines/deadlines";
import { DEFAULT_DEADLINES } from "@/modules/deadlines/domain/deadlines";
import { nextMaintenanceWork } from "@/modules/jobs/next-work";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { OutboxMessageWithdrawn } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { eraseRsvpsOfPerson, viewPersonData } from "@/modules/registrations/person-data";
import { readRsvpAskAudienceSetting, updateRsvpAskAudience } from "@/modules/rsvp/ask-audience";
import { eventSeriesKey, refuseRsvpAsks } from "@/modules/rsvp/ask-refusal";
import { queueRsvpAsks } from "@/modules/rsvp/ask";
import { confirmRsvp, readRsvpLink, withdrawRsvp } from "@/modules/rsvp/rsvp";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => {},
}));

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Saturday 2026-10-17, 09:00 club time (summer time, UTC+3): inside the window of Sunday's run. */
const NOW = new Date("2026-10-17T06:00:00.000Z");
/** Sunday 2026-10-18, 10:00 club time: the run asked about. The same run a week earlier and a week later are its series. */
const STARTS_AT = new Date("2026-10-18T07:00:00.000Z");
const EARLIER = new Date(STARTS_AT.getTime() - 7 * DAY);
const LATER = new Date(STARTS_AT.getTime() + 7 * DAY);

/**
 * §NNN (amends §818, §813; the owner, 2026-10-19: «I need to set how these emails are sent») — the «Vii?» question's three settings:
 * WHEN (days before the start, hour: «Termene»), WHO («Emailuri»: the subscribers by default; the people who answered «Vin!» at an earlier date of
 * the series only while the club chose it AND the notice names it, each email with its «Nu mă mai întreba la seria aceasta» link) and WHICH EVENTS
 * (the per-event tick). Migration 0173 is exercised by all of it: the column's default, the refusals' table and its unique key, the new link purpose.
 */
describe("§NNN the «Vii?» question's settings", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approveNotice(1);
  });

  /** The template's text with a marker taken out: the notice that describes «Vin!» and the question but not the answerers' audience. */
  const without = (body: unknown, marker: string) => JSON.parse(JSON.stringify(body).replaceAll(marker, "")) as typeof privacyNoticeRo;

  async function approveNotice(version: number, options: { answerers?: boolean } = {}) {
    const answerers = options.answerers ?? true;
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: answerers ? privacyNoticeRo : without(privacyNoticeRo, "{{rsvpAskAnswerers}}") },
      { locale: "en", title: "Privacy", body: answerers ? privacyNoticeEn : without(privacyNoticeEn, "{{rsvpAskAnswerers}}") },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}, titles = { ro: "Alergarea de duminică", en: "Sunday run" }) {
    const [event] = await db
      .insert(events)
      .values({
        type: "GROUP_RUN",
        startsAt: STARTS_AT,
        registrationMode: "NONE",
        rsvpEnabled: true,
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - 20 * DAY),
        locationName: "Parcul Tractorul",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `alergare-${event.id.slice(0, 8)}`, title: titles.ro },
      { eventId: event.id, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: titles.en },
    ]);
    return event;
  }

  async function subscribe(email: string, topics: NewsletterTopic[], extra: Partial<typeof newsletterSubscribers.$inferInsert> = {}) {
    const who = canonicalizeEmail(email);
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        deliveryEmail: who.deliveryEmail,
        canonicalEmail: who.canonicalEmail,
        canonicalizationVersion: who.canonicalizationVersion,
        locale: "ro",
        topics,
        privacyNoticeVersion: 1,
        confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
        ...extra,
      })
      .returning();
    return row;
  }

  /** An answer «Vin!» already counted at an earlier date of the series, under notice version 1 unless said otherwise. */
  async function answered(eventId: string, email: string, extra: Partial<typeof eventRsvps.$inferInsert> = {}) {
    const who = canonicalizeEmail(email);
    const [row] = await db
      .insert(eventRsvps)
      .values({
        eventId,
        deliveryEmail: who.deliveryEmail,
        canonicalEmail: who.canonicalEmail,
        canonicalizationVersion: who.canonicalizationVersion,
        locale: "ro",
        privacyNoticeVersion: 1,
        confirmedAt: new Date(EARLIER.getTime() - HOUR),
        createdAt: new Date(EARLIER.getTime() - 2 * HOUR),
        ...extra,
      })
      .returning();
    return row;
  }

  async function admin() {
    const [existing] = await db.select().from(staffUsers).where(eq(staffUsers.email, "admin@example.test")).limit(1);
    if (existing) return existing;
    const [row] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Admin", role: "ADMIN" }).returning();
    return row;
  }

  const setAudience = async (audience: "SUBSCRIBERS" | "ANSWERERS" | "BOTH") => updateRsvpAskAudience(db, await admin(), { audience }, NOW);
  const setDeadlines = async (change: Partial<typeof DEFAULT_DEADLINES>) => updateDeadlines(db, await admin(), { ...DEFAULT_DEADLINES, ...change }, NOW);

  const asks = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_ASK")).orderBy(emailOutbox.recipientEmail);
  const askRows = () => db.select().from(eventRsvpAsks);
  const rowsOf = (eventId: string) => db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId));
  const refusals = () => db.select().from(rsvpAskRefusals);
  const linksOf = (text: string) => [...new Set([...text.matchAll(/\/(?:vin|coming)\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];
  /** The link of one purpose in an email's text: the refusal link is a table of its own, so `readRsvpLink` names every one the same way. */
  const linkOf = async (text: string, purpose: "RSVP_CONFIRM" | "RSVP_WITHDRAW" | "RSVP_REFUSE", at = NOW) =>
    (await Promise.all(linksOf(text).map(async (link) => ((await readRsvpLink(db, link, at))?.purpose === purpose ? link : null)))).find((link) => link !== null)!;
  const purposesOf = async (text: string, at = NOW) => (await Promise.all(linksOf(text).map((link) => readRsvpLink(db, link, at)))).map((link) => link?.purpose).sort();

  /** A series of three dates of «Alergarea de duminică»: last week's, this Sunday's (asked about) and next week's. */
  async function seedSeries() {
    const earlier = await seedEvent({ startsAt: EARLIER, publishedAt: new Date(EARLIER.getTime() - 20 * DAY) });
    const current = await seedEvent();
    const later = await seedEvent({ startsAt: LATER });
    return { earlier, current, later };
  }

  describe("the migration (0173)", () => {
    it("defaults the per-event tick to ON for every event, keeps a refusal once per address and series, and knows the refusal link", async () => {
      const event = await seedEvent();
      expect(event.rsvpAskEnabled).toBe(true);
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nalergarea" });
      await expect(
        db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nalergarea" }),
      ).rejects.toThrow();
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\naltceva" });
      expect(await refusals()).toHaveLength(2);
      // The refusal link is a table of its own — no key to an answer — with one row per hash.
      const link = { eventId: event.id, locale: "ro" as const, canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nalergarea", createdAt: NOW, expiresAt: STARTS_AT };
      await db.insert(rsvpRefuseTokens).values({ ...link, tokenHash: "f".repeat(64) });
      await expect(db.insert(rsvpRefuseTokens).values({ ...link, tokenHash: "f".repeat(64) })).rejects.toThrow();
      await expect(db.insert(rsvpRefuseTokens).values({ ...link, tokenHash: "not-a-hash" })).rejects.toThrow();
    });
  });

  describe("the per-event tick", () => {
    it("skips an event whose tick is off — no row, no message, nothing to wake the job for — and asks it the moment the tick is back on", async () => {
      const event = await seedEvent({ rsvpAskEnabled: false });
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      expect(await asks()).toHaveLength(0);
      expect(await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"))).toBeNull();
      // «Vin!» itself is not the question's: the event still takes answers.
      expect((await db.select().from(events).where(eq(events.id, event.id)))[0].rsvpEnabled).toBe(true);

      await db.update(events).set({ rsvpAskEnabled: true }).where(eq(events.id, event.id));
      expect(await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"))).not.toBeNull();
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(1);
    });

    it("asks the dates that keep the tick and not the one that dropped it, in the same run", async () => {
      await seedEvent({ rsvpAskEnabled: false });
      const other = await seedEvent({ startsAt: new Date(STARTS_AT.getTime() + HOUR) });
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect(await askRows()).toEqual([expect.objectContaining({ eventId: other.id, recipients: 1 })]);
    });

    it("withdraws a question queued before the tick was taken off, and writes no answer row", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      await db.update(events).set({ rsvpAskEnabled: false }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });
  });

  describe("how many days before, and at what hour", () => {
    it("keeps the question's «Vin» alive until the start when the question went out three days ahead: a press on the evening before still counts", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await setDeadlines({ rsvpAskDaysBefore: 3, rsvpAskHour: 8 });
      // Thursday 2026-10-15, 08:00 club time (summer time, UTC+3): the run is on Sunday 10:00.
      const sent = new Date("2026-10-15T05:00:00.000Z");
      expect(await queueRsvpAsks(db, sent)).toBe(1);
      const message = await renderOutboxMessage((await asks())[0], db, sent);
      const confirm = await linkOf(message.text, "RSVP_CONFIRM", sent);
      // Sixty hours later is Saturday 17:00 club time: past the 48 hours of a confirmation message, before the start.
      const evening = new Date(sent.getTime() + 60 * HOUR);
      expect(await readRsvpLink(db, confirm, evening)).toMatchObject({ purpose: "RSVP_CONFIRM", state: "live" });
      expect(await confirmRsvp(db, confirm, evening)).not.toBeNull();
      expect(await rowsOf(event.id)).toEqual([expect.objectContaining({ canonicalEmail: "ana@example.test", confirmedAt: evening })]);
    });

    it("asks three days before at the club's hour, not a minute earlier, and says «peste 3 zile» in the email", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await setDeadlines({ rsvpAskDaysBefore: 3, rsvpAskHour: 20 });
      // Thursday 2026-10-15 at 19:59 club time (16:59Z): not yet; the default window (Saturday) is not the club's any more.
      expect(await queueRsvpAsks(db, new Date("2026-10-15T16:59:00.000Z"))).toBe(0);
      expect(await askRows()).toHaveLength(0);
      expect((await nextMaintenanceWork(db, new Date("2026-10-14T09:00:00.000Z")))?.toISOString()).toBe("2026-10-15T17:00:00.000Z");
      const at = new Date("2026-10-15T17:00:00.000Z");
      expect(await queueRsvpAsks(db, at)).toBe(1);
      const [row] = await asks();
      const message = await renderOutboxMessage(row, db, at);
      expect(message.subject).toBe("Vii peste 3 zile la Alergarea de duminică? / Coming to Sunday run in 3 days?");
      expect(message.text).toContain("Vii peste 3 zile la Alergarea de duminică?");
      expect(message.text).not.toContain("mâine");
    });

    it("keeps saying «mâine» at the default one day", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      const message = await renderOutboxMessage((await asks())[0], db, NOW);
      expect(message.subject).toBe("Vii mâine la Alergarea de duminică? / Coming to Sunday run tomorrow?");
    });

    it("asks nobody at zero days — not in the old window, not later — and wakes nothing", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await setDeadlines({ rsvpAskDaysBefore: 0 });
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      expect(await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"))).toBeNull();
    });

    it("withdraws a question queued before the club set zero days", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      await setDeadlines({ rsvpAskDaysBefore: 0 });
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("opens at midnight and at 23:00 when the club chose those hours, on the club's wall clock", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await setDeadlines({ rsvpAskHour: 23 });
      // 23:00 club time on Saturday is 20:00Z: the morning's run does not ask; the evening's does.
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await queueRsvpAsks(db, new Date("2026-10-17T19:59:00.000Z"))).toBe(0);
      expect(await queueRsvpAsks(db, new Date("2026-10-17T20:00:00.000Z"))).toBe(1);
    });
  });

  describe("who is asked", () => {
    it("asks the subscribers alone by default: someone who answered an earlier date is not asked", async () => {
      const { earlier, current } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      expect((await readRsvpAskAudienceSetting(db)).audience).toBe("SUBSCRIBERS");
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["ion@example.test"]);
      expect(await rowsOf(current.id)).toHaveLength(0);
    });

    it("asks the people who answered an earlier date of the series — and no subscriber — when the club chose that, under a notice that names it", async () => {
      const { earlier } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await setAudience("ANSWERERS");
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      const [row] = await asks();
      expect(row.recipientEmail).toBe("ana@example.test");
      // Nothing secret and no address in the payload: the earlier answer's id, so the links are minted when it is SENT.
      expect(Object.keys(row.payloadJson as object).sort()).toEqual(["answererRsvpId", "eventId"]);
      expect(JSON.stringify(row.payloadJson)).not.toContain("@");
    });

    it("asks nobody of that audience while the notice in force does not name it, writes no row — and asks them when the club approves one that does", async () => {
      await resetTables(db);
      await approveNotice(1, { answerers: false });
      const { earlier } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await setAudience("ANSWERERS");
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      // A later notice names it; the earlier answer was given under version 1, which did not: it agreed to be counted, not to be asked.
      await approveNotice(2);
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(0);
      // Someone who answered under the new notice is asked.
      await db.delete(eventRsvpAsks);
      await answered((await db.select().from(events).where(eq(events.startsAt, EARLIER)))[0].id, "dan@example.test", { privacyNoticeVersion: 2 });
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + 2 * HOUR))).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["dan@example.test"]);
    });

    it("does not ask, as an earlier answerer, someone whose «Vin» came from a subscriber's question and who has left the topic since — in the queue and at the send", async () => {
      const { earlier } = await seedSeries();
      const askedAt = new Date(EARLIER.getTime() - 3 * HOUR);
      const ana = await subscribe("ana@example.test", ["RSVP_ASK"]);
      await answered(earlier.id, "ana@example.test", { askedAt, askedBasis: "SUBSCRIBER" });
      // Ion said «Vin» in an answerers' question: no subscription to keep. Eva pressed «Vin» in a subscriber's question and is no subscriber now.
      await answered(earlier.id, "ion@example.test", { askedAt, askedBasis: "ANSWERER" });
      await answered(earlier.id, "eva@example.test", { askedAt, askedBasis: "SUBSCRIBER" });
      await setAudience("ANSWERERS");
      expect(await queueRsvpAsks(db, NOW)).toBe(2);
      const queued = await asks();
      expect(queued.map((row) => row.recipientEmail)).toEqual(["ana@example.test", "ion@example.test"]);

      // Ana unticks the topic after the queue: the send withdraws her message, and tomorrow's queue never lists her.
      await db.update(newsletterSubscribers).set({ topics: ["RESULTS_PHOTOS"] }).where(eq(newsletterSubscribers.id, ana.id));
      await expect(renderOutboxMessage(queued[0], db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await db.delete(emailOutbox);
      await db.delete(eventRsvpAsks);
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["ion@example.test"]);

      // Under BOTH she is neither a subscriber nor an answerer.
      await db.delete(emailOutbox);
      await db.delete(eventRsvpAsks);
      await setAudience("BOTH");
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["ion@example.test"]);
    });

    it("keeps the subscribers' list as it was when the club chose the answerers and the notice is silent about them under BOTH", async () => {
      await resetTables(db);
      await approveNotice(1, { answerers: false });
      const { earlier } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await setAudience("BOTH");
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["ion@example.test"]);
    });

    it("asks both lists once each — a person on both is one email, as a subscriber — and leaves out the unconfirmed, the already counted, the later date's and another series'", async () => {
      const { earlier, later, current } = await seedSeries();
      const other = await seedEvent({ startsAt: new Date(EARLIER.getTime() + HOUR) }, { ro: "Altă alergare", en: "Another run" });
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await subscribe("both@example.test", ["ALL"]);
      // Answered at an earlier date: asked. Both addresses spelled two ways are one person.
      await answered(earlier.id, "ana@example.test");
      await answered(earlier.id, "Both@example.test");
      await answered(other.id, "Both@example.test");
      await answered(earlier.id, "Dan.Pop+club@gmail.com");
      await answered(other.id, "dan.pop@gmail.com");
      // Not asked: never counted, counted at this date already, counted only at the NEXT date, answered in another series.
      await answered(earlier.id, "unconfirmed@example.test", { confirmedAt: null });
      await answered(earlier.id, "counted@example.test");
      await answered(current.id, "counted@example.test", { confirmedAt: NOW });
      await answered(later.id, "future@example.test");
      await answered(other.id, "elsewhere@example.test");
      await setAudience("BOTH");

      expect(await queueRsvpAsks(db, NOW)).toBe(4);
      const rows = await asks();
      expect(rows.map((row) => row.recipientEmail)).toEqual(["Dan.Pop+club@gmail.com", "ana@example.test", "both@example.test", "ion@example.test"]);
      const payloadOf = (email: string) => Object.keys(rows.find((row) => row.recipientEmail === email)?.payloadJson as object).sort();
      expect(payloadOf("both@example.test")).toEqual(["eventId", "subscriberId"]);
      expect(payloadOf("ion@example.test")).toEqual(["eventId", "subscriberId"]);
      expect(payloadOf("ana@example.test")).toEqual(["answererRsvpId", "eventId"]);
      expect(payloadOf("Dan.Pop+club@gmail.com")).toEqual(["answererRsvpId", "eventId"]);
      expect(await askRows()).toEqual([expect.objectContaining({ eventId: current.id, recipients: 4 })]);
    });

    it("withdraws, at the send, a question to an earlier answerer when the club changed the audience, the answer is gone or the notice stopped naming it", async () => {
      const { earlier, current } = await seedSeries();
      const answer = await answered(earlier.id, "ana@example.test");
      await setAudience("ANSWERERS");
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      await setAudience("SUBSCRIBERS");
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await setAudience("ANSWERERS");
      await db.delete(eventRsvps).where(eq(eventRsvps.id, answer.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(current.id)).toHaveLength(0);
    });
  });

  describe("the email and the refusal link", () => {
    async function askedOfAnswerer() {
      const { earlier, current, later } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await setAudience("ANSWERERS");
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      const message = await renderOutboxMessage(row, db, NOW);
      return { earlier, current, later, row, message };
    }

    it("carries «Nu mă mai întreba la seria aceasta» in the question to an earlier answerer — a third link, a refusal's — and says why it came", async () => {
      const { message, current } = await askedOfAnswerer();
      expect(message.text).toContain("Nu mă mai întreba la seria aceasta");
      expect(message.text).toContain("Don't ask me again for this series");
      expect(message.text).toContain("ai răspuns „Vin!” la un eveniment anterior din aceeași serie");
      expect(await purposesOf(message.text)).toEqual(["RSVP_CONFIRM", "RSVP_REFUSE", "RSVP_WITHDRAW"]);
      // The answer row the question made, unconfirmed, at THIS date.
      expect(await rowsOf(current.id)).toEqual([expect.objectContaining({ canonicalEmail: "ana@example.test", confirmedAt: null, displayName: null })]);
    });

    it("leaves the refusal link out of a subscriber's question: their way out is their topics page", async () => {
      await seedEvent();
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      const message = await renderOutboxMessage((await asks())[0], db, NOW);
      expect(message.text).not.toContain("Nu mă mai întreba la seria aceasta");
      expect(message.text).not.toContain("Don't ask me again for this series");
      expect(await purposesOf(message.text)).toEqual(["RSVP_CONFIRM", "RSVP_WITHDRAW"]);
      // And under BOTH, a person on both lists is asked as a subscriber: no refusal link either.
      await resetTables(db);
      await approveNotice(1);
      const { earlier } = await seedSeries();
      await answered(earlier.id, "ion@example.test");
      await subscribe("ion@example.test", ["RSVP_ASK"]);
      await setAudience("BOTH");
      await queueRsvpAsks(db, NOW);
      const both = await renderOutboxMessage((await asks())[0], db, NOW);
      expect(await purposesOf(both.text)).toEqual(["RSVP_CONFIRM", "RSVP_WITHDRAW"]);
    });

    it("records nothing on a GET of the refusal page, records once on the press, and spends the link", async () => {
      const { message, current, earlier } = await askedOfAnswerer();
      const links = linksOf(message.text);
      const refuse = (await Promise.all(links.map(async (link) => ((await readRsvpLink(db, link, NOW))?.purpose === "RSVP_REFUSE" ? link : null)))).find((link) => link !== null)!;
      // A GET (what a mail scanner does): the page's read says what the link is, and writes nothing.
      expect(await readRsvpLink(db, refuse, NOW)).toMatchObject({ purpose: "RSVP_REFUSE", state: "live" });
      expect(await refusals()).toHaveLength(0);
      expect(await rowsOf(current.id)).toHaveLength(1);

      const done = await refuseRsvpAsks(db, refuse, new Date(NOW.getTime() + HOUR));
      expect(done).toMatchObject({ eventId: current.id, locale: "ro", unanswered: true });
      expect(await refusals()).toEqual([
        expect.objectContaining({ canonicalEmail: "ana@example.test", seriesKey: await eventSeriesKey(db, current.id) }),
      ]);
      // The series' key is the listing's: the type and the default-language title.
      expect((await refusals())[0].seriesKey).toBe("GROUP_RUN\nalergarea de duminică");
      // The unanswered row the question made is gone, the earlier answer stays; a second press changes nothing.
      expect(await rowsOf(current.id)).toHaveLength(0);
      expect(await rowsOf(earlier.id)).toHaveLength(1);
      expect(await refuseRsvpAsks(db, refuse, new Date(NOW.getTime() + 2 * HOUR))).toBeNull();
      expect(await refusals()).toHaveLength(1);
      // The link is spent: its page says so (never an error).
      expect(await readRsvpLink(db, refuse, new Date(NOW.getTime() + 2 * HOUR))).toMatchObject({ purpose: "RSVP_REFUSE", state: "used" });
    });

    it("still records the refusal after «Nu vin» in the same email deleted the answer row the question made", async () => {
      const { message, current, later } = await askedOfAnswerer();
      const withdraw = await linkOf(message.text, "RSVP_WITHDRAW");
      const refuse = await linkOf(message.text, "RSVP_REFUSE");
      expect(await withdrawRsvp(db, { token: withdraw }, new Date(NOW.getTime() + HOUR))).not.toBeNull();
      expect(await rowsOf(current.id)).toHaveLength(0);
      // The row is gone and its links with it; the refusal link has its own table and is live.
      expect(await readRsvpLink(db, withdraw, NOW)).toBeNull();
      expect(await readRsvpLink(db, refuse, new Date(NOW.getTime() + HOUR))).toMatchObject({ purpose: "RSVP_REFUSE", state: "live", eventId: current.id });
      expect(await refuseRsvpAsks(db, refuse, new Date(NOW.getTime() + 2 * HOUR))).toMatchObject({ eventId: current.id, locale: "ro" });
      expect(await refusals()).toEqual([expect.objectContaining({ canonicalEmail: "ana@example.test", seriesKey: await eventSeriesKey(db, current.id) })]);
      // Next week's date does not ask her, though her earlier answer still stands.
      expect(await queueRsvpAsks(db, new Date("2026-10-24T06:00:00.000Z"))).toBe(0);
      expect((await askRows()).filter((row) => row.eventId === later.id)).toEqual([expect.objectContaining({ recipients: 0 })]);
    });

    it("records the refusal when the link is pressed after the event started, for sixty days, and not after", async () => {
      const { message, current } = await askedOfAnswerer();
      const refuse = await linkOf(message.text, "RSVP_REFUSE");
      const afterTheRun = new Date(STARTS_AT.getTime() + 3 * HOUR);
      expect(await readRsvpLink(db, refuse, afterTheRun)).toMatchObject({ purpose: "RSVP_REFUSE", state: "live" });
      expect(await refuseRsvpAsks(db, refuse, afterTheRun)).toMatchObject({ eventId: current.id });
      expect(await refusals()).toHaveLength(1);

      // A link nobody pressed lives sixty days after the start and then answers «expired» and records nothing.
      await db.delete(rsvpAskRefusals);
      await db.update(rsvpRefuseTokens).set({ usedAt: null });
      const late = new Date(STARTS_AT.getTime() + 61 * DAY);
      expect(await readRsvpLink(db, refuse, late)).toMatchObject({ purpose: "RSVP_REFUSE", state: "expired" });
      expect(await refuseRsvpAsks(db, refuse, late)).toBeNull();
      expect(await refusals()).toHaveLength(0);
    });

    it("never asks the person again for that series — the next date, as an answerer or as a subscriber — while another series still asks them", async () => {
      const { message, later, current } = await askedOfAnswerer();
      for (const link of linksOf(message.text)) {
        if ((await readRsvpLink(db, link, NOW))?.purpose === "RSVP_REFUSE") await refuseRsvpAsks(db, link, NOW);
      }
      expect(await refusals()).toHaveLength(1);
      // Next Saturday morning: Ana answered the first date, is on the topic too, and the club asks both lists.
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await setAudience("BOTH");
      const nextWeek = new Date("2026-10-24T06:00:00.000Z");
      expect(await queueRsvpAsks(db, nextWeek)).toBe(0);
      expect((await askRows()).filter((row) => row.eventId === later.id)).toEqual([expect.objectContaining({ recipients: 0 })]);
      expect(await asks()).toHaveLength(1);
      expect(current.id).toBeTruthy();

      // Another series is not touched: a different run, answered at an earlier date, asks the same person.
      await resetTables(db);
      await approveNotice(1);
      const earlierOther = await seedEvent({ startsAt: new Date(EARLIER.getTime() + 2 * HOUR) }, { ro: "Altă alergare", en: "Another run" });
      const currentOther = await seedEvent({ startsAt: new Date(STARTS_AT.getTime() + 2 * HOUR) }, { ro: "Altă alergare", en: "Another run" });
      await answered(earlierOther.id, "ana@example.test");
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nalergarea de duminică" });
      await setAudience("ANSWERERS");
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await askRows()).map((row) => row.eventId)).toEqual([currentOther.id]);
    });

    it("withdraws, at the send, a question queued for an address that refused the series meanwhile", async () => {
      const { earlier, current } = await seedSeries();
      await answered(earlier.id, "ana@example.test");
      await setAudience("ANSWERERS");
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: await eventSeriesKey(db, current.id) });
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(current.id)).toHaveLength(0);
    });
  });

  describe("the sweep and the person's data", () => {
    it("keeps a refusal while its series has a date within the year and deletes it after, and keeps another series' alone", async () => {
      const { later } = await seedSeries();
      const key = await eventSeriesKey(db, later.id);
      await db.insert(rsvpAskRefusals).values([
        { canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: key },
        { canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nmută-te acum" },
      ]);
      // A year after the series' LAST date is the line; the other series has no event at all, so it goes at the first sweep.
      const early = new Date(LATER.getTime() + 300 * DAY);
      const first = await pruneExpiredRows(db, early);
      expect(first.rsvpAskRefusals).toBe(1);
      expect((await refusals()).map((row) => row.seriesKey)).toEqual([key]);
      const late = new Date(LATER.getTime() + 366 * DAY);
      expect((await pruneExpiredRows(db, late)).rsvpAskRefusals).toBe(1);
      expect(await refusals()).toHaveLength(0);
    });

    it("keeps a still-unanswered row the question made past seven days, sweeps a typed unconfirmed one, and sweeps the refusal links once spent or expired", async () => {
      const event = await seedEvent();
      const old = new Date(NOW.getTime() - 8 * DAY);
      // A question sent a week ahead leaves a row nobody has pressed yet; an address typed on the page and never confirmed is a stranger's typing.
      await answered(event.id, "asked@example.test", { confirmedAt: null, askedAt: old, askedBasis: "SUBSCRIBER", createdAt: old });
      await answered(event.id, "typed@example.test", { confirmedAt: null, createdAt: old });
      const link = { eventId: event.id, locale: "ro" as const, canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: "GROUP_RUN\nalergarea" };
      await db.insert(rsvpRefuseTokens).values([
        { ...link, tokenHash: "a".repeat(64), createdAt: new Date(NOW.getTime() - DAY), expiresAt: new Date(NOW.getTime() + DAY) },
        { ...link, tokenHash: "b".repeat(64), createdAt: new Date(NOW.getTime() - DAY), expiresAt: new Date(NOW.getTime() + DAY), usedAt: NOW },
        { ...link, tokenHash: "c".repeat(64), createdAt: new Date(NOW.getTime() - 70 * DAY), expiresAt: new Date(NOW.getTime() - HOUR) },
      ]);
      const counts = await pruneExpiredRows(db, NOW);
      expect(counts.rsvps).toBe(1);
      expect((await rowsOf(event.id)).map((row) => row.canonicalEmail)).toEqual(["asked@example.test"]);
      expect(counts.rsvpRefuseTokens).toBe(2);
      expect((await db.select().from(rsvpRefuseTokens)).map((row) => row.tokenHash)).toEqual(["a".repeat(64)]);
      // Once the event has started the unanswered row goes like any other.
      expect((await pruneExpiredRows(db, new Date(STARTS_AT.getTime() + HOUR))).rsvps).toBe(1);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("erases the refusal links with the answers and leaves the refusal itself", async () => {
      const { current } = await seedSeries();
      const key = await eventSeriesKey(db, current.id);
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: key });
      const link = { eventId: current.id, locale: "ro" as const, canonicalizationVersion: 2, seriesKey: key, createdAt: NOW, expiresAt: STARTS_AT };
      await db.insert(rsvpRefuseTokens).values([
        { ...link, canonicalEmail: "ana@example.test", tokenHash: "d".repeat(64) },
        { ...link, canonicalEmail: "ion@example.test", tokenHash: "e".repeat(64) },
      ]);
      await eraseRsvpsOfPerson(db, await admin(), "ana@example.test", NOW);
      expect((await db.select().from(rsvpRefuseTokens)).map((row) => row.canonicalEmail)).toEqual(["ion@example.test"]);
      expect(await refusals()).toHaveLength(1);
    });

    it("lists a person's refusals in everything held about them, and an erase of the answers leaves the refusal where it is", async () => {
      const { current } = await seedSeries();
      const key = await eventSeriesKey(db, current.id);
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ana@example.test", canonicalizationVersion: 2, seriesKey: key });
      await db.insert(rsvpAskRefusals).values({ canonicalEmail: "ion@example.test", canonicalizationVersion: 2, seriesKey: key });
      const data = await viewPersonData(db, await admin(), "ana@example.test", NOW);
      expect(data.askRefusals).toEqual([expect.objectContaining({ seriesKey: key, canonicalizationVersion: 2 })]);
      expect(data.askRefusals).toHaveLength(1);
    });
  });
});
