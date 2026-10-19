import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvpAsks, eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { newsletterSubscribers, type NewsletterTopic } from "@/db/schema/newsletter";
import { nextMaintenanceWork } from "@/modules/jobs/next-work";
import { pruneExpiredRows, RETENTION } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import type { OutgoingEmail } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { OutboxMessageWithdrawn, processOutboxBatch } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { checkRsvpAsk, makeRsvpAsk, queueRsvpAsks } from "@/modules/rsvp/ask";
import { identityOf } from "@/modules/rsvp/domain/identity";
import {
  answerRsvp,
  confirmRsvp,
  countRsvps,
  countRsvpsForAdmin,
  listRsvpsForAdmin,
  readPublicRsvps,
  readRsvpLink,
  requestWithdrawLink,
  withdrawRsvp,
} from "@/modules/rsvp/rsvp";
import { runRegistrationMaintenance } from "@/modules/registrations/maintenance";
import { unsubscribeNewsletterSubscriber } from "@/modules/newsletter/service";
import { staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => {},
}));

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
/** Saturday 2026-10-17, 09:00 club time (summer time, UTC+3): inside the window of Sunday's run. */
const NOW = new Date("2026-10-17T06:00:00.000Z");
/** Sunday 2026-10-18, 10:00 club time. */
const STARTS_AT = new Date("2026-10-18T07:00:00.000Z");

/**
 * §NNN (builds on §812, amends §445 and §775) — «Vii mâine la …?»: the day before a ticked turn-up event, from 08:00 club time, the newsletter's
 * subscribers of the topic «Întrebarea «Vii?» înaintea alergărilor» (and of "everything") get ONE email with two personal links, once
 * per event. «Vin» counts them at once; «Nu vin» counts nobody. Not a registration: nothing here touches a place or a participant.
 */
