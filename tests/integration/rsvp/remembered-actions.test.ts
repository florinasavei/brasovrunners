import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventRsvps } from "@/db/schema/event-rsvps";
import { eventTranslations, events } from "@/db/schema/events";
import { personSessions } from "@/db/schema/person-sessions";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { insertLegalDocumentVersion } from "@/modules/legal-documents/repository";
import { privacyNoticeEn, privacyNoticeRo } from "@/modules/legal-documents/templates/privacy-notice";
import { PERSON_COOKIE, PERSON_HINT_COOKIE } from "@/modules/person-session/domain/hint";
import { rememberPerson } from "@/modules/person-session/session";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const state = vi.hoisted(() => ({ db: undefined as unknown, jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void state.jar.set(name, value),
    delete: (name: string) => void state.jar.delete(name),
  }),
}));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/public-cache/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/public-cache/cache")>()),
  revalidatePublicContent: () => {},
}));

const { rsvpForgetAction, rsvpGoAction, rsvpLeaveAction, rsvpStateAction } = await import("@/modules/rsvp/remembered-actions");

const NOW = new Date();
const DAY = 24 * 60 * 60_000;

/**
 * §811 («Vin!» part 1) — the one-tap actions the island calls: a remembered browser answers as its address, verified, counted at
 * once with no email, on any event that takes answers; takes the answer back in one tap; and «Nu sunt eu» forgets it. The cookie is
 * read by the action alone (the island never sees the secret), and nothing is done for a browser the server does not know.
 */
