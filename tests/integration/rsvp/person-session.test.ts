import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { personSessions } from "@/db/schema/person-sessions";
import { hashTokenSecret } from "@/modules/action-tokens/domain/token-secret";
import { decodeHint, PERSON_COOKIE, PERSON_HINT_COOKIE, PERSON_SESSION_SECONDS, PERSON_SESSIONS_PER_ADDRESS } from "@/modules/person-session/domain/hint";
import { type CookieOptions, type CookieStore, deleteExpiredPersonSessions, forgetPerson, readRememberedPerson, refreshPerson, rememberPerson } from "@/modules/person-session/session";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const DAY = 24 * 60 * 60_000;

/** A browser's cookie jar, with the options each cookie was set with. */
function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const options = new Map<string, CookieOptions | undefined>();
  const store: CookieStore = {
    get: (name) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name, value, opts) => {
      values.set(name, value);
      options.set(name, opts);
    },
    delete: (name) => {
      values.delete(name);
    },
  };
  return { store, values, options };
}

/**
 * §811 («Vin!» part 1) — the remembered browser, the small module the members' zone reuses: a secret in an `httpOnly` cookie whose
 * SHA-256 is the only thing stored, a readable hint that holds no secret, a year's life, a forged or stale cookie refused, «Nu sunt
 * eu» forgetting it, and the sweep taking what has expired.
 */
