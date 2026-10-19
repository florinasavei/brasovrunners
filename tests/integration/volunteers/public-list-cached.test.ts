import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { computeContentHash, type LegalDocumentTranslationInput } from "@/modules/legal-documents/domain/content-hash";
import { findFirstVolunteersListNoticeVersion, insertLegalDocumentVersion, noticeDescribesVolunteersList } from "@/modules/legal-documents/repository";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §821 — the event page reads the volunteers' public list through the public cache (`cachedVolunteersListDescribed`,
 * `cachedFirstVolunteersListNoticeVersion`, `cachedPublicVolunteersList`), and the sign-up asks the database (`noticeDescribesVolunteersList`,
 * `findFirstVolunteersListNoticeVersion`). The two are one rule written twice, so this pins that they agree — a page that shows names must
 * never lead to a sign-up that kept no tick — and that the cached list holds only a name, a role and two numbers.
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const reads = await import("@/modules/public-cache/reads");

const NOW = new Date("2026-10-19T10:00:00.000Z");
const DAY = 86_400_000;
const EFFECTIVE = new Date("2026-01-01T00:00:00.000Z");

describe("§821 the cached twins of «does the notice describe the volunteers' list» agree with the database's", () => {
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    fakeNextCache.reset();
    request.reads.clear();
  });

  /** A privacy notice in force in the given languages, with `markers` in its volunteers' paragraph. */
  async function notice(version: number, markers: string, locales: readonly ("ro" | "en")[] = ["ro", "en"]) {
    const translations: LegalDocumentTranslationInput[] = locales.map((locale) => ({
      locale,
      title: "Privacy",
      body: { sections: [{ paragraphs: [`Volunteers (${markers}): we keep the name`] }] },
    }));
    await insertLegalDocumentVersion(db, {
      key: "PRIVACY_NOTICE",
      version,
      effectiveAt: new Date(EFFECTIVE.getTime() + version * DAY),
      isApproved: true,
      contentSha256: computeContentHash(translations),
      translations,
      now: NOW,
    });
  }

  const cases: { name: string; setup: () => Promise<void>; described: boolean; first: number | null }[] = [
    { name: "the notice names the volunteers and the list", setup: () => notice(1, "{{volunteers}}, {{volunteersList}}"), described: true, first: 1 },
    { name: "the notice names the volunteers only", setup: () => notice(1, "{{volunteers}}"), described: false, first: null },
    { name: "the notice names the list without the volunteers", setup: () => notice(1, "{{volunteersList}}"), described: false, first: null },
    { name: "the notice names both in one language only", setup: () => notice(1, "{{volunteers}}, {{volunteersList}}", ["ro"]), described: false, first: null },
    {
      name: "an older notice is silent and a later one describes the list",
      setup: async () => {
        await notice(1, "{{volunteers}}");
        await notice(2, "{{volunteers}}, {{volunteersList}}");
      },
      described: true,
      first: 2,
    },
    {
      name: "a later notice drops the list: nothing is described now, but the first that did is remembered",
      setup: async () => {
        await notice(1, "{{volunteers}}, {{volunteersList}}");
        await notice(2, "{{volunteers}}");
      },
      described: false,
      first: 1,
    },
  ];

  for (const { name, setup, described, first } of cases) {
    it(`${name}: the cached read and the database's say ${described ? "described" : "silent"}, first version ${first ?? "none"}`, async () => {
      await setup();
      expect(await noticeDescribesVolunteersList(db, NOW)).toBe(described);
      expect(await reads.cachedVolunteersListDescribed(NOW)).toBe(described);
      expect(await findFirstVolunteersListNoticeVersion(db)).toBe(first);
      expect(await reads.cachedFirstVolunteersListNoticeVersion()).toBe(first);
    });
  }

  it("the cached list names the confirmed who ticked, with the role given, and counts the rest — and holds nothing else of a person", async () => {
    await notice(1, "{{volunteers}}, {{volunteersList}}");
    const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date(NOW.getTime() + 30 * DAY), editorialStatus: "PUBLISHED", publishedAt: new Date(NOW.getTime() - DAY), acceptsVolunteers: true, volunteersListPublic: true }).returning();
    const [role] = await db.insert(eventVolunteerRoles).values({ eventId: event.id, nameRo: "Sosire", nameEn: "Finish", needed: 2 }).returning();
    const base = { eventId: event.id, canonicalizationVersion: 2, phone: "+40712345678", source: "PUBLIC" as const, state: "CONFIRMED" as const, listOptInNoticeVersion: 1 };
    await db.insert(eventVolunteers).values([
      { ...base, name: "Ana Popescu", email: "ana@example.test", canonicalEmail: "ana@example.test", listOptIn: true, roleId: role.id, createdAt: new Date(NOW.getTime() - 2 * DAY) },
      { ...base, name: "Ion Ionescu", email: "ion@example.test", canonicalEmail: "ion@example.test", listOptIn: false, createdAt: new Date(NOW.getTime() - DAY) },
    ]);
    const list = await reads.cachedPublicVolunteersList(event.id, await reads.cachedFirstVolunteersListNoticeVersion());
    expect(list).toEqual({
      acceptsVolunteers: true,
      list: { count: 2, named: [{ name: "Ana Popescu", roleNameRo: "Sosire", roleNameEn: "Finish" }], others: 1 },
    });
    expect(JSON.stringify(list)).not.toMatch(/@example\.test|\+4071|Ion Ionescu/);
    // Outside a Next server `publicRead` loads straight through, so the filing is read from the source: the same tags as the roles' standing, `places`
    // and `events` — the ones every write to the people expires — and, being under `places`, no saved copy (a withdrawn name must not outlive its owner's request).
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/modules/public-cache/reads.ts", "utf8");
    expect(source).toMatch(/publicRead\(\["volunteers\.list", eventId, firstListNoticeVersion \?\? "none"\], \["places", "events"\]/);
    expect(source).toMatch(/publicRead\(\["volunteers\.roles", eventId\], \["places", "events"\]/);
  });
});
