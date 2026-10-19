import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { events } from "@/db/schema/events";
import { newsletterSubscribers, type NewsletterTopic } from "@/db/schema/newsletter";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { readNewsletterSubscription, subscribeToNewsletter, updateNewsletterTopics } from "@/modules/newsletter/service";
import { issueNewsletterToken } from "@/modules/newsletter/tokens";
import { canonicalizeEmail } from "@/modules/participants/domain/canonical-email";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => {},
}));

const NOW = new Date("2026-10-17T06:00:00.000Z");
const RENDERED = new Date(NOW.getTime() - 60_000).toISOString();

/**
 * §818 — «Întrebarea «Vii?» înaintea alergărilor» is a consent the notice must describe, enforced on the SERVER (the pop-up and the
 * manage page only hide the box): refused while the notice in force is silent on it, and the version consented under is recorded
 * when it is ticked, because the question is sent only to a subscriber whose consent predates no notice that names it.
 */
describe("§818 the topic «Întrebarea «Vii?» …» is a consent the notice must describe", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  /** The platform's text, with `{{rsvpAsk}}` taken out when the notice should describe «Vin!» and the newsletter but not the question. */
  async function approveNotice(version: number, describesAsk: boolean) {
    const without = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("{{rsvpAsk}}", "")) as typeof privacyNoticeRo;
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: describesAsk ? privacyNoticeRo : without(privacyNoticeRo) },
      { locale: "en", title: "Privacy", body: describesAsk ? privacyNoticeEn : without(privacyNoticeEn) },
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

  const form = (email: string, topics: string[]) => ({ email, locale: "ro", topics, consent: true, renderedAt: RENDERED });
  const subscriberOf = async (email: string) => {
    const [row] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.canonicalEmail, canonicalizeEmail(email).canonicalEmail));
    return row;
  };

  async function confirmed(email: string, topics: NewsletterTopic[], version: number) {
    const who = canonicalizeEmail(email);
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        deliveryEmail: who.deliveryEmail,
        canonicalEmail: who.canonicalEmail,
        canonicalizationVersion: who.canonicalizationVersion,
        locale: "ro",
        topics,
        privacyNoticeVersion: version,
        confirmedAt: new Date("2026-09-01T00:00:00.000Z"),
      })
      .returning();
    return row;
  }

  const manageLink = (subscriberId: string) =>
    issueNewsletterToken(db, { subscriberId, purpose: "MANAGE", expiresAt: new Date(NOW.getTime() + 86_400_000), now: NOW });

  describe("the pop-up's post (subscribeToNewsletter)", () => {
    it("leaves the topic out while the notice in force does not name the question, and refuses a form with nothing else ticked", async () => {
      await approveNotice(1, false);
      expect(await subscribeToNewsletter(db, form("ana@example.test", ["RSVP_ASK", "WEEKLY_RUNS"]), NOW)).toBe("done");
      expect((await subscriberOf("ana@example.test")).topics).toEqual(["WEEKLY_RUNS"]);

      const refusal = await subscribeToNewsletter(db, form("dan@example.test", ["RSVP_ASK"]), NOW).catch((error: unknown) => error);
      expect(isDomainError(refusal) && refusal.code === "VALIDATION_ERROR" && refusal.fields).toEqual(["topics"]);
      expect(await subscriberOf("dan@example.test")).toBeUndefined();
    });

    it("keeps the topic once a notice names it, and records that notice's version as the consent", async () => {
      await approveNotice(1, false);
      await approveNotice(2, true);
      await subscribeToNewsletter(db, form("ana@example.test", ["RSVP_ASK"]), NOW);
      expect(await subscriberOf("ana@example.test")).toMatchObject({ topics: ["RSVP_ASK"], privacyNoticeVersion: 2 });
    });
  });

  describe("the subscriber's own page (updateNewsletterTopics)", () => {
    it("does not let a hand-made post add the topic while the notice is silent — and spends no link when nothing else is ticked", async () => {
      await approveNotice(1, false);
      const subscriber = await confirmed("ana@example.test", ["WEEKLY_RUNS"], 1);
      const secret = await manageLink(subscriber.id);

      const refusal = await updateNewsletterTopics(db, secret, ["RSVP_ASK"], NOW).catch((error: unknown) => error);
      expect(isDomainError(refusal) && refusal.fields).toEqual(["topics"]);
      expect(await readNewsletterSubscription(db, secret, NOW)).not.toBeNull();

      const successor = await updateNewsletterTopics(db, secret, ["WEEKLY_RUNS", "RSVP_ASK"], NOW);
      expect(successor).toEqual(expect.any(String));
      expect(await subscriberOf("ana@example.test")).toMatchObject({ topics: ["WEEKLY_RUNS"], privacyNoticeVersion: 1 });
    });

    it("records the notice in force as the consent when the topic, or everything, is ticked — and only then", async () => {
      await approveNotice(1, false);
      const topic = await confirmed("topic@example.test", ["WEEKLY_RUNS"], 1);
      const everything = await confirmed("all@example.test", ["WEEKLY_RUNS"], 1);
      const unchanged = await confirmed("unchanged@example.test", ["ALL"], 1);
      await approveNotice(2, true);

      await updateNewsletterTopics(db, await manageLink(topic.id), ["WEEKLY_RUNS", "RSVP_ASK"], NOW);
      await updateNewsletterTopics(db, await manageLink(everything.id), ["ALL"], NOW);
      // Saving «Toate noutățile» again changes nothing the subscriber agreed to: the version they consented under stays.
      await updateNewsletterTopics(db, await manageLink(unchanged.id), ["ALL"], NOW);

      expect(await subscriberOf("topic@example.test")).toMatchObject({ topics: ["WEEKLY_RUNS", "RSVP_ASK"], privacyNoticeVersion: 2 });
      expect(await subscriberOf("all@example.test")).toMatchObject({ topics: ["ALL"], privacyNoticeVersion: 2 });
      expect(await subscriberOf("unchanged@example.test")).toMatchObject({ topics: ["ALL"], privacyNoticeVersion: 1 });
    });

    it("lets a subscriber who has the topic already keep it while the notice goes silent, and deletes the question's unanswered rows when they untick it", async () => {
      await approveNotice(1, true);
      const subscriber = await confirmed("ana@example.test", ["RSVP_ASK", "WEEKLY_RUNS"], 1);
      const [event] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date("2026-10-18T07:00:00.000Z"), registrationMode: "NONE", rsvpEnabled: true }).returning();
      const who = canonicalizeEmail("ana@example.test");
      const row = { deliveryEmail: who.deliveryEmail, canonicalEmail: who.canonicalEmail, canonicalizationVersion: who.canonicalizationVersion, locale: "ro" as const, privacyNoticeVersion: 1 };
      const [other] = await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date("2026-10-25T07:00:00.000Z"), registrationMode: "NONE", rsvpEnabled: true }).returning();
      await db.insert(eventRsvps).values([
        { ...row, eventId: event.id, askedAt: NOW },
        { ...row, eventId: other.id, askedAt: NOW, confirmedAt: NOW },
      ]);
      await approveNotice(2, false);

      // Kept: they had it, and saving the other topics must not strip it.
      const next = await updateNewsletterTopics(db, await manageLink(subscriber.id), ["RSVP_ASK", "BIG_EVENTS"], NOW);
      expect((await subscriberOf("ana@example.test")).topics).toEqual(["BIG_EVENTS", "RSVP_ASK"]);
      expect(await db.select().from(eventRsvps)).toHaveLength(2);

      // Unticked: the unanswered row goes (it is only their address), the answered one stays.
      expect(next).toEqual(expect.any(String));
      await updateNewsletterTopics(db, await manageLink(subscriber.id), ["BIG_EVENTS"], NOW);
      const left = await db.select().from(eventRsvps);
      expect(left).toHaveLength(1);
      expect(left[0].eventId).toBe(other.id);
    });
  });
});
