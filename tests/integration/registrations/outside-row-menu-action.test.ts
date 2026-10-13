import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-037-07 (§648, §743): the list's «⋮» posts the registration page's own action, so a press from
 * the list puts a registration on the special guests list, takes it off, and is refused when no counted
 * place is free, exactly as the page's — through the one allocator, audited — and comes back to the
 * list with its query. The action asserts the Administrator's role itself.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, role: "ADMIN" as "ADMIN" | "MODERATOR" }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/i18n/navigation", () => ({ getPathname: ({ href }: { href: unknown }) => (typeof href === "string" ? `/ro${href}` : "/ro/admin/registrations/x") }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async (allowed: (role: string) => boolean) => {
    if (!allowed((state.actor as StaffUser).role)) throw Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" });
    return state.actor;
  },
}));
vi.mock("@/modules/notifications/drain", () => ({ drainOutboxAfterResponse: () => undefined, drainOutboxRowsAfterResponse: () => undefined }));

const { setOutsideCapacityAction } = await import("@/app/[locale]/admin/registrations/actions");

let db: TestDatabase;
let close: () => Promise<void>;
let serial = 0;

async function race(capacity: number) {
  const [event] = await db
    .insert(events)
    .values({ type: "RACE", surface: "ASPHALT", startsAt: new Date("2099-11-21T08:00:00.000Z"), timezone: "Europe/Bucharest", capacity, registrationMode: "INTERNAL", editorialStatus: "PUBLISHED", publishedAt: new Date("2026-09-01T10:00:00.000Z"), hiddenListEnabled: true })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "cros-ro", title: "Cros" },
    { eventId: event.id, locale: "en", slug: "cros-en", title: "Cros" },
  ]);
  return event.id;
}

async function register(eventId: string, row: Partial<typeof registrations.$inferInsert> = {}) {
  serial += 1;
  const email = `guest${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 2, defaultName: `Runner ${serial}`, preferredLocale: "ro" })
    .returning();
  const [created] = await db
    .insert(registrations)
    .values({ eventId, participantId: participant.id, kind: "REAL", locale: "ro", registeredName: `Runner ${serial}`, displayName: resolveDisplayName({ legalName: `Runner ${serial}` }), privacyNoticeVersion: 1, privacyAcknowledgedAt: new Date(), resultsNameConsent: false, resultsConsentVersion: 1, status: "CONFIRMED", confirmedAt: new Date(), ...row })
    .returning({ id: registrations.id });
  return created.id;
}

/** The list's hidden form, as the page renders it: the same fields the registration page's form posts, plus the list's query. */
async function press(id: string, outside: boolean): Promise<string> {
  const form = new FormData();
  form.set("uiLocale", "ro");
  form.set("registrationId", id);
  form.set("outside", String(outside));
  form.set("listQuery", "eventId=abc&status=CONFIRMED");
  try {
    await setOutsideCapacityAction(null, form);
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith("REDIRECT ")) return message.slice("REDIRECT ".length);
    throw error;
  }
  throw new Error("the action did not redirect");
}

const outsideOf = async (id: string) => (await db.select({ outside: registrations.outsideCapacity }).from(registrations).where(eq(registrations.id, id)))[0].outside;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
  const [admin] = await db.insert(staffUsers).values({ email: "admin@dev.test", displayName: "Admin", role: "ADMIN" }).returning();
  state.actor = admin;
});

describe("BR-REQ-037-07: the special guests list from the list's «⋮» (§743)", () => {
  it("puts a registration on the list and comes back to the list with its query, audited", async () => {
    const eventId = await race(10);
    const id = await register(eventId);
    const url = await press(id, true);
    expect(url).toContain("/admin/registrations?");
    expect(url).toContain("eventId=abc");
    expect(url).toContain("saved=outsideMarked");
    expect(await outsideOf(id)).toBe(true);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.entityId, id))).not.toHaveLength(0);
  });

  it("takes it off while a counted place is free", async () => {
    const eventId = await race(10);
    const id = await register(eventId, { outsideCapacity: true });
    const url = await press(id, false);
    expect(url).toContain("saved=outsideUnmarked");
    expect(await outsideOf(id)).toBe(false);
  });

  it("refuses taking it off when no counted place is free, and changes nothing", async () => {
    const eventId = await race(1);
    await register(eventId);
    const guest = await register(eventId, { outsideCapacity: true });
    const url = await press(guest, false);
    expect(url).toContain("error=NO_FREE_PLACE");
    expect(url).toContain("capacity=1");
    expect(url).toContain("confirmed=1");
    expect(url).not.toContain("saved=");
    expect(await outsideOf(guest)).toBe(true);
  });

  it("refuses an Organizer's replayed press: the action asserts the role itself", async () => {
    const eventId = await race(10);
    const id = await register(eventId);
    const [organizer] = await db.insert(staffUsers).values({ email: "organizer@dev.test", displayName: "Organizer", role: "MODERATOR" }).returning();
    state.actor = organizer;
    await expect(press(id, true)).rejects.toThrow("FORBIDDEN");
    expect(await outsideOf(id)).toBe(false);
  });
});
