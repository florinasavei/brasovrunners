import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §714 — «Pagina principală» is read from the public cache (`cachedHomePage`), the root's and the
 * header's one read of it. A save is seen at the next visit; and when the database cannot answer, the
 * last good copy is what the root reads (§447), never a throw over the site's most-visited address.
 */
let db: TestDatabase;
let close: () => Promise<void>;
const outage = vi.hoisted(() => ({ down: false }));
vi.mock("@/db/client", () => ({
  getDb: () => {
    if (outage.down) throw new Error("the database is not answering");
    return db;
  },
}));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/modules/diagnostics/budget-level", () => ({ peekNeonBudgetLevel: () => "unknown", lastKnownBudget: () => null }));
const request = vi.hoisted(() => ({ reads: new Map<string, Promise<unknown>>() }));
vi.mock("@/modules/public-cache/request-memo", () => ({ thisRequestsReads: () => request.reads }));

const { fakeNextCache } = await import("../../helpers/next-cache");
const { cachedHomePage } = await import("@/modules/public-cache/reads");
const { forgetLastGood } = await import("@/modules/resilience/last-good");
const { updateHomePage } = await import("@/modules/appearance/home-page");

/** A new request: the request's own memo starts empty, the data cache is kept. */
async function visit() {
  request.reads.clear();
  return cachedHomePage();
}

describe("§714 the home page's setting is read from the public cache", () => {
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
    outage.down = false;
    forgetLastGood();
    [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
    fakeNextCache.reset();
  });

  it("reads off with no row, and the club's save at the next visit", async () => {
    expect((await visit()).on).toBe(false);
    await updateHomePage(db, admin, { page: "on" }, new Date("2026-10-11T10:00:00Z"));
    expect((await visit()).on).toBe(true);
  });

  it("falls back to the last good copy when the database cannot answer", async () => {
    await updateHomePage(db, admin, { page: "on" }, new Date("2026-10-11T10:00:00Z"));
    expect((await visit()).on).toBe(true);

    // The data cache is gone (a new deployment, an expiry) and the database is down: the last good copy.
    fakeNextCache.reset();
    outage.down = true;
    expect((await visit()).on).toBe(true);
  });
});
