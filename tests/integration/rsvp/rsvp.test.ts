import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps, eventRsvpTokens } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstRsvpNoticeVersion, insertLegalDocumentVersion, noticeDescribesRsvp } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { OutboxMessageWithdrawn } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import { identityOf } from "@/modules/rsvp/domain/identity";
import {
  answerRsvp,
  confirmRsvp,
  countRsvps,
  countRsvpEvents,
  hasConfirmedRsvp,
  mintRsvpLinks,
  readPublicRsvps,
  readRsvpLink,
  requestWithdrawLink,
  withdrawRsvp,
} from "@/modules/rsvp/rsvp";
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
/** The Thursday run: two days ahead. */
const STARTS_AT = new Date(NOW.getTime() + 2 * DAY + 6 * HOUR);

/**
 * §NNN («Vin!» part 1) — the service: not a registration (no place, no participant), one row per event and canonical identity, the
 * gate asked again at every answer, an unverified answer waiting for the emailed link and a verified one counted at once, the links
 * minted at the send and spent once, a GET that changes nothing, withdrawal by the link and by a verified identity, and the public
 * count that names only those who ticked.
 */
describe("§NNN «Vin!» — the service", () => {
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

  /** An approved privacy notice that describes «Vin!» (the template's texts) or one that says nothing of it. */
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
      { eventId: event.id, locale: "ro", slug: `alergare-${event.id.slice(0, 8)}`, title: "Alergarea de joi" },
      { eventId: event.id, locale: "en", slug: `run-${event.id.slice(0, 8)}`, title: "Thursday run" },
    ]);
    return event;
  }

  const typed = (email: string, extra: Partial<Parameters<typeof identityOf>[1]> = {}) =>
    identityOf("page", { email, displayName: null, showName: false, locale: "ro", ...extra });
  const remembered = (email: string, extra: Partial<Parameters<typeof identityOf>[1]> = {}) =>
    identityOf("remembered", { email, displayName: null, showName: false, locale: "ro", ...extra });

  const rowsOf = (eventId: string) => db.select().from(eventRsvps).where(eq(eventRsvps.eventId, eventId));
  const outbox = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "RSVP_CONFIRM")).orderBy(emailOutbox.createdAt);
  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.catch((e: unknown) => e);
    return isDomainError(error) ? error.code : "no refusal";
  };
  /** The two links of one rendered message, in the order the message draws them: the action, then the second. */
  const linksOf = (text: string) => [...new Set([...text.matchAll(/\/(?:vin|coming)\/([A-Za-z0-9_-]{43})/g)].map((match) => match[1]))];

  describe("the gate, asked again at every answer", () => {
    it("takes an answer for a published, scheduled, upcoming turn-up event the club ticked, under a notice that describes «Vin!»", async () => {
      const event = await seedEvent();
      expect(await answerRsvp(db, event.id, typed("ana@example.test"), NOW)).toEqual({ counted: false });
      expect(await rowsOf(event.id)).toHaveLength(1);
    });

    it.each([
      ["the club did not tick it", { rsvpEnabled: false }],
      ["it takes registrations on the site", { registrationMode: "INTERNAL" as const }],
      ["it is cancelled", { eventStatus: "CANCELLED" as const }],
      ["it is a draft", { editorialStatus: "DRAFT" as const }],
      ["it has started", { startsAt: new Date(NOW.getTime() - HOUR) }],
      ["it is for the members alone", { membersOnly: true }],
    ])("refuses, and keeps nothing, when %s", async (_why, overrides) => {
      const event = await seedEvent(overrides);
      expect(await refusal(answerRsvp(db, event.id, typed("ana@example.test"), NOW))).toBe("CONFLICT");
      expect(await rowsOf(event.id)).toHaveLength(0);
      expect(await outbox()).toHaveLength(0);
    });

    it("refuses while the notice in force does not describe «Vin!», and takes answers the day one does", async () => {
      await resetTables(db);
      await approveNotice(1, false);
      const event = await seedEvent();
      expect(await noticeDescribesRsvp(db, NOW)).toBe(false);
      expect(await refusal(answerRsvp(db, event.id, typed("ana@example.test"), NOW))).toBe("CONFLICT");
      expect(await findFirstRsvpNoticeVersion(db)).toBeNull();

      await approveNotice(2, true, new Date("2026-10-19T00:00:00.000Z"));
      expect(await noticeDescribesRsvp(db, NOW)).toBe(true);
      expect(await findFirstRsvpNoticeVersion(db)).toBe(2);
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      // The row remembers what the person was told: the notice in force, version 2.
      expect((await rowsOf(event.id))[0].privacyNoticeVersion).toBe(2);
    });

    it("refuses an unknown event, a malformed address, and an identity that claims more than its source proves", async () => {
      const event = await seedEvent();
      expect(await refusal(answerRsvp(db, "00000000-0000-4000-8000-000000000000", typed("ana@example.test"), NOW))).toBe("CONFLICT");
      const bad = await answerRsvp(db, event.id, typed("not an address"), NOW).catch((e: unknown) => e);
      expect(isDomainError(bad) && bad.code).toBe("VALIDATION_ERROR");
      expect(isDomainError(bad) && [...bad.fields]).toEqual(["email"]);
      const forged = { ...typed("ana@example.test"), verified: true };
      expect(await refusal(answerRsvp(db, event.id, forged, NOW))).toBe("VALIDATION_ERROR");
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    it("counts an upcoming ticked event for /admin/tasks, and no other", async () => {
      await seedEvent();
      await seedEvent({ rsvpEnabled: false });
      await seedEvent({ startsAt: new Date(NOW.getTime() - HOUR) });
      await seedEvent({ eventStatus: "CANCELLED" });
      await seedEvent({ registrationMode: "INTERNAL" });
      expect(await countRsvpEvents(db, NOW)).toBe(1);
    });
  });

  describe("one row per event and canonical identity", () => {
    it("keeps case, whitespace and a Gmail tag as one address, and the first typing's address and language", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("Ana.Pop@gmail.com"), NOW);
      await answerRsvp(db, event.id, typed("  ana.pop@gmail.com "), new Date(NOW.getTime() + 11 * 60_000));
      await answerRsvp(db, event.id, typed("ana.pop+club@googlemail.com", { locale: "en" }), new Date(NOW.getTime() + 22 * 60_000));
      const kept = await rowsOf(event.id);
      expect(kept).toHaveLength(1);
      expect(kept[0].canonicalEmail).toBe("ana.pop@gmail.com");
      expect(kept[0].canonicalizationVersion).toBe(2);
      // Another event is another list.
      const other = await seedEvent();
      await answerRsvp(db, other.id, typed("ana.pop@gmail.com"), NOW);
      expect(await rowsOf(other.id)).toHaveLength(1);
    });

    it("is not a registration: no participant, no registration, and the capacity formula never meets it", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      await answerRsvp(db, event.id, remembered("ion@example.test"), NOW);
      const { participants } = await import("@/db/schema/participants");
      const { registrations } = await import("@/db/schema/registrations");
      expect(await db.select().from(participants)).toHaveLength(0);
      expect(await db.select().from(registrations)).toHaveLength(0);
    });
  });

  describe("an unverified answer waits for the link", () => {
    it("writes one unconfirmed row and queues ONE RSVP_CONFIRM — no participant behind it, no secret in it, no token yet", async () => {
      const event = await seedEvent();
      expect(await answerRsvp(db, event.id, typed("Ana@example.test", { displayName: "Ana", showName: true }), NOW)).toEqual({ counted: false });
      const [row] = await rowsOf(event.id);
      expect(row).toMatchObject({ deliveryEmail: "Ana@example.test", canonicalEmail: "ana@example.test", displayName: "Ana", showName: true, locale: "ro", privacyNoticeVersion: 1, confirmedAt: null });
      const queued = await outbox();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ participantId: null, registrationId: null, recipientEmail: "Ana@example.test", locale: "ro" });
      expect(queued[0].payloadJson).toEqual({ rsvpId: row.id, eventId: event.id, request: "confirm" });
      // The links are minted when the message is sent (§14.5): nothing in the queue or the tables is a secret.
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
      expect(JSON.stringify(queued[0].payloadJson)).not.toMatch(/[A-Za-z0-9_-]{43}/);
      // Nothing is counted, and the public cache was not told anything changed.
      expect(await countRsvps(db, event.id)).toBe(0);
      expect(revalidated).toHaveLength(0);
    });

    it("sends at most one message per address and event in ten minutes — the answer is the same either way", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Ana" }), NOW);
      // Typed again at once, with another name: no second message, so the row stays as the first email will show it.
      expect(await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Ana Maria" }), new Date(NOW.getTime() + 60_000))).toEqual({ counted: false });
      expect(await outbox()).toHaveLength(1);
      expect((await rowsOf(event.id))[0].displayName).toBe("Ana");
      // Ten minutes later it may be sent again, and the row is refreshed with the message that supersedes the old link.
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Ana Maria" }), new Date(NOW.getTime() + 11 * 60_000));
      expect(await outbox()).toHaveLength(2);
      expect((await rowsOf(event.id))[0].displayName).toBe("Ana Maria");
      // Another address at the same event is its own bucket.
      await answerRsvp(db, event.id, typed("ion@example.test"), new Date(NOW.getTime() + 60_000));
      expect(await outbox()).toHaveLength(3);
    });

    it("leaves a confirmed row exactly as it is when somebody types its address — no rename, no change of what is shown", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("ana@example.test", { displayName: "Ana", showName: true }), NOW);
      const before = (await rowsOf(event.id))[0];
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Not Ana", showName: false }), new Date(NOW.getTime() + HOUR));
      const after = (await rowsOf(event.id))[0];
      expect(after).toEqual(before);
      expect(after.displayName).toBe("Ana");
      expect(after.showName).toBe(true);
    });
  });

  describe("a verified answer is counted at once", () => {
    it("confirms the row, sends no email at all and tells the public cache", async () => {
      const event = await seedEvent();
      expect(await answerRsvp(db, event.id, remembered("ana@example.test", { displayName: "Ana", showName: true }), NOW)).toEqual({ counted: true });
      const [row] = await rowsOf(event.id);
      expect(row.confirmedAt?.toISOString()).toBe(NOW.toISOString());
      expect(await outbox()).toHaveLength(0);
      expect(await countRsvps(db, event.id)).toBe(1);
      expect(revalidated).toEqual([["places"]]);
    });

    it.each(["remembered", "account", "link"] as const)("takes the %s source as verified", async (source) => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, identityOf(source, { email: "ana@example.test", showName: false, locale: "en" }), NOW);
      expect((await rowsOf(event.id))[0].confirmedAt).not.toBeNull();
      expect(await hasConfirmedRsvp(db, event.id, "ana@example.test")).toBe(true);
    });

    it("never publishes what a stranger typed: a verified press on an unconfirmed row replaces the name and the tick with the press's own", async () => {
      const event = await seedEvent();
      // Mallory types Ana's address with a name and the tick; Ana's remembered browser then taps «Vin!» without a name or a tick.
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Mallory", showName: true }), NOW);
      const [emailed] = linksOf((await renderOutboxMessage((await outbox())[0], db, NOW)).text);
      await answerRsvp(db, event.id, remembered("ana@example.test"), new Date(NOW.getTime() + HOUR));
      const [row] = await rowsOf(event.id);
      expect(row.confirmedAt).not.toBeNull();
      expect(row.showName).toBe(false);
      expect(row.displayName).toBeNull();
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: [], others: 1 });
      // The stranger's emailed link died with the stranger's values.
      expect(await readRsvpLink(db, emailed, new Date(NOW.getTime() + HOUR))).toMatchObject({ state: "used" });
    });

    it("shows the name of the press itself, when the person ticked it, whatever was typed before", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Mallory", showName: true }), NOW);
      await answerRsvp(db, event.id, remembered("ana@example.test", { displayName: "Ana", showName: true }), new Date(NOW.getTime() + HOUR));
      const [row] = await rowsOf(event.id);
      expect(row.displayName).toBe("Ana");
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toMatchObject({ names: ["Ana"] });
    });

    it("keeps a CONFIRMED row's name and adds what a later press shows", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("ana@example.test", { displayName: "Ana" }), NOW);
      await answerRsvp(db, event.id, remembered("ana@example.test", { showName: true }), new Date(NOW.getTime() + HOUR));
      const [row] = await rowsOf(event.id);
      expect(row.confirmedAt).not.toBeNull();
      expect(row.displayName).toBe("Ana");
      expect(row.showName).toBe(true);
      // A second press does not move the moment it was confirmed, nor take the tick back.
      await answerRsvp(db, event.id, remembered("ana@example.test", { showName: false }), new Date(NOW.getTime() + 2 * HOUR));
      const [again] = await rowsOf(event.id);
      expect(again.confirmedAt?.toISOString()).toBe(row.confirmedAt?.toISOString());
      expect(again.showName).toBe(true);
    });
  });

  describe("the message and its two links", () => {
    async function typedAnswer(event: Awaited<ReturnType<typeof seedEvent>>, email = "ana@example.test", at = NOW) {
      await answerRsvp(db, event.id, typed(email), at);
      return (await outbox()).at(-1)!;
    }

    it("is rendered with the event, its date and facts, a «Da, vin» button and «Nu vin» under it — and the secrets only in the email", async () => {
      const event = await seedEvent();
      const message = await renderOutboxMessage(await typedAnswer(event), db, NOW);
      expect(message.subject).toContain("Confirmă că vii la Alergarea de joi");
      expect(message.subject).toMatch(/22 oct/);
      expect(message.html).toContain("Da, vin");
      expect(message.html).toContain("Nu vin");
      expect(message.text).toContain("Alergarea de joi");
      // Both languages in one message, the row's first (§96).
      expect(message.text).toContain("Thursday run");
      expect(message.text).toContain("Yes, I'm coming");
      // The links' lives as the code has them (RSVP_CONFIRM_HOURS), not "expires at the start".
      expect(message.text).toContain("„Da, vin” timp de 48 de ore (cel târziu până la start), „Nu vin” până la start");
      expect(message.text).toContain("“Yes, I'm coming” for 48 hours (at the latest until the start)");
      // The event\'s file rides along, as the house\'s other messages carry it.
      expect(message.attachments?.some((file) => file.filename.endsWith(".ics")) || message.calendar !== undefined).toBe(true);

      const [confirm, withdraw] = linksOf(message.text);
      expect(confirm).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(withdraw).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(confirm).not.toBe(withdraw);
      const tokens = await db.select().from(eventRsvpTokens);
      expect(tokens.map((token) => token.purpose).sort()).toEqual(["RSVP_CONFIRM", "RSVP_WITHDRAW"]);
      // Only hashes at rest: nothing stored equals a secret that was emailed.
      for (const token of tokens) {
        expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
        expect([confirm, withdraw]).not.toContain(token.tokenHash);
      }
      expect(JSON.stringify(tokens)).not.toContain(confirm);
      expect(JSON.stringify(tokens)).not.toContain(withdraw);
    });

    it("is written in the language of the page the answer was given on", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test", { locale: "en" }), NOW);
      const message = await renderOutboxMessage((await outbox())[0], db, NOW);
      expect(message.subject).toContain("Confirm you're coming to Thursday run");
      expect(message.text.indexOf("Thursday run")).toBeLessThan(message.text.indexOf("Alergarea de joi"));
      expect(message.text).toMatch(/\/en\/coming\/[A-Za-z0-9_-]{43}/);
    });

    it("never changes anything on a GET: opening the link names the event and the state, and the row and the token stay as they were", async () => {
      const event = await seedEvent();
      const message = await renderOutboxMessage(await typedAnswer(event), db, NOW);
      const [confirm, withdraw] = linksOf(message.text);
      const tokensBefore = await db.select().from(eventRsvpTokens);

      const link = await readRsvpLink(db, confirm, NOW);
      expect(link).toMatchObject({ purpose: "RSVP_CONFIRM", state: "live", title: "Alergarea de joi", confirmed: false });
      expect(await readRsvpLink(db, withdraw, NOW)).toMatchObject({ purpose: "RSVP_WITHDRAW", state: "live" });
      // Read as often as a link scanner likes.
      for (let i = 0; i < 3; i += 1) await readRsvpLink(db, confirm, NOW);

      expect((await rowsOf(event.id))[0].confirmedAt).toBeNull();
      expect(await db.select().from(eventRsvpTokens)).toEqual(tokensBefore);
      expect(await countRsvps(db, event.id)).toBe(0);
    });

    it("counts the answer when «Da, vin» is pressed — once — and returns who the link proved, for the browser to be remembered", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("Ana@example.test", { displayName: "Ana", showName: true }), NOW);
      const message = await renderOutboxMessage((await outbox())[0], db, NOW);
      const [confirm] = linksOf(message.text);
      const pressed = new Date(NOW.getTime() + HOUR);

      const proved = await confirmRsvp(db, confirm, pressed);
      expect(proved).toMatchObject({ eventId: event.id, locale: "ro", email: "Ana@example.test", displayName: "Ana" });
      expect(proved?.slug).toMatch(/^alergare-/);
      expect((await rowsOf(event.id))[0].confirmedAt?.toISOString()).toBe(pressed.toISOString());
      expect(await countRsvps(db, event.id)).toBe(1);
      expect(revalidated).toEqual([["places"]]);

      // A second press, or a scanner after the person: the link is spent, and says so.
      expect(await confirmRsvp(db, confirm, new Date(pressed.getTime() + 1000))).toBeNull();
      expect(await readRsvpLink(db, confirm, pressed)).toMatchObject({ state: "used", confirmed: true, slug: proved?.slug });
      expect(revalidated).toHaveLength(1);
    });

    it("refuses a link past its forty-eight hours, one the person never was sent, and one of the wrong shape", async () => {
      const event = await seedEvent({ startsAt: new Date(NOW.getTime() + 10 * DAY) });
      const message = await renderOutboxMessage(await typedAnswer(event), db, NOW);
      const [confirm] = linksOf(message.text);
      const late = new Date(NOW.getTime() + 49 * HOUR);
      expect(await readRsvpLink(db, confirm, late)).toMatchObject({ state: "expired" });
      expect(await confirmRsvp(db, confirm, late)).toBeNull();
      expect((await rowsOf(event.id))[0].confirmedAt).toBeNull();
      expect(await readRsvpLink(db, "x".repeat(43), NOW)).toBeNull();
      expect(await readRsvpLink(db, "short", NOW)).toBeNull();
      expect(await confirmRsvp(db, "short", NOW)).toBeNull();
    });

    it("lets a link live no longer than the event is ahead: a link to a run that starts in five hours expires at the start", async () => {
      const event = await seedEvent({ startsAt: new Date(NOW.getTime() + 5 * HOUR) });
      const message = await renderOutboxMessage(await typedAnswer(event), db, NOW);
      const [confirm, withdraw] = linksOf(message.text);
      const tokens = await db.select().from(eventRsvpTokens);
      // The «Da, vin» link never outlives the start; «Nu vin» is decided by the start as it is when pressed (it can move).
      for (const token of tokens.filter((candidate) => candidate.purpose === "RSVP_CONFIRM")) expect(token.expiresAt.getTime()).toBeLessThanOrEqual(event.startsAt.getTime());
      expect(await readRsvpLink(db, confirm, new Date(NOW.getTime() + 5 * HOUR))).toMatchObject({ state: "over" });
      expect(await withdrawRsvp(db, { token: withdraw }, new Date(NOW.getTime() + 5 * HOUR))).toBeNull();
      expect(await readRsvpLink(db, withdraw, new Date(NOW.getTime() + 4 * HOUR))).toMatchObject({ state: "live" });
    });

    it("tells a link past its own life from an event that started: the first can answer again from the page, the second cannot", async () => {
      const event = await seedEvent({ startsAt: new Date(NOW.getTime() + 10 * DAY) });
      const [confirm] = linksOf((await renderOutboxMessage(await typedAnswer(event), db, NOW)).text);
      expect(await readRsvpLink(db, confirm, new Date(NOW.getTime() + 49 * HOUR))).toMatchObject({ state: "expired" });
      expect(await readRsvpLink(db, confirm, new Date(NOW.getTime() + 10 * DAY + HOUR))).toMatchObject({ state: "over" });
    });

    it("keeps «Nu vin» working to a MOVED start, and refuses it at the start as it is then", async () => {
      const event = await seedEvent({ startsAt: new Date(NOW.getTime() + 5 * HOUR) });
      const [, withdraw] = linksOf((await renderOutboxMessage(await typedAnswer(event), db, NOW)).text);
      await db.update(events).set({ startsAt: new Date(NOW.getTime() + 3 * DAY) }).where(eq(events.id, event.id));
      const afterOldStart = new Date(NOW.getTime() + 6 * HOUR);
      expect(await readRsvpLink(db, withdraw, afterOldStart)).toMatchObject({ state: "live" });
      await db.update(events).set({ startsAt: new Date(NOW.getTime() + HOUR) }).where(eq(events.id, event.id));
      expect(await withdrawRsvp(db, { token: withdraw }, afterOldStart)).toBeNull();
      expect(await rowsOf(event.id)).toHaveLength(1);
    });

    it("keeps the row as the emailed «Da, vin» link showed it when a retyping falls inside the throttle: no new name, no new tick", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      const [first] = linksOf((await renderOutboxMessage((await outbox())[0], db, NOW)).text);
      // Two minutes later, inside the ten-minute throttle, a stranger retypes the address with a name and the tick: no new message.
      const retyped = new Date(NOW.getTime() + 2 * 60_000);
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Mallory", showName: true }), retyped);
      expect(await outbox()).toHaveLength(1);
      const [row] = await rowsOf(event.id);
      expect(row.showName).toBe(false);
      expect(row.displayName).toBeNull();
      // The first email still confirms the row as it showed it: no name, no tick.
      expect(await confirmRsvp(db, first, retyped)).toMatchObject({ displayName: null });
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).toEqual({ count: 1, names: [], others: 1 });
    });

    it("kills the old «Da, vin» link when a retyping that DOES send a new message changes the name or the tick", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      const [first] = linksOf((await renderOutboxMessage((await outbox())[0], db, NOW)).text);
      const later = new Date(NOW.getTime() + 15 * 60_000);
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Ana", showName: true }), later);
      // Between the queueing and the send the old link is already dead.
      expect(await confirmRsvp(db, first, later)).toBeNull();
      expect((await rowsOf(event.id))[0]).toMatchObject({ displayName: "Ana", showName: true, confirmedAt: null });
    });

    it("withdraws the message when the club switched the tick off or gave the event a registration since the press", async () => {
      const event = await seedEvent();
      const row = await typedAnswer(event);
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await db.update(events).set({ rsvpEnabled: true, registrationMode: "INTERNAL" }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
    });

    it("counts nobody when «Da, vin» is pressed after the club switched the tick off", async () => {
      const event = await seedEvent();
      const [confirm] = linksOf((await renderOutboxMessage(await typedAnswer(event), db, NOW)).text);
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, event.id));
      expect(await confirmRsvp(db, confirm, NOW)).toBeNull();
      expect((await rowsOf(event.id))[0].confirmedAt).toBeNull();
    });

    it("supersedes the earlier message's links when a newer one is sent", async () => {
      const event = await seedEvent();
      const first = await renderOutboxMessage(await typedAnswer(event), db, NOW);
      const later = new Date(NOW.getTime() + 15 * 60_000);
      await answerRsvp(db, event.id, typed("ana@example.test"), later);
      const second = await renderOutboxMessage((await outbox()).at(-1)!, db, later);
      const [oldConfirm] = linksOf(first.text);
      const [newConfirm] = linksOf(second.text);
      expect(await readRsvpLink(db, oldConfirm, later)).toMatchObject({ state: "used" });
      expect(await confirmRsvp(db, oldConfirm, later)).toBeNull();
      expect(await readRsvpLink(db, newConfirm, later)).toMatchObject({ state: "live" });
      expect(await confirmRsvp(db, newConfirm, later)).not.toBeNull();
    });

    it("tells the person who presses which name their press makes public — whoever typed the address chose it — on the confirm shape only", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test", { displayName: "Numele Altcuiva", showName: true }), NOW);
      await answerRsvp(db, event.id, typed("ion@example.test", { displayName: "Ion", showName: false }), NOW);
      const [first, second] = await outbox();
      const named = await renderOutboxMessage(first, db, NOW);
      expect(named.text).toContain("pe pagina evenimentului va apărea numele „Numele Altcuiva”");
      expect(named.text).toContain("the name “Numele Altcuiva” will show on the event's page");
      // A name nobody asked to show is not announced; and an already-counted address is told no such thing.
      expect((await renderOutboxMessage(second, db, NOW)).text).not.toMatch(/va apărea numele|will show on the event/);
      await answerRsvp(db, event.id, remembered("zoe@example.test", { displayName: "Zoe", showName: true }), NOW);
      await answerRsvp(db, event.id, typed("zoe@example.test", { displayName: "Not Zoe", showName: true }), new Date(NOW.getTime() + HOUR));
      const counted = await renderOutboxMessage((await outbox()).at(-1)!, db, new Date(NOW.getTime() + HOUR));
      expect(counted.text).not.toMatch(/va apărea numele|will show on the event/);
    });

    it("sends to an address already counted only the «Nu mai vin» link — no confirm token is minted", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("ana@example.test"), NOW);
      await answerRsvp(db, event.id, typed("ana@example.test"), new Date(NOW.getTime() + HOUR));
      const message = await renderOutboxMessage((await outbox())[0], db, new Date(NOW.getTime() + HOUR));
      expect(message.subject).toContain("Ești numărat la Alergarea de joi");
      expect(linksOf(message.text)).toHaveLength(1);
      expect((await db.select().from(eventRsvpTokens)).map((token) => token.purpose)).toEqual(["RSVP_WITHDRAW"]);
    });

    it("withdraws the message when the answer was taken back, the event started or was cancelled, or the address changed", async () => {
      const event = await seedEvent();
      const row = await typedAnswer(event);
      await expect(renderOutboxMessage(row, db, new Date(STARTS_AT.getTime() + 1))).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await db.update(events).set({ eventStatus: "CANCELLED" }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await db.update(events).set({ eventStatus: "SCHEDULED" }).where(eq(events.id, event.id));
      await expect(renderOutboxMessage({ ...row, recipientEmail: "someone.else@example.test" }, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      await db.delete(eventRsvps).where(eq(eventRsvps.eventId, event.id));
      await expect(renderOutboxMessage(row, db, NOW)).rejects.toBeInstanceOf(OutboxMessageWithdrawn);
      expect(await mintRsvpLinks(db, { rsvpId: "00000000-0000-4000-8000-000000000000", startsAt: new Date(NOW.getTime() - 1), confirm: true, now: NOW })).toBeNull();
    });
  });

  describe("taking an answer back", () => {
    it("deletes the answer by the «Nu vin» link, once, and the confirm link goes with it", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      const message = await renderOutboxMessage((await outbox())[0], db, NOW);
      const [confirm, withdraw] = linksOf(message.text);
      const proved = await withdrawRsvp(db, { token: withdraw }, new Date(NOW.getTime() + HOUR));
      expect(proved).toMatchObject({ eventId: event.id, email: "ana@example.test" });
      expect(await rowsOf(event.id)).toHaveLength(0);
      expect(await withdrawRsvp(db, { token: withdraw }, new Date(NOW.getTime() + 2 * HOUR))).toBeNull();
      expect(await confirmRsvp(db, confirm, new Date(NOW.getTime() + 2 * HOUR))).toBeNull();
      expect(await db.select().from(eventRsvpTokens)).toHaveLength(0);
    });

    it("lets a counted answer be taken back by the withdraw link of a later message, and tells the public cache", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      const [confirm] = linksOf((await renderOutboxMessage((await outbox())[0], db, NOW)).text);
      await confirmRsvp(db, confirm, new Date(NOW.getTime() + HOUR));
      revalidated.length = 0;
      await requestWithdrawLink(db, event.id, { email: "ANA@example.test", locale: "ro" }, new Date(NOW.getTime() + 2 * HOUR));
      const asked = (await outbox()).at(-1)!;
      expect(asked.payloadJson).toMatchObject({ request: "withdraw" });
      const message = await renderOutboxMessage(asked, db, new Date(NOW.getTime() + 2 * HOUR));
      expect(message.subject).toContain("Nu mai vii la Alergarea de joi?");
      const [onlyLink] = linksOf(message.text);
      expect(linksOf(message.text)).toHaveLength(1);
      expect(await withdrawRsvp(db, { token: onlyLink }, new Date(NOW.getTime() + 3 * HOUR))).not.toBeNull();
      expect(await countRsvps(db, event.id)).toBe(0);
      expect(revalidated).toEqual([["places"]]);
    });

    it("says nothing about whether an address answered: the small fold queues a message only for an address that did", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, typed("ana@example.test"), NOW);
      const before = (await outbox()).length;
      await expect(requestWithdrawLink(db, event.id, { email: "stranger@example.test", locale: "ro" }, NOW)).resolves.toBeUndefined();
      expect(await outbox()).toHaveLength(before);
      // The same ten-minute throttle as the answer's own message.
      await requestWithdrawLink(db, event.id, { email: "ana@example.test", locale: "ro" }, new Date(NOW.getTime() + 60_000));
      expect(await outbox()).toHaveLength(before);
      await requestWithdrawLink(db, event.id, { email: "ana@example.test", locale: "ro" }, new Date(NOW.getTime() + 11 * 60_000));
      expect(await outbox()).toHaveLength(before + 1);
      const bad = await requestWithdrawLink(db, event.id, { email: "nope", locale: "ro" }, NOW).catch((e: unknown) => e);
      expect(isDomainError(bad) && bad.code).toBe("VALIDATION_ERROR");
    });

    it("does the same work for an address with no answer as for one with an answer: the per-address throttle is spent either way", async () => {
      const event = await seedEvent();
      await requestWithdrawLink(db, event.id, { email: "nobody@example.test", locale: "ro" }, NOW);
      // The bucket was spent by the request alone, so an answer typed a minute later waits out the ten minutes, like any second request.
      await answerRsvp(db, event.id, typed("nobody@example.test"), new Date(NOW.getTime() + 60_000));
      expect(await outbox()).toHaveLength(0);
      expect(await rowsOf(event.id)).toHaveLength(1);
    });

    it("is never gated by the notice or the tick: a person can always take an answer back", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("ana@example.test"), NOW);
      await db.update(events).set({ rsvpEnabled: false }).where(eq(events.id, event.id));
      await resetNoticeTo(false);
      expect(await withdrawRsvp(db, { eventId: event.id, identity: remembered("ana@example.test") }, NOW)).toBe(true);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });

    async function resetNoticeTo(describes: boolean) {
      const { legalDocuments } = await import("@/db/schema/legal-documents");
      if (!describes) await db.update(legalDocuments).set({ withdrawnAt: NOW });
    }

    it("takes an answer back by a verified identity — and refuses an unverified one", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("Ana.Pop@gmail.com"), NOW);
      expect(await refusal(Promise.resolve().then(() => withdrawRsvp(db, { eventId: event.id, identity: typed("ana.pop@gmail.com") }, NOW)))).toBe("FORBIDDEN");
      expect(await rowsOf(event.id)).toHaveLength(1);
      // Found by the canonical identity, not the typing.
      expect(await withdrawRsvp(db, { eventId: event.id, identity: remembered("ana.pop+x@googlemail.com") }, NOW)).toBe(true);
      expect(await withdrawRsvp(db, { eventId: event.id, identity: remembered("ana.pop@gmail.com") }, NOW)).toBe(false);
      expect(await rowsOf(event.id)).toHaveLength(0);
    });
  });

  describe("how many come, and who may be named", () => {
    it("counts the confirmed and names only those who ticked, under the first notice that described «Vin!» or a later one", async () => {
      const event = await seedEvent();
      const base = { eventId: event.id, canonicalizationVersion: 2, locale: "ro" as const };
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
      await db.insert(eventRsvps).values([
        { ...base, deliveryEmail: "ana@example.test", canonicalEmail: "ana@example.test", displayName: "Ana Popescu", showName: true, privacyNoticeVersion: 2, confirmedAt: at(1), createdAt: at(1) },
        { ...base, deliveryEmail: "ion@example.test", canonicalEmail: "ion@example.test", displayName: "Ion Vasile", showName: false, privacyNoticeVersion: 2, confirmedAt: at(2), createdAt: at(2) },
        // Ticked under an older notice, which said nothing about «Vin!»: counted, never named.
        { ...base, deliveryEmail: "dan@example.test", canonicalEmail: "dan@example.test", displayName: "Dan Old", showName: true, privacyNoticeVersion: 1, confirmedAt: at(3), createdAt: at(3) },
        { ...base, deliveryEmail: "maria@example.test", canonicalEmail: "maria@example.test", displayName: "Maria Nouă", showName: true, privacyNoticeVersion: 3, confirmedAt: at(4), createdAt: at(4) },
        // Never used the link: not counted, not named, whatever it ticked.
        { ...base, deliveryEmail: "tudor@example.test", canonicalEmail: "tudor@example.test", displayName: "Tudor", showName: true, privacyNoticeVersion: 2, confirmedAt: null, createdAt: at(5) },
      ]);
      const read = await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 2 });
      expect(read).toEqual({ count: 4, names: ["Ana Popescu", "Maria Nouă"], others: 2 });
      expect(await countRsvps(db, event.id)).toBe(4);
      // No notice ever described it: counted, nobody named.
      expect(await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: null })).toEqual({ count: 4, names: [], others: 4 });
      // No addresses anywhere in what a page may draw.
      expect(JSON.stringify(read)).not.toContain("@");
    });

    it("lists the oldest answers first, so the list does not reshuffle when somebody joins", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("b@example.test", { displayName: "Bianca", showName: true }), new Date(NOW.getTime() + 2 * 60_000));
      await answerRsvp(db, event.id, remembered("a@example.test", { displayName: "Andrei", showName: true }), new Date(NOW.getTime() + 1 * 60_000));
      expect((await readPublicRsvps(db, event.id, { firstRsvpNoticeVersion: 1 })).names).toEqual(["Andrei", "Bianca"]);
    });

    it("keeps a name only up to eighty characters, tidy", async () => {
      const event = await seedEvent();
      await answerRsvp(db, event.id, remembered("ana@example.test", { displayName: `  ${"Ana ".repeat(40)}  `, showName: true }), NOW);
      const [row] = await rowsOf(event.id);
      expect(row.displayName!.length).toBeLessThanOrEqual(80);
      expect(row.displayName).toBe(row.displayName!.trim());
    });
  });

  it("finds a confirmed answer by the token's row when two events share an address", async () => {
    const a = await seedEvent();
    const b = await seedEvent();
    await answerRsvp(db, a.id, typed("ana@example.test"), NOW);
    await answerRsvp(db, b.id, typed("ana@example.test"), NOW);
    const [first] = linksOf((await renderOutboxMessage((await outbox())[0], db, NOW)).text);
    await confirmRsvp(db, first, NOW);
    expect(await countRsvps(db, a.id) + (await countRsvps(db, b.id))).toBe(1);
    expect(await db.select().from(eventRsvps).where(and(eq(eventRsvps.canonicalEmail, "ana@example.test")))).toHaveLength(2);
  });
});
