import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §333 for «Întrebări frecvente» (§525): the public page reads its questions from Next's data
 * cache, and the page's one save expires that answer, so the next visitor reads the question just
 * saved — the shape of `revalidation.test.ts`, with the in-memory cache of `helpers/next-cache.ts`
 * standing in for Next's so the hit, the expiry and the fresh read are all observable.
 */
let db: TestDatabase;
let close: () => Promise<void>;
vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { cachedFaqPage } = await import("@/modules/public-cache/reads");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { readFaqPageSettings, setFaqPagePublished } = await import("@/modules/content/faq/page-settings");
const { listFaqItemsForAdmin } = await import("@/modules/content/faq/repository");
const { saveFaqPage } = await import("@/modules/content/faq/service");
const { faqOnSite } = await import("@/modules/content/faq/on-site");

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const card = (ro: string, en: string) => ({
  questionRo: ro,
  questionEn: en,
  answerRoBody: JSON.stringify(doc("Da.")),
  answerEnBody: JSON.stringify(doc("Yes.")),
  visible: "on",
});

/** A new request: the request's own memo starts empty, the data cache is kept. */
async function visit() {
  request.reads.clear();
  return cachedFaqPage("ro");
}

describe("§333 the FAQ page is read from the public cache and a save expires it", () => {
  let admin: StaffUser;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "log").mockImplementation(() => {});
    forgetLastGood();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    await saveFaqPage(db, { actor: admin, expectedVersion: (await readFaqPageSettings(db)).version, fields: { items: [card("Cum mă înscriu?", "How do I register?")] } });
    await setFaqPagePublished(db, { actor: admin, published: true });
    fakeNextCache.reset();
  });

  it("answers a second visit from the cache, and the next visit after a save with the question just saved", async () => {
    expect((await visit()).items.map((item) => item.question)).toEqual(["Cum mă înscriu?"]);
    expect(fakeNextCache.counts.writes).toBe(1);

    // Cached: a second visit is a hit, not a second trip to the database.
    expect((await visit()).items.map((item) => item.question)).toEqual(["Cum mă înscriu?"]);
    expect(fakeNextCache.counts.writes).toBe(1);

    const [first] = await listFaqItemsForAdmin(db);
    await saveFaqPage(db, {
      actor: admin,
      expectedVersion: (await readFaqPageSettings(db)).version,
      fields: {
        items: [
          { ...card(first.questionRo, first.questionEn), id: first.id, answerRoBody: JSON.stringify(first.answerRo), answerEnBody: JSON.stringify(first.answerEn) },
          card("Ce aduc?", "What do I bring?"),
        ],
      },
    });

    // The save expired the pages' tag, and the entry with it.
    expect(fakeNextCache.invalidated).toContain("public:pages");
    expect(fakeNextCache.entries.size).toBe(0);
    expect((await visit()).items.map((item) => item.question)).toEqual(["Cum mă înscriu?", "Ce aduc?"]);
    expect(fakeNextCache.counts.writes).toBe(2);
  });

  it("expires the link's read when the last question is deleted, so the header and footer stop offering the page", async () => {
    // What the header, the footer and the contact page ask (`faqOnSite`): the same cached read.
    request.reads.clear();
    expect(await faqOnSite("ro")).toBe(true);
    const [only] = await listFaqItemsForAdmin(db);
    await saveFaqPage(db, { actor: admin, expectedVersion: (await readFaqPageSettings(db)).version, fields: { items: [{ id: only.id, remove: "on" }] } });

    // The delete is the page's one save: it expires the tag every static page's link was filed under (§549).
    expect(fakeNextCache.invalidated).toContain("public:pages");
    expect(fakeNextCache.entries.size).toBe(0);
    request.reads.clear();
    expect(await faqOnSite("ro")).toBe(false);
  });

  it("expires it when the page is taken off the site, so the next visit reads it as a draft", async () => {
    expect((await visit()).published).toBe(true);
    await setFaqPagePublished(db, { actor: admin, published: false });
    expect(fakeNextCache.invalidated).toContain("public:pages");
    expect(await visit()).toMatchObject({ published: false, items: [] });
  });
});