describe("§NNN «Vii mâine la …?»", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    await approveNotice(1, true);
  });

  /** The template's text with `{{rsvpAsk}}` taken out: a notice that describes «Vin!» and says nothing of the question. */
  const withoutAsk = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpAsk}}", "")) as typeof privacyNoticeRo;

  async function approveNotice(version: number, describes: boolean, describesAsk = true) {
    const translations: LegalDocumentTranslationInput[] = describes
      ? [
          { locale: "ro", title: "Confidențialitate", body: describesAsk ? privacyNoticeRo : withoutAsk(privacyNoticeRo) },
          { locale: "en", title: "Privacy", body: describesAsk ? privacyNoticeEn : withoutAsk(privacyNoticeEn) },
        ]
      : [
          { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic despre răspunsuri."] }] } },
          { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing about answers."] }] } },
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
        publishedAt: new Date(NOW.getTime() - DAY),
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

  const asks = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_ASK")).orderBy(emailOutbox.recipientEmail);
  const askRows = () => db.select().from(eventRsvpAsks);
  const rowsOf = (eventId: string) => db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId));
  /** The two token links of one rendered message, in the order they are drawn: «Vin», then «Nu vin». */
  const linksOf = (text: string) => [...new Set([...text.matchAll(/\/(?:vin|coming)\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];

  describe("who is asked", () => {
    it("queues one message per confirmed subscriber of the topic or of everything — in their own language — and writes the event's row", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await subscribe("ion@example.test", ["ALL"], { locale: "en" });
      await subscribe("dan@example.test", ["BIG_EVENTS", "RSVP_ASK"]);
      // Not asked: another topic (the weekly runs promised «o dată pe serie»), and an address that never confirmed.
      await subscribe("weekly@example.test", ["WEEKLY_RUNS"]);
      await subscribe("pending@example.test", ["RSVP_ASK"], { confirmedAt: null });

      expect(await queueRsvpAsks(db, NOW)).toBe(3);

      const rows = await asks();
      expect(rows.map((row) => [row.recipientEmail, row.locale])).toEqual([
        ["ana@example.test", "ro"],
        ["dan@example.test", "ro"],
        ["ion@example.test", "en"],
      ]);
      expect(await askRows()).toEqual([expect.objectContaining({ eventId: event.id, recipients: 3 })]);
      // Nothing secret and no address in the payload: the ids, so the links are minted when it is SENT.
      for (const row of rows) {
        expect(Object.keys(row.payloadJson as object).sort()).toEqual(["eventId", "subscriberId"]);
        expect(JSON.stringify(row.payloadJson)).not.toContain("@");
        expect(row.status).toBe("PENDING");
      }
      // Asking creates no «Vin!» row yet: that is made at the send.
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("asks only a subscriber whose consent was given under a notice that names the question — «Toate noutățile» ticked earlier agreed to less", async () => {
      await resetTables(db);
      await approveNotice(1, true, false);
      const event = await seedEvent();
      // Consented to everything under version 1, which says nothing of the question; and to the topic itself, by a manage-page tick, under 2.
      await subscribe("old-all@example.test", ["ALL"], { privacyNoticeVersion: 1 });
      await subscribe("old-topic@example.test", ["RSVP_ASK"], { privacyNoticeVersion: 1 });
      await approveNotice(2, true, true);
      await subscribe("new-all@example.test", ["ALL"], { privacyNoticeVersion: 2 });
      await subscribe("new-topic@example.test", ["RSVP_ASK"], { privacyNoticeVersion: 2 });

      expect(await queueRsvpAsks(db, NOW)).toBe(2);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["new-all@example.test", "new-topic@example.test"]);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("withdraws, at the send, a question queued for a subscriber whose recorded consent predates the notice that names it", async () => {
      await resetTables(db);
      await approveNotice(1, true, false);
      const event = await seedEvent();
      await approveNotice(2, true, true);
      const subscriber = await subscribe("ana@example.test", ["ALL"], { privacyNoticeVersion: 2 });
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      await db.update(newsletterSubscribers).set({ privacyNoticeVersion: 1 }).where(eq(newsletterSubscribers.id, subscriber.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("does not ask a subscriber whose address already has a counted answer — however the address is spelled — but asks an unconfirmed one", async () => {
      const event = await seedEvent();
      await subscribe("Ana.Pop+club@gmail.com", ["RSVP_ASK"]);
      await subscribe("dan@example.test", ["RSVP_ASK"]);
      await answerRsvp(db, event.id, identityOf("remembered", { email: "ana.pop@gmail.com", showName: false, locale: "ro" }), NOW);
      await answerRsvp(db, event.id, identityOf("page", { email: "dan@example.test", showName: false, locale: "ro" }), NOW);

      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      expect((await asks()).map((row) => row.recipientEmail)).toEqual(["dan@example.test"]);
      expect((await askRows())[0].recipients).toBe(1);
    });

    it("gives an event with nobody to ask its row all the same, and a subscriber who joins later is not asked about it", async () => {
      const event = await seedEvent();
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toEqual([expect.objectContaining({ eventId: event.id, recipients: 0 })]);

      await subscribe("late@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(0);
      expect(await asks()).toHaveLength(0);
    });
  });

  describe("when, once", () => {
    it("asks once: a second run, an overlapping one and a later one the same day queue nothing", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      const [first, second] = await Promise.all([queueRsvpAsks(db, NOW), queueRsvpAsks(db, NOW)]);
      expect(first + second).toBe(1);
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + 6 * HOUR))).toBe(0);
      expect(await asks()).toHaveLength(1);
      expect(await askRows()).toHaveLength(1);
      expect((await askRows())[0].eventId).toBe(event.id);
    });

    it("waits for 08:00 club time on the day before, and asks at the first run after it", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      // 07:59 club time (04:59Z): not yet; the night's runs ask nobody.
      expect(await queueRsvpAsks(db, new Date("2026-10-17T04:59:00.000Z"))).toBe(0);
      expect(await askRows()).toHaveLength(0);
      // 08:00 sharp, summer time.
      expect(await queueRsvpAsks(db, new Date("2026-10-17T05:00:00.000Z"))).toBe(1);
    });

    it("does not ask on the day itself: an event ticked after its window closed is never asked", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, new Date("2026-10-18T05:30:00.000Z"))).toBe(0);
      expect(await askRows()).toHaveLength(0);
      // Nor two days ahead.
      expect(await queueRsvpAsks(db, new Date("2026-10-16T09:00:00.000Z"))).toBe(0);
      expect(await askRows()).toHaveLength(0);
    });

    it("asks at the first run after the tick when it is saved late on the day before", async () => {
      const event = await seedEvent({ rsvpEnabled: false });
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, new Date("2026-10-17T18:00:00.000Z"))).toBe(0);
      await db.update(events).set({ rsvpEnabled: true }).where(eq(events.id, event.id));
      expect(await queueRsvpAsks(db, new Date("2026-10-17T19:00:00.000Z"))).toBe(1);
    });

    it.each([
      ["the club did not tick it", { rsvpEnabled: false }],
      ["it was cancelled", { eventStatus: "CANCELLED" as const }],
      ["it takes registrations on the site", { registrationMode: "INTERNAL" as const }],
      ["it is a draft", { editorialStatus: "DRAFT" as const }],
      ["it is for the members alone", { membersOnly: true }],
      ["its date is to be announced", { dateToBeAnnounced: true }],
      ["its time is to be announced", { timeToBeAnnounced: true }],
    ])("never asks when %s — and writes no row, so it is asked once it is on", async (_label, overrides) => {
      const event = await seedEvent(overrides);
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      expect(await asks()).toHaveLength(0);
      expect(event.id).toBeTruthy();
    });

    it("never asks while the privacy notice in force does not describe «Vin!», and asks when the club approves one that does", async () => {
      await resetTables(db);
      await approveNotice(1, false);
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      await approveNotice(2, true);
      // The subscriber chose the topic under the new notice (the manage page records its version): only then is the question theirs.
      await db.update(newsletterSubscribers).set({ privacyNoticeVersion: 2 });
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(1);
    });

    it("never asks under a notice that describes «Vin!» but not the question (`{{rsvpAsk}}`), and asks when the club approves one that does", async () => {
      await resetTables(db);
      await approveNotice(1, true, false);
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(0);
      expect(await askRows()).toHaveLength(0);
      await approveNotice(2, true, true);
      await db.update(newsletterSubscribers).set({ privacyNoticeVersion: 2 });
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(1);
    });

    it("leaves a cancelled event's row where it was, and does not ask it again if it is put back the same day", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(1);
      await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + HOUR))).toBe(0);
      expect(await askRows()).toHaveLength(1);
      await db.update(events).set({ eventStatus: "SCHEDULED" }).where(eq(events.id, event.id));
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + 2 * HOUR))).toBe(0);
      expect(await asks()).toHaveLength(1);
    });

    it("is a step of the maintenance job, counted in its result, and a quiet run costs it nothing", async () => {
      await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      const first = await runRegistrationMaintenance(db, NOW);
      expect(first.rsvpAsksQueued).toBe(1);
      expect(first.errorCount).toBe(0);
      const second = await runRegistrationMaintenance(db, new Date(NOW.getTime() + HOUR));
      expect(second.rsvpAsksQueued).toBe(0);
    });

    it("wakes the job at the window's opening, so a sleeping job does not miss the morning", async () => {
      await seedEvent();
      // Thursday noon: the next look is Saturday 08:00 club time (05:00Z).
      const next = await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"));
      expect(next?.toISOString()).toBe("2026-10-17T05:00:00.000Z");
      // Once the row exists, there is nothing left to wake for.
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      expect(await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"))).toBeNull();
    });

    it("does not wake the job for an event nobody can be asked about (unticked, cancelled, registering, the members', undated)", async () => {
      await seedEvent({ rsvpEnabled: false });
      await seedEvent({ eventStatus: "CANCELLED" });
      await seedEvent({ registrationMode: "INTERNAL" });
      await seedEvent({ membersOnly: true });
      await seedEvent({ dateToBeAnnounced: true });
      await seedEvent({ timeToBeAnnounced: true });
      expect(await nextMaintenanceWork(db, new Date("2026-10-15T09:00:00.000Z"))).toBeNull();
    });
  });

  describe("the email and its two links", () => {
    async function asked(email = "ana@example.test", locale: "ro" | "en" = "ro", eventOverrides: Partial<typeof events.$inferInsert> = {}) {
      const event = await seedEvent(eventOverrides);
      const subscriber = await subscribe(email, ["RSVP_ASK"], { locale });
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      return { event, subscriber, row };
    }

    it("reads «Vii mâine la <event>?» with the event's facts, «Vin» and «Nu vin» as token pages, the newsletter's way out and the calendar file", async () => {
      const { row } = await asked();
      const message = await renderOutboxMessage(row, db, NOW);
      expect(message.subject).toBe("Vii mâine la Alergarea de duminică? / Coming to Sunday run tomorrow?");
      expect(message.to).toBe("ana@example.test");
      // The question, the two answers, both languages in one message with the row's language first (§96).
      expect(message.text).toContain("Vii mâine la Alergarea de duminică?");
      expect(message.text).toContain("Vin");
      expect(message.text).toContain("Nu vin");
      expect(message.text).toContain("Are you coming to Sunday run tomorrow?");
      // The press needs two taps (a GET never counts): the email says so, and names the topic that brought it.
      expect(message.text).toContain("Apasă „Vin”, apoi „Da, vin” pe pagina care se deschide");
      expect(message.text).toContain("Primești noutățile clubului despre: „Întrebarea «Vii?» înaintea alergărilor”.");
      expect(message.text.indexOf("Alergarea de duminică")).toBeLessThan(message.text.indexOf("Sunday run"));
      // The event's facts block (§392): the place and the day.
      expect(message.text).toContain("Parcul Tractorul");
      // Two token pages, and the newsletter's own manage link; the event's calendar file rides along.
      const [yes, no] = linksOf(message.text);
      expect(yes).not.toBe(no);
      expect(message.text).toMatch(/\/ro\/vin\/[A-Za-z0-9_-]{43}/);
      expect(message.text).toMatch(/\/ro\/noutati\/abonament\/[A-Za-z0-9_-]{43}/);
      expect(message.attachments?.some((file) => file.filename.endsWith(".ics"))).toBe(true);
      // No raw address in any link, and the secrets are not what is stored.
      const links = [...message.text.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
      expect(links.length).toBeGreaterThan(1);
      for (const link of links) {
        expect(link).not.toContain("ana@example.test");
        expect(link).not.toContain("ana%40example.test");
      }
      for (const stored of await db.select().from(eventRsvpTokens)) {
        expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect([yes, no]).not.toContain(stored.tokenHash);
      }
      expect(message.html).not.toContain(`href="mailto:ana@example.test`);
    });

    it("is written in English, with /coming/ links, for a subscriber who left their address on the English page", async () => {
      const { row } = await asked("ion@example.test", "en");
      const message = await renderOutboxMessage(row, db, NOW);
      expect(message.subject).toBe("Coming to Sunday run tomorrow? / Vii mâine la Alergarea de duminică?");
      expect(message.text).toMatch(/\/en\/coming\/[A-Za-z0-9_-]{43}/);
      expect(message.text.indexOf("Sunday run")).toBeLessThan(message.text.indexOf("Alergarea de duminică"));
    });

    it("makes the subscriber's answer at the send — unconfirmed, nameless, marked asked — and mints «Vin» and «Nu vin» for it", async () => {
      const { event, row } = await asked();
      expect(await rowsOf(event.id)).toHaveLength(0);
      const message = await renderOutboxMessage(row, db, NOW);
      const [answer] = await rowsOf(event.id);
      expect(answer).toMatchObject({ canonicalEmail: "ana@example.test", confirmedAt: null, displayName: null, showName: false, locale: "ro" });
      expect(answer.askedAt).not.toBeNull();
      const tokens = await db.select().from(eventRsvpTokens).where(eq(eventRsvpTokens.rsvpId, answer.id));
      expect(tokens.map((token) => token.purpose).sort()).toEqual(["RSVP_CONFIRM", "RSVP_WITHDRAW"]);
      const [yes, no] = linksOf(message.text);
      expect(await readRsvpLink(db, yes, NOW)).toMatchObject({ purpose: "RSVP_CONFIRM", state: "live", asked: true, named: false, confirmed: false });
      expect(await readRsvpLink(db, no, NOW)).toMatchObject({ purpose: "RSVP_WITHDRAW", state: "live", asked: true });
      // A GET counts nobody: opening both links, as a scanner does, leaves the count at zero.
      expect(await countRsvps(db, event.id)).toBe(0);
    });

    it("counts the subscriber at once on «Vin», with no second email, no name they did not type, and the browser to be remembered", async () => {
      const { event, row } = await asked();
      const [yes] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      const proved = await confirmRsvp(db, yes, new Date(NOW.getTime() + HOUR));
      expect(proved).toMatchObject({ eventId: event.id, email: "ana@example.test", displayName: null });
      expect(await countRsvps(db, event.id)).toBe(1);
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: [], others: 1 });
      // The link is single use.
      expect(await confirmRsvp(db, yes, new Date(NOW.getTime() + 2 * HOUR))).toBeNull();
      // Nothing was mailed back: the only RSVP messages are the ask itself.
      expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM")))).toHaveLength(0);
    });

    it("takes the optional name and the tick from the same press, and shows the name only when ticked", async () => {
      const { event, row } = await asked();
      const [yes] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      await confirmRsvp(db, yes, NOW, { displayName: "  Ana   Pop ", showName: true });
      const [answer] = await rowsOf(event.id);
      expect(answer).toMatchObject({ displayName: "Ana Pop", showName: true });
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: ["Ana Pop"], others: 0 });
    });

    it("keeps a name given without the tick out of the public list", async () => {
      const { event, row } = await asked();
      const [yes] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      await confirmRsvp(db, yes, NOW, { displayName: "Ana", showName: false });
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: [], others: 1 });
    });

    it("counts nobody on «Nu vin»: the answer is deleted, the count stays at zero, and no browser is remembered (ask-page.test.ts)", async () => {
      const { event, row } = await asked();
      const [, no] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      const proved = await withdrawRsvp(db, { token: no }, new Date(NOW.getTime() + HOUR));
      expect(proved).toMatchObject({ eventId: event.id, email: "ana@example.test" });
      expect(await rowsOf(event.id)).toHaveLength(0);
      expect(await countRsvps(db, event.id)).toBe(0);
      // And the person is not asked again: the event's row is the "once".
      expect(await queueRsvpAsks(db, new Date(NOW.getTime() + 2 * HOUR))).toBe(0);
    });

    it("lets a «Nu vin» become «Vin» later from the event's page, as for any other answer", async () => {
      const { event, row } = await asked();
      const [, no] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      await withdrawRsvp(db, { token: no }, NOW);
      await answerRsvp(db, event.id, identityOf("remembered", { email: "ana@example.test", showName: false, locale: "ro" }), new Date(NOW.getTime() + HOUR));
      expect(await countRsvps(db, event.id)).toBe(1);
    });

    it("clears a name and a tick a stranger typed for the address before the email's press (the page's own message not yet sent)", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Mallory", showName: true, locale: "ro" }), NOW);
      await queueRsvpAsks(db, NOW);
      const [ask] = await asks();
      const [yes] = linksOf((await renderOutboxMessage(ask, db, NOW)).text);
      const [answer] = await rowsOf(event.id);
      expect(answer).toMatchObject({ displayName: null, showName: false });
      await confirmRsvp(db, yes, NOW);
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: [], others: 1 });
    });

    it("drops the question, and leaves the page's answer and its live «Da, vin» link alone, when the address typed on the page has that link", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: true, locale: "ro" }), NOW);
      const [typedMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"));
      const [older] = linksOf((await renderOutboxMessage(typedMessage, db, NOW)).text);
      await queueRsvpAsks(db, new Date(NOW.getTime() + 2 * HOUR));
      const [ask] = await asks();
      await expect(renderOutboxMessage(ask, db, new Date(NOW.getTime() + 2 * HOUR))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      // Nothing of the typed answer was touched, and its link was not superseded: it still opens and counts.
      expect((await rowsOf(event.id))[0]).toMatchObject({ displayName: "Ana", showName: true, askedAt: null });
      expect(await readRsvpLink(db, older, NOW)).toMatchObject({ state: "live" });
      await confirmRsvp(db, older, NOW);
      expect(await countRsvps(db, event.id)).toBe(1);
    });

    it("does not let a press rename a row the person typed on the page themselves", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: true, locale: "ro" }), NOW);
      const [typedMessage] = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"));
      const [confirm] = linksOf((await renderOutboxMessage(typedMessage, db, NOW)).text);
      // A name posted to a link that was not the email's «Vin» is ignored: the row was not asked.
      await confirmRsvp(db, confirm, NOW, { displayName: "Someone Else", showName: false });
      expect((await rowsOf(event.id))[0]).toMatchObject({ displayName: "Ana", showName: true });
    });

    it.each([
      ["the subscriber unsubscribed", async (ctx: { subscriberId: string }) => void (await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, ctx.subscriberId)))],
      ["the event was cancelled", async (ctx: { eventId: string }) => void (await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, ctx.eventId)))],
      ["the club unticked the event", async (ctx: { eventId: string }) => void (await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, ctx.eventId)))],
      ["the event was given a registration", async (ctx: { eventId: string }) => void (await db.update(events).set({ registrationMode: "INTERNAL" }).where(eq(events.id, ctx.eventId)))],
      ["the event became the members'", async (ctx: { eventId: string }) => void (await db.update(events).set({ membersOnly: true }).where(eq(events.id, ctx.eventId)))],
    ])("is withdrawn, not failed, when %s before it is sent", async (_label, change) => {
      const { event, subscriber, row } = await asked();
      await change({ eventId: event.id, subscriberId: subscriber.id });
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("writes nothing while the message is checked: the row and the links are made by the last step alone", async () => {
      const { event, subscriber } = await asked();
      const checked = await checkRsvpAsk(db, { eventId: event.id, subscriberId: subscriber.id, recipientEmail: "ana@example.test", now: NOW });
      expect(await rowsOf(event.id)).toHaveLength(0);
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
      const made = await makeRsvpAsk(db, checked);
      expect(await rowsOf(event.id)).toHaveLength(1);
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(2);
      expect(made.confirm).not.toBe(made.withdraw);
    });

    it("is withdrawn when it would be sent after the start, and when the address is already counted", async () => {
      const { event, row } = await asked();
      await expect(renderOutboxMessage(row, db, new Date(STARTS_AT.getTime() + 60_000))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await answerRsvp(db, event.id, identityOf("remembered", { email: "ana@example.test", showName: false, locale: "ro" }), NOW);
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await countRsvps(db, event.id)).toBe(1);
    });

    it("is withdrawn when the notice stops describing «Vin!» before it is sent", async () => {
      const { row } = await asked();
      await approveNotice(2, false);
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    });

    it("is withdrawn, and writes no row, when the notice in force stops naming the question (`{{rsvpAsk}}`) before it is sent", async () => {
      const { event, row } = await asked();
      await approveNotice(2, true, false);
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("is withdrawn when the subscriber unticked the topic after the morning's queue — and no row carries their address", async () => {
      const { event, subscriber, row } = await asked();
      await db.update(newsletterSubscribers).set({ topics: ["WEEKLY_RUNS"] }).where(eq(newsletterSubscribers.id, subscriber.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
      // «Toate noutățile» still receives it.
      await db.update(newsletterSubscribers).set({ topics: ["ALL"] }).where(eq(newsletterSubscribers.id, subscriber.id));
      await expect(renderOutboxMessage(row, db, NOW)).resolves.toBeDefined();
    });

    it("is withdrawn when the send is held past midnight into the event's day, and when the event moved out of «tomorrow»", async () => {
      const { event, row } = await asked();
      // 00:05 club time on Sunday (21:05Z on Saturday): the day itself, where «mâine» would be a lie.
      await expect(renderOutboxMessage(row, db, new Date("2026-10-17T21:05:00.000Z"))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await rowsOf(event.id)).toHaveLength(0);
      // Still fine at 23:55 on Saturday.
      await expect(renderOutboxMessage(row, db, new Date("2026-10-17T20:55:00.000Z"))).resolves.toBeDefined();
      // The event moved a day later after the queue: «tomorrow» is no longer Sunday.
      await db.update(events).set({ startsAt: new Date(STARTS_AT.getTime() + DAY) }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    });

    it("draws the two buttons as the HTML links they are: «Vin» to the confirm token's page, «Nu vin» to the withdraw token's", async () => {
      const { row } = await asked();
      const message = await renderOutboxMessage(row, db, NOW);
      const [yes, no] = linksOf(message.text);
      const hrefOf = (label: string) => message.html.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*>\\s*${label}\\s*</a>`))?.[1];
      expect(hrefOf("Vin")).toContain(`/ro/vin/${yes}`);
      expect(hrefOf("Nu vin")).toContain(`/ro/vin/${no}`);
    });

    it("re-renders to a fresh pair of links, the older pair dying with it (a retried send)", async () => {
      const { row } = await asked();
      const [yes1] = linksOf((await renderOutboxMessage(row, db, NOW)).text);
      const [yes2] = linksOf((await renderOutboxMessage(row, db, new Date(NOW.getTime() + 60_000))).text);
      expect(yes2).not.toBe(yes1);
      expect(await readRsvpLink(db, yes1, new Date(NOW.getTime() + 60_000))).toMatchObject({ state: "used" });
      expect(await readRsvpLink(db, yes2, new Date(NOW.getTime() + 60_000))).toMatchObject({ state: "live" });
      expect((await rowsOf((await db.select().from(eventRsvps))[0].eventId))).toHaveLength(1);
    });
  });

  describe("an unanswered question is not an answer", () => {
    async function askedAndSent() {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      const [row] = await asks();
      const message = await renderOutboxMessage(row, db, NOW);
      return { event, message };
    }

    it("stays out of the editor's fold and counts, until the person presses «Vin»", async () => {
      const { event, message } = await askedAndSent();
      expect(await rowsOf(event.id)).toHaveLength(1);
      expect(await countRsvpsForAdmin(db, event.id)).toEqual({ confirmed: 0, unconfirmed: 0 });
      expect(await listRsvpsForAdmin(db, event.id)).toEqual([]);
      await confirmRsvp(db, linksOf(message.text)[0], NOW);
      expect(await countRsvpsForAdmin(db, event.id)).toEqual({ confirmed: 1, unconfirmed: 0 });
      expect((await listRsvpsForAdmin(db, event.id)).map((entry) => entry.email)).toEqual(["ana@example.test"]);
    });

    it("keeps an address typed on the page in the fold as unconfirmed — only the email's question is left out", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, identityOf("page", { email: "dan@example.test", showName: false, locale: "ro" }), NOW);
      expect(await countRsvpsForAdmin(db, event.id)).toEqual({ confirmed: 0, unconfirmed: 1 });
    });

    it("sends no withdraw link from «Nu mai vin» on the page for an address that only has the question, and does for a typed one", async () => {
      const { event } = await askedAndSent();
      const before = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"))).length;
      await requestWithdrawLink(db, event.id, { email: "ana@example.test", locale: "ro" }, NOW);
      expect(await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"))).toHaveLength(before);
      // A typed answer is the person's: the withdraw link goes.
      await answerRsvp(db, event.id, identityOf("page", { email: "dan@example.test", showName: false, locale: "ro" }), NOW);
      const typed = (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"))).length;
      await requestWithdrawLink(db, event.id, { email: "dan@example.test", locale: "ro" }, new Date(NOW.getTime() + 11 * 60_000));
      expect((await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM"))).length).toBe(typed + 1);
    });

    it("becomes the page's own answer when the address is typed there afterwards: its links no longer open the «Vii?» wording", async () => {
      const { event } = await askedAndSent();
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), new Date(NOW.getTime() + 11 * 60_000));
      const [answer] = await rowsOf(event.id);
      expect(answer.askedAt).toBeNull();
      const typed = (await db.select().from(emailOutbox).where(and(eq(emailOutbox.messageType, "RSVP_CONFIRM"), eq(emailOutbox.recipientEmail, "ana@example.test"))))[0];
      const [yes] = linksOf((await renderOutboxMessage(typed, db, new Date(NOW.getTime() + 12 * 60_000))).text);
      expect(await readRsvpLink(db, yes, new Date(NOW.getTime() + 12 * 60_000))).toMatchObject({ purpose: "RSVP_CONFIRM", state: "live", asked: false });
    });

    it("tells a declined question from a taken-back answer: «Nu vin» on the unanswered row says unanswered", async () => {
      const { message } = await askedAndSent();
      const [, no] = linksOf(message.text);
      expect(await withdrawRsvp(db, { token: no }, NOW)).toMatchObject({ email: "ana@example.test", unanswered: true });
    });

    it("…and «Nu mai vin» after «Vin» does not: the person answered, so it is a taken-back answer", async () => {
      const { message } = await askedAndSent();
      const [yes, no] = linksOf(message.text);
      await confirmRsvp(db, yes, NOW);
      expect(await withdrawRsvp(db, { token: no }, NOW)).toMatchObject({ email: "ana@example.test", unanswered: false });
    });

    it("is deleted at once, with its link, when the subscriber unsubscribes", async () => {
      const { event } = await askedAndSent();
      const [admin] = await db
        .insert(staffUsers)
        .values({ email: "admin@example.test", displayName: "Admin", role: "ADMIN" })
        .returning();
      const [subscriber] = await db.select().from(newsletterSubscribers);
      expect(await rowsOf(event.id)).toHaveLength(1);
      expect(await unsubscribeNewsletterSubscriber(db, admin, subscriber.id, NOW)).toBe(true);
      expect(await rowsOf(event.id)).toHaveLength(0);
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
    });
  });

  describe("the road: last in line, with the reserve kept for registrations' links", () => {
    function recordingSender(): EmailSender & { calls: OutgoingEmail[] } {
      const calls: OutgoingEmail[] = [];
      return {
        calls,
        async send(message) {
          calls.push(message);
          return { outcome: "sent", providerMessageId: "provider:x" };
        },
      };
    }

    it("holds the questions back when the day's allowance is under the reserve, and leaves them untouched, not failed", async () => {
      await seedEvent();
      for (let index = 0; index < 8; index += 1) await subscribe(`s${index}@example.test`, ["RSVP_ASK"]);
      expect(await queueRsvpAsks(db, NOW)).toBe(8);
      // Mailgun Free, 100 a day: 53 sent today leaves 47, under the 50 kept for registrations' links.
      for (let index = 0; index < 53; index += 1) {
        await db.insert(emailOutbox).values({
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: `sent${index}@example.test`,
          payloadJson: {},
          idempotencyKey: `sent:${index}`,
          status: "SENT",
          sentAt: new Date(NOW.getTime() - 60_000),
          createdAt: new Date(NOW.getTime() - HOUR),
        });
      }
      const sender = recordingSender();
      await processOutboxBatch(db, { sender, render: renderOutboxMessage, now: new Date(NOW.getTime() + 2000) });
      expect(sender.calls).toHaveLength(0);
      const held = await asks();
      expect(held.every((row) => row.status === "PENDING" && row.attemptCount === 0)).toBe(true);
    });
  });

  describe("the sweep", () => {
    it("deletes an event's mark thirty days after the event, with its other rows — not before, and not at a cancellation", async () => {
      const event = await seedEvent();
      const other = await seedEvent({ startsAt: new Date(STARTS_AT.getTime() + 20 * DAY), publishedAt: new Date(NOW.getTime() - DAY) });
      await db.insert(eventRsvpAsks).values([{ eventId: event.id, recipients: 2 }, { eventId: other.id, recipients: 1 }]);

      const early = new Date(STARTS_AT.getTime() + (RETENTION.rsvpDaysAfterEvent - 1) * DAY);
      expect((await pruneExpiredRows(db, early)).rsvpAsks).toBe(0);
      expect(await askRows()).toHaveLength(2);

      const late = new Date(STARTS_AT.getTime() + (RETENTION.rsvpDaysAfterEvent + 1) * DAY);
      const outcome = await pruneExpiredRows(db, late);
      expect(outcome.rsvpAsks).toBe(1);
      expect(outcome.failures).toEqual([]);
      expect((await askRows()).map((row) => row.eventId)).toEqual([other.id]);

      // A cancelled event's mark stays: put back the same day it must not be asked a second time.
      await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, other.id));
      await pruneExpiredRows(db, NOW);
      expect(await askRows()).toHaveLength(1);
    });

    it("lets the unanswered rows an email made go after the seven days every unconfirmed answer lives", async () => {
      const event = await seedEvent();
      await subscribe("ana@example.test", ["RSVP_ASK"]);
      await queueRsvpAsks(db, NOW);
      await renderOutboxMessage((await asks())[0], db, NOW);
      expect(await rowsOf(event.id)).toHaveLength(1);
      const outcome = await pruneExpiredRows(db, new Date(NOW.getTime() + (RETENTION.rsvpUnconfirmedDays + 1) * DAY));
      expect(outcome.rsvps).toBe(1);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });
  });
});