describe("§811 the remembered browser (person-session)", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await resetTables(db);
  });

  it("remembers a person: the secret in an httpOnly Lax cookie for a year, its hash in the table, a hint with no secret beside it", async () => {
    const browser = jar();
    const person = await rememberPerson(db, browser.store, { email: " Ana.Pop@gmail.com ", displayName: " Ana " }, NOW);
    expect(person).toMatchObject({ email: "Ana.Pop@gmail.com", canonicalEmail: "ana.pop@gmail.com", canonicalizationVersion: 2, displayName: "Ana" });

    const secret = browser.values.get(PERSON_COOKIE)!;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(browser.options.get(PERSON_COOKIE)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: PERSON_SESSION_SECONDS });

    const [row] = await db.select().from(personSessions);
    expect(row.secretHash).toBe(hashTokenSecret(secret));
    expect(row.secretHash).not.toBe(secret);
    expect(row.expiresAt.getTime() - NOW.getTime()).toBe(365 * DAY);
    // Nothing stored is the secret.
    expect(JSON.stringify(row)).not.toContain(secret);

    // The hint script-readable: the masked address and the name, never the secret or the full address.
    const hint = browser.values.get(PERSON_HINT_COOKIE)!;
    expect(browser.options.get(PERSON_HINT_COOKIE)).toMatchObject({ httpOnly: false, sameSite: "lax", path: "/", maxAge: PERSON_SESSION_SECONDS });
    expect(decodeHint(hint)).toEqual({ masked: "An…@gmail.com", name: "Ana" });
    expect(hint).not.toContain(secret);
    expect(hint).not.toContain("Pop@");
  });

  it("recognises the browser by its cookie, bumps the last use, and gives the identity the answer is made as", async () => {
    const browser = jar();
    await rememberPerson(db, browser.store, { email: "ana@example.test", displayName: null }, NOW);
    const later = new Date(NOW.getTime() + 10 * DAY);
    const person = await readRememberedPerson(db, browser.store, later);
    expect(person).toMatchObject({ email: "ana@example.test", canonicalEmail: "ana@example.test", displayName: null });
    expect((await db.select().from(personSessions))[0].lastUsedAt.toISOString()).toBe(later.toISOString());
  });

  it("refuses a missing cookie, one that is not the shape we issue, an unknown secret and an expired row — all alike", async () => {
    const browser = jar();
    await rememberPerson(db, browser.store, { email: "ana@example.test" }, NOW);
    const real = browser.values.get(PERSON_COOKIE)!;

    expect(await readRememberedPerson(db, jar().store, NOW)).toBeNull();
    for (const forged of ["", "short", "x".repeat(43), real.slice(0, 42) + (real.endsWith("A") ? "B" : "A"), `${real}extra`, "../../etc/passwd"]) {
      expect(await readRememberedPerson(db, jar({ [PERSON_COOKIE]: forged }).store, NOW), forged).toBeNull();
    }
    // The hint alone proves nothing.
    expect(await readRememberedPerson(db, jar({ [PERSON_HINT_COOKIE]: browser.values.get(PERSON_HINT_COOKIE)! }).store, NOW)).toBeNull();
    // A year and a moment later.
    expect(await readRememberedPerson(db, browser.store, new Date(NOW.getTime() + 365 * DAY))).toBeNull();
    expect(await readRememberedPerson(db, browser.store, new Date(NOW.getTime() + 365 * DAY - 1))).not.toBeNull();
  });

  it("gives one browser one row: remembering again replaces its old one, and a second browser is a second row", async () => {
    const first = jar();
    await rememberPerson(db, first.store, { email: "ana@example.test" }, NOW);
    const oldSecret = first.values.get(PERSON_COOKIE)!;
    await rememberPerson(db, first.store, { email: "ana@example.test", displayName: "Ana" }, new Date(NOW.getTime() + DAY));
    expect(await db.select().from(personSessions)).toHaveLength(1);
    expect(first.values.get(PERSON_COOKIE)).not.toBe(oldSecret);
    expect(await readRememberedPerson(db, jar({ [PERSON_COOKIE]: oldSecret }).store, NOW)).toBeNull();

    await rememberPerson(db, jar().store, { email: "ana@example.test" }, NOW);
    expect(await db.select().from(personSessions)).toHaveLength(2);
  });

  it(`keeps at most ${PERSON_SESSIONS_PER_ADDRESS} browsers for one address — the least recently used go`, async () => {
    const jars = Array.from({ length: PERSON_SESSIONS_PER_ADDRESS + 3 }, () => jar());
    for (const [index, browser] of jars.entries()) await rememberPerson(db, browser.store, { email: "ana@example.test" }, new Date(NOW.getTime() + index * 60_000));
    expect(await db.select().from(personSessions)).toHaveLength(PERSON_SESSIONS_PER_ADDRESS);
    // The three oldest are gone; the newest still opens.
    expect(await readRememberedPerson(db, jars[0].store, new Date(NOW.getTime() + 60 * 60_000))).toBeNull();
    expect(await readRememberedPerson(db, jars.at(-1)!.store, new Date(NOW.getTime() + 60 * 60_000))).not.toBeNull();
    // Another address is its own count.
    await rememberPerson(db, jar().store, { email: "ion@example.test" }, NOW);
    expect(await db.select().from(personSessions)).toHaveLength(PERSON_SESSIONS_PER_ADDRESS + 1);
  });

  it("refuses an address that is not one, and stores nothing", async () => {
    const browser = jar();
    await expect(rememberPerson(db, browser.store, { email: "not an address" }, NOW)).rejects.toThrow();
    expect(await db.select().from(personSessions)).toHaveLength(0);
    expect(browser.values.size).toBe(0);
  });

  it("gives an answering browser another year, and moves both cookies' lives with it", async () => {
    const browser = jar();
    await rememberPerson(db, browser.store, { email: "ana@example.test", displayName: "Ana" }, NOW);
    const later = new Date(NOW.getTime() + 200 * DAY);
    const person = (await readRememberedPerson(db, browser.store, later))!;
    await refreshPerson(db, browser.store, person, later);
    expect((await db.select().from(personSessions))[0].expiresAt.getTime()).toBe(later.getTime() + 365 * DAY);
    expect(browser.options.get(PERSON_COOKIE)?.maxAge).toBe(PERSON_SESSION_SECONDS);
    expect(await readRememberedPerson(db, browser.store, new Date(NOW.getTime() + 400 * DAY))).not.toBeNull();
  });

  it("forgets on «Nu sunt eu»: the row deleted, both cookies cleared, and the same call again is harmless", async () => {
    const browser = jar();
    await rememberPerson(db, browser.store, { email: "ana@example.test" }, NOW);
    const other = jar();
    await rememberPerson(db, other.store, { email: "ana@example.test" }, NOW);
    await forgetPerson(db, browser.store);
    expect(browser.values.has(PERSON_COOKIE)).toBe(false);
    expect(browser.values.has(PERSON_HINT_COOKIE)).toBe(false);
    // Only this browser's row went.
    const left = await db.select().from(personSessions);
    expect(left).toHaveLength(1);
    expect(left[0].secretHash).toBe(hashTokenSecret(other.values.get(PERSON_COOKIE)!));
    await expect(forgetPerson(db, browser.store)).resolves.toBeUndefined();
    await expect(forgetPerson(db, jar({ [PERSON_COOKIE]: "x".repeat(43) }).store)).resolves.toBeUndefined();
  });

  it("is swept when it expires, and not before", async () => {
    const old = jar();
    await rememberPerson(db, old.store, { email: "ana@example.test" }, NOW);
    await rememberPerson(db, jar().store, { email: "ion@example.test" }, new Date(NOW.getTime() + 100 * DAY));
    expect(await deleteExpiredPersonSessions(db, new Date(NOW.getTime() + 364 * DAY))).toBe(0);
    expect(await deleteExpiredPersonSessions(db, new Date(NOW.getTime() + 366 * DAY))).toBe(1);
    expect((await db.select().from(personSessions).where(eq(personSessions.canonicalEmail, "ion@example.test")))).toHaveLength(1);
  });

  it("stores only a 64-hex fingerprint: the database refuses a raw secret", async () => {
    await expect(
      db.insert(personSessions).values({ canonicalEmail: "a@b.test", deliveryEmail: "a@b.test", canonicalizationVersion: 2, secretHash: "x".repeat(43), expiresAt: new Date(NOW.getTime() + DAY) }),
    ).rejects.toThrow();
  });
});
