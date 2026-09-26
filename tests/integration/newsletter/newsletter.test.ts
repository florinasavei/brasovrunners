import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { newsletterSends, newsletterSubscribers, newsletterTokens } from "@/db/schema/newsletter";
import { staffUsers } from "@/db/schema/staff-users";
import type { OutgoingEmail, SendResult } from "@/infrastructure/email/adapter";
import type { EmailSender } from "@/infrastructure/email/delivery";
import { pruneExpiredRows } from "@/modules/jobs/retention";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import {
  confirmNewsletter,
  countNewsletterAudience,
  queueNewEventAlerts,
  readNewsletterConfirmation,
  readNewsletterSubscription,
  sendNewsletter,
  subscribeToNewsletter,
  unsubscribeNewsletter,
  updateNewsletterTopics,
  withdrawNewsletterAddress,
} from "@/modules/newsletter/service";
import { checkEmailHealth } from "@/modules/notifications/health";
import { nextAllowanceResetAt } from "@/modules/notifications/domain/retry";
import { processOutboxBatch } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();
const SEND_ID = "5b0f3a0e-8a36-4e0c-9d7e-2f1a7f6d3c11";

function recordingSender(result: SendResult = { outcome: "sent", providerMessageId: "provider:x" }): EmailSender & { calls: OutgoingEmail[] } {
  const calls: OutgoingEmail[] = [];
  return {
    calls,
    async send(message) {
      calls.push(message);
      return result;
    },
  };
}

/** The secret in a rendered link's path, whichever page it opens. */
function secretIn(message: OutgoingEmail, page: "confirm" | "manage"): string {
  const pattern = page === "confirm" ? /(?:noutati\/confirmare|newsletter\/confirm)\/([A-Za-z0-9_-]{43})/ : /(?:noutati\/abonament|newsletter\/manage)\/([A-Za-z0-9_-]{43})/;
  const match = message.text.match(pattern);
  if (!match) throw new Error(`no ${page} link in the message`);
  return match[1];
}

/**
 * The newsletter (§NNN), end to end on real PostgreSQL: the pop-up's gate and its one answer, the
 * double opt-in, the subscriber's own page, the send to one topic, the new-event alert once per
 * event, the reserve the outbox keeps for registrations, and the retention sweep.
 */
