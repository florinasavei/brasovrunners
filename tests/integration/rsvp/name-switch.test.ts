import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpNoticeVersion, insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { identityOf } from "@/modules/rsvp/domain/identity";
import { answerRsvp, mintRsvpLinks, readPublicRsvps, readRsvpLink, setRsvpShowName, withdrawRsvp } from "@/modules/rsvp/rsvp";
import { isDomainError } from "@/shared/errors/domain-error";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const revalidated = vi.hoisted(() => [] as string[][]);
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: (...contents: string[]) => {
    revalidated.push(contents);
  },
}));

const NOW = new Date("2026-10-20T10:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const STARTS_AT = new Date(NOW.getTime() + 2 * DAY + 6 * HOUR);

/**
 * §NNN (BR-REQ-039-01, BR-REQ-036-02; amends §812) — «Numele meu apare la „Cine vine"»: the service behind the three doors. A person flips
 * their own tick on a CONFIRMED «Vin!» answer — as a verified identity (a remembered browser, a signed-in account) or by a live «Nu mai vin»
 * link that is read and NOT spent. ON needs a name and records the notice in force; OFF keeps the name and needs nothing; only that
 * person's own counted row is touched; the public cache is told once, and only when something changed.
 */
describe("§NNN «Vin!» — the name switch", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    revalidated.length = 0;
    await approveNotice(1, true);
  });

  async function approveNotice(version: number, describes: boolean, effectiveAt = new Date("2026-01-01T00:00:00.000Z")) {
    const translations: LegalDocumentTranslationInput[] = describes
      ? [
          { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
          { locale: "en", title: "Privacy", body: privacyNoticeEn },
        ]
      : [
          { locale: "ro", title: "Confidențialitate", body: { sections: [{ heading: "1", paragraphs: ["Nimic despre răspunsuri."] }] } },
          { locale: "en", title: "Privacy", body: { sections: [{ heading: "1", paragraphs: ["Nothing about answers."] }] } },
        ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version, effectiveAt, isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
  }

  async function seedEvent(overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: STARTS_AT, registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), ...overrides })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `alergare-${event.id.slice(0, 8)}`, title: "Alergarea de joi" },
      { eventId: event.id, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: "Thursday run" },
    ]);
    return event;
  }

  const remembered = (email: string, extra: Partial<Parameters<typeof identityOf>[1]> = {}) =>
    identityOf("remembered", { email, displayName: null, showName: false, locale: "ro", ...extra });
  const who = (email: string) => ({ identity: remembered(email) });
  const rowOf = async (eventId: string, canonical = "ana@example.test") => (await db.select().from(eventRsvps).where(and(eq(eventRsvps.eventId, eventId), eq(eventRsvps.canonicalEmail, canonical))))[0];
  const publicRead = async (eventId: string) => readPublicRsvps(db, eventId, { firstRsvpNoticeVersion: await findFirstRsvpNoticeVersion(db) });
  /** A counted answer, as a remembered browser makes it: with or without a stored name, never ticked. */
  const answer = (eventId: string, email: string, displayName: string | null = "Ana Popescu") => answerRsvp(db, eventId, remembered(email, { displayName, showName: false }), NOW);

  describe("turning it ON", () => {
    it("shows the stored name at once, records the notice in force and tells the public cache once", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      await approveNotice(2, true, new Date(NOW.getTime() - HOUR));
      expect((await publicRead(event.id)).names).toEqual([]);
      revalidated.length = 0;

      const result = await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW);
      expect(result).toEqual({ ok: true, showName: true });
      // A fresh consent: the row now says the notice in force, not the one it was answered under.
      expect(await rowOf(event.id)).toMatchObject({ showName: true, displayName: "Ana Popescu", privacyNoticeVersion: 2 });
      expect((await publicRead(event.id)).names).toEqual(["Ana Popescu"]);
      expect(revalidated).toEqual([["places"]]);
    });

    it("takes a name typed now — cleaned, at most 80 — which wins over the stored one", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test", "Ana");
      const result = await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true, displayName: `   Ana   Maria ${"x".repeat(100)}` }, NOW);
      expect(result).toEqual({ ok: true, showName: true });
      const row = await rowOf(event.id);
      expect(row.displayName).toHaveLength(80);
      expect(row.displayName?.startsWith("Ana Maria xxx")).toBe(true);
      expect((await publicRead(event.id)).names).toEqual([row.displayName]);
    });

    it("takes a name posted now when the answer holds none — the remembered browser's box", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test", null);
      expect(await rowOf(event.id)).toMatchObject({ displayName: null, showName: false });
      const result = await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true, displayName: "Ana P." }, NOW);
      expect(result).toEqual({ ok: true, showName: true });
      expect(await rowOf(event.id)).toMatchObject({ displayName: "Ana P.", showName: true });
    });

    it("uses the account's own name only as a last resort: after the typed one and the stored one", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test", "Ana (scrisă de ea)");
      await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true, defaultName: "Ana din cont" }, NOW);
      expect((await rowOf(event.id)).displayName).toBe("Ana (scrisă de ea)");

      await answer(event.id, "dan@example.test", null);
      await setRsvpShowName(db, event.id, who("dan@example.test"), { showName: true, defaultName: "  Dan   din cont " }, NOW);
      expect((await rowOf(event.id, "dan@example.test")).displayName).toBe("Dan din cont");
    });

    it("is refused with the reason «name» when there is no name anywhere, and writes nothing", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test", null);
      revalidated.length = 0;
      for (const input of [{ showName: true }, { showName: true, displayName: "   " }, { showName: true, displayName: null, defaultName: "  " }]) {
        expect(await setRsvpShowName(db, event.id, who("ana@example.test"), input, NOW)).toEqual({ ok: false, reason: "name" });
      }
      expect(await rowOf(event.id)).toMatchObject({ showName: false, displayName: null, privacyNoticeVersion: 1 });
      expect(revalidated).toEqual([]);
    });

    it("is refused with the reason «closed» once the event no longer takes «Vin!» — started, unticked, or a notice that stopped describing it", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      // The event started.
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, new Date(STARTS_AT.getTime() + HOUR))).toEqual({ ok: false, reason: "closed" });
      // The club unticked it.
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, event.id));
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW)).toEqual({ ok: false, reason: "closed" });
      await db.update(events).set({ rsvpEnabled: true }).where(eq(events.id, event.id));
      // A later notice that says nothing of «Vin!».
      await approveNotice(2, false, new Date(NOW.getTime() - HOUR));
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW)).toEqual({ ok: false, reason: "closed" });
      expect(await rowOf(event.id)).toMatchObject({ showName: false, privacyNoticeVersion: 1 });
    });
  });

  describe("turning it OFF", () => {
    it("hides the name at once and keeps it stored — and it comes back when the person ticks again", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW);
      expect((await publicRead(event.id)).names).toEqual(["Ana Popescu"]);
      revalidated.length = 0;

      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: false }, NOW)).toEqual({ ok: true, showName: false });
      expect(await rowOf(event.id)).toMatchObject({ showName: false, displayName: "Ana Popescu" });
      // Still counted, never named.
      expect(await publicRead(event.id)).toEqual({ count: 1, names: [], others: 1 });
      expect(revalidated).toEqual([["places"]]);

      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW)).toEqual({ ok: true, showName: true });
      expect((await publicRead(event.id)).names).toEqual(["Ana Popescu"]);
    });

    it("needs no notice and no open event: a person may always stop being named", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW);
      await approveNotice(2, false, new Date(NOW.getTime() - HOUR));
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, event.id));
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: false }, new Date(STARTS_AT.getTime() + HOUR))).toEqual({ ok: true, showName: false });
      expect((await rowOf(event.id)).showName).toBe(false);
    });

    it("tells the cache nothing when nothing changed (already off)", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      revalidated.length = 0;
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: false }, NOW)).toEqual({ ok: true, showName: false });
      expect(revalidated).toEqual([]);
    });
  });

  describe("only the person's own counted answer", () => {
    it("touches nobody else's row and says «none» for an address that has no answer", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      await answer(event.id, "dan@example.test", "Dan");
      expect(await setRsvpShowName(db, event.id, who("nobody@example.test"), { showName: true, displayName: "Nimeni" }, NOW)).toEqual({ ok: false, reason: "none" });
      await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW);
      expect(await rowOf(event.id, "dan@example.test")).toMatchObject({ showName: false, displayName: "Dan" });
      expect((await publicRead(event.id)).names).toEqual(["Ana Popescu"]);
    });

    it("finds the row by the canonical address, whatever case or dots the identity spells", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana.popescu@gmail.com");
      expect(await setRsvpShowName(db, event.id, who("Ana.Popescu+x@GMAIL.com"), { showName: true }, NOW)).toMatchObject({ ok: true });
    });

    it("never touches an answer that is not counted: a typed address waiting for its link has no name to show", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), NOW);
      expect(await rowOf(event.id)).toMatchObject({ confirmedAt: null });
      expect(await setRsvpShowName(db, event.id, who("ana@example.test"), { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await rowOf(event.id)).toMatchObject({ showName: false });
    });

    it("refuses an identity that proved nothing, or claims more than its source does", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      const unverified = identityOf("page", { email: "ana@example.test", displayName: null, showName: false, locale: "ro" });
      const forged = { ...unverified, verified: true };
      for (const identity of [unverified, forged]) {
        const error = await setRsvpShowName(db, event.id, { identity }, { showName: true }, NOW).catch((e: unknown) => e);
        expect(isDomainError(error) && error.code).toBe("FORBIDDEN");
      }
      expect((await rowOf(event.id)).showName).toBe(false);
    });
  });

  describe("by a «Nu mai vin» link: read, never spent", () => {
    async function linkOf(eventId: string, email: string) {
      const row = await rowOf(eventId, email);
      const links = await mintRsvpLinks(db, { rsvpId: row.id, startsAt: STARTS_AT, confirm: false, now: NOW });
      return links!.withdraw;
    }

    it("flips the tick without spending the link — the same link still takes the answer back, and the tick can flip again", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      const token = await linkOf(event.id, "ana@example.test");

      expect(await setRsvpShowName(db, event.id, { token }, { showName: true }, NOW)).toEqual({ ok: true, showName: true });
      expect((await publicRead(event.id)).names).toEqual(["Ana Popescu"]);
      expect(await setRsvpShowName(db, event.id, { token }, { showName: false }, NOW)).toEqual({ ok: true, showName: false });
      expect(await setRsvpShowName(db, event.id, { token }, { showName: true }, NOW)).toEqual({ ok: true, showName: true });

      // The link is still live: not used, not invalidated.
      const [stored] = await db.select().from(eventRsvpTokens).where(eq(eventRsvpTokens.purpose, "RSVP_WITHDRAW"));
      expect(stored.usedAt).toBeNull();
      expect(stored.invalidatedAt).toBeNull();
      expect(await readRsvpLink(db, token, NOW)).toMatchObject({ state: "live", showName: true, confirmed: true, named: true });
      // And it still withdraws, once.
      expect(await withdrawRsvp(db, { token }, NOW)).toMatchObject({ eventId: event.id });
      expect(await rowOf(event.id)).toBeUndefined();
      expect(await setRsvpShowName(db, event.id, { token }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
    });

    it("is refused for a spent, replaced, expired or unknown link, and for an event that has started", async () => {
      const event = await seedEvent();
      await answer(event.id, "ana@example.test");
      const old = await linkOf(event.id, "ana@example.test");
      // A newer email supersedes the older link.
      const fresh = await linkOf(event.id, "ana@example.test");
      expect(await setRsvpShowName(db, event.id, { token: old }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpShowName(db, event.id, { token: "x".repeat(43) }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpShowName(db, event.id, { token: "not a token" }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      // Past the link's own life, and after the start.
      expect(await setRsvpShowName(db, event.id, { token: fresh }, { showName: true }, new Date(STARTS_AT.getTime() + 61 * DAY))).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpShowName(db, event.id, { token: fresh }, { showName: true }, new Date(STARTS_AT.getTime() + HOUR))).toEqual({ ok: false, reason: "none" });
      expect((await rowOf(event.id)).showName).toBe(false);
      // The live one works.
      expect(await setRsvpShowName(db, event.id, { token: fresh }, { showName: true }, NOW)).toMatchObject({ ok: true });
    });

    it("is refused for a confirm link (another purpose) and for another event's id", async () => {
      const event = await seedEvent();
      const other = await seedEvent();
      await answer(event.id, "ana@example.test");
      const row = await rowOf(event.id, "ana@example.test");
      const links = await mintRsvpLinks(db, { rsvpId: row.id, startsAt: STARTS_AT, confirm: true, now: NOW });
      expect(await setRsvpShowName(db, event.id, { token: links!.confirm! }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect(await setRsvpShowName(db, other.id, { token: links!.withdraw }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
      expect((await rowOf(event.id)).showName).toBe(false);
    });

    it("is refused for a link of an answer that is not counted", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, identityOf("page", { email: "ana@example.test", displayName: "Ana", showName: false, locale: "ro" }), NOW);
      const row = await rowOf(event.id, "ana@example.test");
      const links = await mintRsvpLinks(db, { rsvpId: row.id, startsAt: STARTS_AT, confirm: true, now: NOW });
      expect(await setRsvpShowName(db, event.id, { token: links!.withdraw }, { showName: true }, NOW)).toEqual({ ok: false, reason: "none" });
    });
  });
});