describe("§811 the remembered browser's one tap", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let slug: string;
  let otherSlug: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    state.jar.clear();
    const translations: LegalDocumentTranslationInput[] = [
      { locale: "ro", title: "Confidențialitate", body: privacyNoticeRo },
      { locale: "en", title: "Privacy", body: privacyNoticeEn },
    ];
    await insertLegalDocumentVersion(db, { key: "PRIVACY_NOTICE", version: 1, effectiveAt: new Date(NOW.getTime() - 400 * DAY), isApproved: true, contentSha256: computeContentHash(translations), translations, now: NOW });
    slug = await seedEvent("Alergarea de joi");
    otherSlug = await seedEvent("Tura de sâmbătă", 4);
  });

  async function seedEvent(title: string, inDays = 2, overrides: Partial<typeof events.$inferInsert> = {}) {
    const [event] = await db
      .insert(events)
      .values({ type: "GROUP_RUN", startsAt: new Date(NOW.getTime() + inDays * DAY), registrationMode: "NONE", rsvpEnabled: true, editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), ...overrides })
      .returning();
    const id = event.id.slice(0, 8);
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", slug: `e-${id}`, title },
      { eventId: event.id, locale: "en", slug: `x-${id}`, title: `${title} (en)` },
    ]);
    return `e-${id}`;
  }
  /** The browser after a «Da, vin» link: the cookies the server set. */
  const remember = async (email = "ana@example.test", displayName: string | null = "Ana") => {
    const jar = { get: (name: string) => (state.jar.has(name) ? { value: state.jar.get(name)! } : undefined), set: (name: string, value: string) => void state.jar.set(name, value), delete: (name: string) => void state.jar.delete(name) };
    await rememberPerson(db, jar, { email, displayName }, NOW);
  };
  const answers = () => db.select().from(eventRsvps);

  it("knows nothing of a browser without a valid cookie: it stays the typed form, and nothing is written", async () => {
    expect(await rsvpStateAction(slug, "ro")).toEqual({ remembered: false });
    expect(await rsvpGoAction(slug, "ro", false)).toEqual({ remembered: false });
    expect(await rsvpLeaveAction(slug, "ro")).toEqual({ remembered: false });
    state.jar.set(PERSON_COOKIE, "x".repeat(43));
    expect(await rsvpGoAction(slug, "ro", false)).toEqual({ remembered: false });
    expect(await answers()).toHaveLength(0);
  });

  it("reports where a remembered browser stands: not yet coming, and how many are", async () => {
    await remember();
    expect(await rsvpStateAction(slug, "ro")).toEqual({ remembered: true, offered: true, going: false, showName: false, hasName: false, count: 0 });
  });

  it("answers in one tap — counted at once, no email at all — and then says «Tu vii»", async () => {
    await remember();
    const next = await rsvpGoAction(slug, "ro", false);
    expect(next).toEqual({ remembered: true, offered: true, going: true, showName: false, hasName: true, count: 1 });
    const [row] = await answers();
    expect(row).toMatchObject({ canonicalEmail: "ana@example.test", showName: false, confirmedAt: expect.any(Date) });
    expect(await db.select().from(emailOutbox)).toHaveLength(0);
    // Counted on another event too, with no email round-trip, at the very next tap.
    expect(await rsvpGoAction(otherSlug, "ro", false)).toMatchObject({ going: true, count: 1 });
    expect(await answers()).toHaveLength(2);
  });

  it("shows the name only on the tick of this press, and only for a person who gave a name", async () => {
    await remember("ana@example.test", "Ana");
    await rsvpGoAction(slug, "ro", true);
    expect((await answers())[0]).toMatchObject({ displayName: "Ana", showName: true });

    state.jar.clear();
    await remember("ion@example.test", null);
    await rsvpGoAction(otherSlug, "ro", true);
    const ion = (await answers()).find((row) => row.canonicalEmail === "ion@example.test")!;
    expect(ion.showName).toBe(false);
  });

  it("never lets a one-tap press inherit the name and tick a stranger typed on the same address (§143, §396)", async () => {
    // Mallory typed Ana's address with a name and the tick; the row waits unconfirmed.
    const { answerRsvp } = await import("@/modules/rsvp/rsvp");
    const { identityOf } = await import("@/modules/rsvp/domain/identity");
    const target = (await db.select().from(events))[0];
    await answerRsvp(db, target.id, identityOf("page", { email: "ana@example.test", displayName: "Mallory", showName: true, locale: "ro" }), NOW);
    expect((await answers())[0]).toMatchObject({ showName: true, confirmedAt: null });

    // Ana's remembered browser, with no name of its own, taps «Vin!» with no tick: counted, and nothing Mallory typed is public.
    await remember("ana@example.test", null);
    await rsvpGoAction(slug, "ro", false);
    const [row] = await answers();
    expect(row).toMatchObject({ showName: false, displayName: null, confirmedAt: expect.any(Date) });

    // Ana with a name of her own: the name that shows is hers, and only when she ticks.
    state.jar.clear();
    await db.delete(eventRsvps);
    await answerRsvp(db, target.id, identityOf("page", { email: "ana@example.test", displayName: "Mallory", showName: true, locale: "ro" }), NOW);
    await remember("ana@example.test", "Ana");
    await rsvpGoAction(slug, "ro", false);
    expect((await answers())[0]).toMatchObject({ showName: false, displayName: "Ana" });
  });

  it("takes the answer back in one tap, whatever the notice or the tick say now", async () => {
    await remember();
    await rsvpGoAction(slug, "ro", false);
    const event = (await db.select().from(events))[0];
    await db.update(events).set({ rsvpEnabled: false }).where((await import("drizzle-orm")).eq(events.id, event.id));
    const left = await rsvpLeaveAction(slug, "ro");
    // The event no longer offers «Vin!», so the island draws nothing — but the answer is gone.
    expect(left).toEqual({ remembered: true, offered: false });
    expect(await answers()).toHaveLength(0);
  });

  it("draws nothing for an event that takes no answers now (not ticked, started, or registration on the site), and keeps nothing", async () => {
    await remember();
    const off = await seedEvent("Fără", 3, { rsvpEnabled: false });
    const started = await seedEvent("Început", -1);
    const race = await seedEvent("Cursa", 5, { registrationMode: "INTERNAL" });
    for (const target of [off, started, race]) {
      expect(await rsvpGoAction(target, "ro", false)).toEqual({ remembered: true, offered: false });
    }
    expect(await answers()).toHaveLength(0);
  });

  it("keeps the browser good for another year when it answers", async () => {
    await remember();
    const before = (await db.select().from(personSessions))[0].expiresAt;
    await rsvpGoAction(slug, "ro", false);
    const after = (await db.select().from(personSessions))[0].expiresAt;
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(state.jar.has(PERSON_COOKIE)).toBe(true);
  });

  it("forgets on «Nu sunt eu»: the row and both cookies go, and the next tap is the typed form again", async () => {
    await remember();
    await rsvpGoAction(slug, "ro", false);
    await rsvpForgetAction();
    expect(state.jar.has(PERSON_COOKIE)).toBe(false);
    expect(state.jar.has(PERSON_HINT_COOKIE)).toBe(false);
    expect(await db.select().from(personSessions)).toHaveLength(0);
    expect(await rsvpGoAction(otherSlug, "ro", false)).toEqual({ remembered: false });
    // What was already answered stays answered: forgetting a browser is not taking an answer back.
    expect(await answers()).toHaveLength(1);
  });
});