describe("§NNN the newsletter: consent, links, sends and the allowance", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  async function approveNotice(options: { describesNewsletter: boolean; version?: number }) {
    const paragraph = options.describesNewsletter ? "Noutățile clubului: temele {{newsletterTopics}}." : "p";
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: { sections: [{ paragraphs: [paragraph] }] } },
      { locale: "en", title: "Privacy", body: { sections: [{ paragraphs: [paragraph.replace("Noutățile clubului: temele", "The club's news: topics")] }] } },
    ];
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version: options.version ?? 1,
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  const form = (email: string, topics: string[], extra: Record<string, unknown> = {}) => ({ email, locale: "ro", topics, renderedAt: RENDERED, ...extra });

  async function outboxOf(type: "NEWSLETTER_CONFIRM" | "NEWSLETTER" | "NEW_EVENT_ALERT") {
    return db.select().from(emailOutbox).where(eq(emailOutbox.messageType, type));
  }

  /** Subscribe and confirm, through the real messages: what a person does from the pop-up. */
  async function subscribed(email: string, topics: string[], locale: "ro" | "en" = "ro") {
    await subscribeToNewsletter(db, form(email, topics, { locale }), NOW);
    const [row] = (await outboxOf("NEWSLETTER_CONFIRM")).filter((candidate) => candidate.recipientEmail === email).slice(-1);
    const message = await renderOutboxMessage(row, db, NOW);
    expect(await confirmNewsletter(db, secretIn(message, "confirm"), NOW)).toBe(true);
    const [subscriber] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.deliveryEmail, email));
    return subscriber;
  }

  async function staff(role: "CONTRIBUTOR" | "COPYWRITER" | "MODERATOR" | "DEV" | "ADMIN" | "SUPERADMIN") {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.org`, displayName: role, role }).returning();
    return row;
  }

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({
        type: "RACE",
        startsAt: new Date(NOW.getTime() + 30 * DAY),
        editorialStatus: "PUBLISHED",
        publishedAt: new Date(NOW.getTime() - 60 * 60_000),
        locationName: "Parcul Tractorul",
        ...overrides,
      })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `crosul-${event.id.slice(0, 8)}`, title: "Crosul aniversar" },
      { eventId: event.id, locale: "en", slug: `cross-${event.id.slice(0, 8)}`, title: "The anniversary cross" },
    ]);
    return event;
  }

  describe("the pop-up's gate and its one answer", () => {
    it("takes no address while the notice in force does not describe the newsletter", async () => {
      await approveNotice({ describesNewsletter: false });
      const refusal = await subscribeToNewsletter(db, form("ana@example.org", ["DISCOUNTS"]), NOW).catch((error: unknown) => error);
      expect(isDomainError(refusal) && refusal.code).toBe("CONFLICT");
      expect(await db.select().from(newsletterSubscribers)).toEqual([]);
      expect(await db.select().from(emailOutbox)).toEqual([]);
    });

    it("keeps an unconfirmed address, and sends it the confirmation link and nothing else", async () => {
      await approveNotice({ describesNewsletter: true, version: 3 });
      expect(await subscribeToNewsletter(db, form("Ana.Pop+club@gmail.com", ["DISCOUNTS", "NEW_EVENTS"]), NOW)).toBe("done");
      const [subscriber] = await db.select().from(newsletterSubscribers);
      expect(subscriber).toMatchObject({ canonicalEmail: "ana.pop@gmail.com", topics: ["NEW_EVENTS", "DISCOUNTS"], confirmedAt: null, privacyNoticeVersion: 3 });
      const rows = await db.select().from(emailOutbox);
      expect(rows.map((row) => row.messageType)).toEqual(["NEWSLETTER_CONFIRM"]);
      // Nothing about a participant, no registration, and no club copy (§320).
      expect(rows[0]).toMatchObject({ participantId: null, registrationId: null, recipientEmail: "Ana.Pop+club@gmail.com" });

      const message = await renderOutboxMessage(rows[0], db, NOW);
      expect(message.subject).toContain("Confirmă abonarea");
      expect(message.text).toContain("„Evenimente noi în calendar” și „Coduri de reducere”");
      // The secret is in the message alone: only its hash is stored.
      const secret = secretIn(message, "confirm");
      const tokens = await db.select().from(newsletterTokens);
      expect(tokens).toHaveLength(1);
      expect(tokens[0].tokenHash).not.toContain(secret);
    });

    it("refuses no topic and a malformed address by the box, and answers a bot with the same silence", async () => {
      await approveNotice({ describesNewsletter: true });
      const none = await subscribeToNewsletter(db, form("ana@example.org", []), NOW).catch((error: unknown) => error);
      expect(isDomainError(none) && none.fields).toEqual(["topics"]);
      const bad = await subscribeToNewsletter(db, form("not an address", ["ALL"]), NOW).catch((error: unknown) => error);
      expect(isDomainError(bad) && bad.fields).toEqual(["email"]);
      // A filled trap: the same answer as a person's, and nothing kept.
      expect(await subscribeToNewsletter(db, form("bot@example.org", ["ALL"], { honeypot: "x" }), NOW)).toBe("done");
      expect(await db.select().from(newsletterSubscribers)).toEqual([]);
    });

    it("says 'everything' alone when everything is ticked with the rest", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribeToNewsletter(db, form("ana@example.org", ["DISCOUNTS", "ALL", "VOLUNTEERING"]), NOW);
      const [subscriber] = await db.select().from(newsletterSubscribers);
      expect(subscriber.topics).toEqual(["ALL"]);
    });

    it("answers an address already subscribed with the link to its own page, and changes nothing", async () => {
      await approveNotice({ describesNewsletter: true });
      const subscriber = await subscribed("ana@example.org", ["DISCOUNTS"]);
      expect(await subscribeToNewsletter(db, form("ANA@example.org", ["ALL"]), new Date(NOW.getTime() + 1000))).toBe("done");
      const [after] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriber.id));
      expect(after.topics).toEqual(["DISCOUNTS"]);
      const confirmations = await outboxOf("NEWSLETTER_CONFIRM");
      expect(confirmations).toHaveLength(2);
      const message = await renderOutboxMessage(confirmations[1], db, NOW);
      expect(message.subject).toContain("Abonamentul tău");
      expect(await readNewsletterSubscription(db, secretIn(message, "manage"), NOW)).toMatchObject({ topics: ["DISCOUNTS"] });
    });

    it("throttles one mailbox at three an hour, whoever is typing it", async () => {
      await approveNotice({ describesNewsletter: true });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(await subscribeToNewsletter(db, form("ana@example.org", ["ALL"]), new Date(NOW.getTime() + attempt))).toBe("done");
      }
      expect(await subscribeToNewsletter(db, form("ana@example.org", ["ALL"]), new Date(NOW.getTime() + 10))).toBe("limited");
    });
  });

  describe("the double opt-in and the subscriber's own page", () => {
    it("confirms once: the link is spent, the GET reads without spending, a newer link supersedes an older one", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribeToNewsletter(db, form("ana@example.org", ["ALL"]), NOW);
      const first = await renderOutboxMessage((await outboxOf("NEWSLETTER_CONFIRM"))[0], db, NOW);
      await subscribeToNewsletter(db, form("ana@example.org", ["ALL"]), new Date(NOW.getTime() + 1000));
      const second = await renderOutboxMessage((await outboxOf("NEWSLETTER_CONFIRM"))[1], db, NOW);

      expect(await readNewsletterConfirmation(db, secretIn(first, "confirm"), NOW)).toBeNull();
      const secret = secretIn(second, "confirm");
      expect(await readNewsletterConfirmation(db, secret, NOW)).toMatchObject({ email: "ana@example.org", topics: ["ALL"] });
      const [pending] = await db.select().from(newsletterSubscribers);
      expect(pending.confirmedAt).toBeNull();

      expect(await confirmNewsletter(db, secret, NOW)).toBe(true);
      expect(await confirmNewsletter(db, secret, NOW)).toBe(false);
      const [confirmed] = await db.select().from(newsletterSubscribers);
      expect(confirmed.confirmedAt).toEqual(NOW);
    });

    it("changes the topics from the page and keeps the link; refuses none; unsubscribing deletes everything", async () => {
      await approveNotice({ describesNewsletter: true });
      const subscriber = await subscribed("ana@example.org", ["DISCOUNTS"]);
      const actor = await staff("MODERATOR");
      await sendNewsletter(db, actor, { topic: "DISCOUNTS", subject: { ro: "Reducere", en: "Discount" }, body: { ro: "Cod", en: "Code" }, sendId: SEND_ID }, NOW);
      const [row] = await outboxOf("NEWSLETTER");
      const message = await renderOutboxMessage(row, db, NOW);
      const secret = secretIn(message, "manage");

      expect(await updateNewsletterTopics(db, secret, ["VOLUNTEERING", "CLUB_NEWS"], NOW)).toBe(true);
      expect((await readNewsletterSubscription(db, secret, NOW))?.topics).toEqual(["VOLUNTEERING", "CLUB_NEWS"]);
      const none = await updateNewsletterTopics(db, secret, [], NOW).catch((error: unknown) => error);
      expect(isDomainError(none) && none.fields).toEqual(["topics"]);

      // A newsletter still waiting for this subscriber goes with them.
      await sendNewsletter(
        db,
        actor,
        { topic: "CLUB_NEWS", subject: { ro: "Știri", en: "News" }, body: { ro: "Text", en: "Text" }, sendId: "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f" },
        NOW,
      );
      expect(await unsubscribeNewsletter(db, secret, NOW)).toBe(true);
      expect(await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, subscriber.id))).toEqual([]);
      expect(await db.select().from(newsletterTokens)).toEqual([]);
      const waiting = (await outboxOf("NEWSLETTER")).filter((candidate) => candidate.status === "PENDING");
      expect(waiting).toEqual([]);
      expect(await readNewsletterSubscription(db, secret, NOW)).toBeNull();
    });
  });

  describe("sending a newsletter", () => {
    it("is the organizer's and above, never the Redactor's or the volunteer's", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("ana@example.org", ["ALL"]);
      for (const role of ["CONTRIBUTOR", "COPYWRITER", "DEV"] as const) {
        const actor = await staff(role);
        const refusal = await sendNewsletter(db, actor, { topic: "CLUB_NEWS", subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" }, sendId: SEND_ID }, NOW).catch(
          (error: unknown) => error,
        );
        expect(isDomainError(refusal) && refusal.code, role).toBe("FORBIDDEN");
      }
    });

    it("goes to the topic's subscribers and to everything's, each in their language, once per press, audited without an address", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("ana@example.org", ["DISCOUNTS"]);
      await subscribed("ion@example.org", ["ALL"], "en");
      await subscribed("eva@example.org", ["VOLUNTEERING"]);
      // An address never confirmed hears nothing.
      await subscribeToNewsletter(db, form("mara@example.org", ["DISCOUNTS"]), NOW);
      const actor = await staff("MODERATOR");

      const words = { subject: { ro: "Cod de reducere", en: "A discount code" }, body: { ro: "Cod: X1\n\nValabil o lună.", en: "Code: X1\n\nValid a month." } };
      expect(await sendNewsletter(db, actor, { topic: "DISCOUNTS", ...words, sendId: SEND_ID }, NOW)).toEqual({ kind: "queued", recipients: 2 });
      expect(await sendNewsletter(db, actor, { topic: "DISCOUNTS", ...words, sendId: SEND_ID }, NOW)).toEqual({ kind: "duplicate" });

      const rows = await outboxOf("NEWSLETTER");
      expect(rows.map((row) => `${row.recipientEmail}:${row.locale}`).sort()).toEqual(["ana@example.org:ro", "ion@example.org:en"]);
      const english = await renderOutboxMessage(rows.find((row) => row.locale === "en")!, db, NOW);
      expect(english.subject).toBe("A discount code / Cod de reducere");
      expect(english.text).toContain("Valid a month.");
      expect(english.text).toContain("Choose what you receive, or unsubscribe");

      const [audit] = await db.select().from(auditLogs).where(eq(auditLogs.action, "newsletter.sent"));
      expect(JSON.stringify(audit.metadataJson)).not.toContain("@");
      expect(audit.metadataJson).toMatchObject({ topic: "DISCOUNTS", recipients: 2 });
      expect(JSON.stringify(audit.metadataJson)).not.toContain("Valabil");
    });

    it("refuses a missing language by its box, a placeholder by name, and a topic nobody reads", async () => {
      await approveNotice({ describesNewsletter: true });
      const actor = await staff("ADMIN");
      const half = await sendNewsletter(db, actor, { topic: "DISCOUNTS", subject: { ro: "a", en: "" }, body: { ro: "{participantName}", en: "b" }, sendId: SEND_ID }, NOW).catch(
        (error: unknown) => error,
      );
      expect(isDomainError(half) && half.fields).toEqual(["subjectEn", "bodyRo"]);
      expect(await sendNewsletter(db, actor, { topic: "DISCOUNTS", subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" }, sendId: SEND_ID }, NOW)).toEqual({ kind: "nobody" });
      expect(await db.select().from(newsletterSends)).toEqual([]);
    });

    it("counts the audience per topic, 'everything' in each, the unconfirmed apart", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("ana@example.org", ["DISCOUNTS"]);
      await subscribed("ion@example.org", ["ALL"]);
      await subscribeToNewsletter(db, form("mara@example.org", ["DISCOUNTS"]), NOW);
      const audience = await countNewsletterAudience(db);
      expect(audience).toMatchObject({ confirmed: 2, unconfirmed: 1 });
      expect(audience.byTopic.DISCOUNTS).toBe(2);
      expect(audience.byTopic.VOLUNTEERING).toBe(1);
    });
  });

  describe("the new-event alert", () => {
    it("announces a race once, to new events, big events and everything — never to a topic it is not", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("new@example.org", ["NEW_EVENTS"]);
      await subscribed("big@example.org", ["BIG_EVENTS"]);
      await subscribed("all@example.org", ["ALL"], "en");
      await subscribed("disc@example.org", ["DISCOUNTS"]);
      const race = await seedEvent();

      expect(await queueNewEventAlerts(db, NOW)).toBe(3);
      expect(await queueNewEventAlerts(db, new Date(NOW.getTime() + 60_000))).toBe(0);
      const rows = await outboxOf("NEW_EVENT_ALERT");
      expect(rows.map((row) => row.recipientEmail).sort()).toEqual(["all@example.org", "big@example.org", "new@example.org"]);
      const [send] = await db.select().from(newsletterSends).where(eq(newsletterSends.eventId, race.id));
      expect(send).toMatchObject({ kind: "EVENT_ALERT", topics: ["NEW_EVENTS", "BIG_EVENTS"], recipients: 3 });

      const english = await renderOutboxMessage(rows.find((row) => row.recipientEmail === "all@example.org")!, db, NOW);
      expect(english.subject).toContain("New on the calendar: The anniversary cross");
      expect(english.text).toContain("See the event");
    });

    it("never announces the weekly group run, a later date of a series, a draft, or an event published long ago", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("all@example.org", ["ALL"]);
      await seedEvent({ type: "GROUP_RUN" });
      const source = await seedEvent({ type: "HIKE" });
      await seedEvent({ type: "HIKE", repeatOf: source.id });
      await seedEvent({ editorialStatus: "DRAFT" });
      await seedEvent({ publishedAt: new Date(NOW.getTime() - 10 * DAY) });
      expect(await queueNewEventAlerts(db, NOW)).toBe(1);
      const [row] = await outboxOf("NEW_EVENT_ALERT");
      expect(row.payloadJson).toMatchObject({ eventId: source.id });
    });

    it("marks an event with nobody to tell as seen, so a later subscriber is not told it is new", async () => {
      await approveNotice({ describesNewsletter: true });
      await seedEvent();
      expect(await queueNewEventAlerts(db, NOW)).toBe(0);
      await subscribed("late@example.org", ["ALL"]);
      expect(await queueNewEventAlerts(db, new Date(NOW.getTime() + 60_000))).toBe(0);
    });
  });

  describe("the reserve the outbox keeps for registrations (domain/bulk.ts)", () => {
    it("sends every other message first, the newsletter only up to its share, and holds the rest for the reset without an alarm", async () => {
      // Mailgun Free, 100 a day: 45 already sent today leaves 55, of which 50 are the reserve.
      for (let index = 0; index < 45; index += 1) {
        await db.insert(emailOutbox).values({
          participantId: null,
          registrationId: null,
          messageType: "STAFF_INVITATION",
          locale: "ro",
          recipientEmail: `sent${index}@example.org`,
          payloadJson: {},
          idempotencyKey: `sent:${index}`,
          status: "SENT",
          sentAt: new Date(NOW.getTime() - 60 * 60_000),
          createdAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
        });
      }
      await approveNotice({ describesNewsletter: true });
      for (let index = 0; index < 8; index += 1) await subscribed(`s${index}@example.org`, ["ALL"]);
      // The confirmations went out as ordinary mail; clear them so the count below is the newsletter's.
      await db.update(emailOutbox).set({ status: "SENT", sentAt: new Date(NOW.getTime() - 60_000) }).where(eq(emailOutbox.messageType, "NEWSLETTER_CONFIRM"));
      const actor = await staff("MODERATOR");
      await sendNewsletter(db, actor, { topic: "CLUB_NEWS", subject: { ro: "a", en: "b" }, body: { ro: "c", en: "d" }, sendId: SEND_ID }, NOW);
      // And one transactional message queued after the newsletter.
      await db.insert(emailOutbox).values({
        participantId: null,
        registrationId: null,
        messageType: "STAFF_INVITATION",
        locale: "ro",
        recipientEmail: "colleague@example.org",
        payloadJson: { displayName: "Dan", role: "MODERATOR", inviterName: "Ana" },
        idempotencyKey: "invite:late",
        createdAt: new Date(NOW.getTime() + 1000),
      });

      const sender = recordingSender();
      const later = new Date(NOW.getTime() + 2000);
      const summary = await processOutboxBatch(db, { sender, render: renderOutboxMessage, now: later });
      // 45 + 8 confirmations = 53 sent today → 47 left, 50 reserved → the newsletter may use none.
      expect(sender.calls.map((call) => call.to)).toEqual(["colleague@example.org"]);
      expect(summary.sent).toBe(1);
      const held = await outboxOf("NEWSLETTER");
      expect(held.every((row) => row.status === "PENDING" && row.attemptCount === 0)).toBe(true);
      expect(held.every((row) => row.nextAttemptAt?.getTime() === nextAllowanceResetAt(later).getTime())).toBe(true);

      const health = await checkEmailHealth(db, later);
      expect(health.status).toBe("ok");
      expect(health.waiting).toBe(8);

      // The next day the allowance is back, and the newsletter goes.
      const tomorrow = new Date(nextAllowanceResetAt(later).getTime() + 60_000);
      const next = recordingSender();
      await processOutboxBatch(db, { sender: next, render: renderOutboxMessage, now: tomorrow });
      expect(next.calls).toHaveLength(8);
    });
  });

  describe("withdrawal by hand and retention", () => {
    it("removes an address at the person's request, the Administrator's alone, audited without the address", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("ana@example.org", ["ALL"]);
      const organizer = await staff("MODERATOR");
      const refusal = await withdrawNewsletterAddress(db, organizer, "ana@example.org", NOW).catch((error: unknown) => error);
      expect(isDomainError(refusal) && refusal.code).toBe("FORBIDDEN");
      const admin = await staff("ADMIN");
      expect(await withdrawNewsletterAddress(db, admin, "ANA@example.org", NOW)).toBe(true);
      expect(await withdrawNewsletterAddress(db, admin, "ana@example.org", NOW)).toBe(false);
      const [audit] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "newsletter.address_withdrawn")));
      expect(JSON.stringify(audit)).not.toContain("ana@");
    });

    it("deletes an address never confirmed after eight days, and keeps a confirmed one", async () => {
      await approveNotice({ describesNewsletter: true });
      await subscribed("kept@example.org", ["ALL"]);
      await subscribeToNewsletter(db, form("left@example.org", ["ALL"]), NOW);
      const result = await pruneExpiredRows(db, new Date(NOW.getTime() + 9 * DAY));
      expect(result.failures).toEqual([]);
      const left = await db.select({ email: newsletterSubscribers.deliveryEmail }).from(newsletterSubscribers);
      expect(left).toEqual([{ email: "kept@example.org" }]);
    });
  });
});
