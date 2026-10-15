import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { resolveDisplayName } from "@/modules/registrations/names";
import { readSheet } from "../../helpers/xlsx";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-060-01, §779 — «I can't export the participants as excel anymore!» (the owner, 2026-10-15), from a
 * real database: the race «CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026» has a «Ș», a «Ț» and an en
 * dash, an HTTP header is Latin-1 bytes, and the export answered 500 («Cannot convert argument to a
 * ByteString because the character at index 42 has a value of 536»).
 *
 * The Excel export answers 200 with a workbook that opens and a header a `Headers` accepts, the ASCII fallback
 * beside the real name; the CSV export keeps its plain name; the event's own JSON export, named from its slug,
 * is fine too.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("next-intl/server", async () => (await import("../../helpers/intl-server")).intlServerMock);
vi.mock("next/cache", async () => (await import("../../helpers/next-cache")).fakeNextCache.module);
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => {}, signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET: exportRegistrations } = await import("@/app/api/admin/registrations/export/route");

const TITLE = "CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026";

let db: TestDatabase;
let close: () => Promise<void>;

async function createRace(title: string) {
  const [event] = await db
    .insert(events)
    .values({
      type: "RACE",
      surface: "ASPHALT",
      startsAt: new Date("2099-11-21T06:00:00.000Z"),
      timezone: "Europe/Bucharest",
      capacity: 150,
      registrationMode: "INTERNAL",
      editorialStatus: "PUBLISHED",
      publishedAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    .returning();
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: "crosul-aniversar", title },
    { eventId: event.id, locale: "en", slug: "anniversary-run", title },
  ]);
  return event;
}

async function register(eventId: string, name: string, serial: number) {
  const email = `runner${serial}@example.org`;
  const [participant] = await db
    .insert(participants)
    .values({ deliveryEmail: email, normalizedEmail: email, canonicalEmail: email, canonicalizationVersion: 1, defaultName: name, preferredLocale: "ro" })
    .returning();
  await db.insert(registrations).values({
    eventId,
    participantId: participant.id,
    kind: "REAL",
    locale: "ro",
    registeredName: name,
    displayName: resolveDisplayName({ legalName: name }),
    privacyNoticeVersion: 1,
    privacyAcknowledgedAt: new Date(),
    resultsNameConsent: false,
    resultsConsentVersion: 1,
    status: "CONFIRMED",
  });
}

async function staff(role: "ADMIN" | "MODERATOR"): Promise<StaffUser> {
  const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@dev.test`, displayName: role, role }).returning();
  return user;
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

describe("BR-REQ-060-01 §779 the registrations export, for an event whose title has diacritics", () => {
  it("the Excel export answers 200 with a workbook and a header a Headers accepts, the real name in filename*", async () => {
    const race = await createRace(TITLE);
    await register(race.id, "Ștefan Țepeș", 1);
    await register(race.id, "Ana Brașov", 2);
    state.actor = await staff("MODERATOR");

    const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${race.id}&format=xlsx`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const header = response.headers.get("Content-Disposition")!;
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
    expect(header).toMatch(/^attachment; filename="CROSUL ANIVERSAR BRASOV RUNNERS - EDITIA A II-A 2026 \d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''/);
    const star = /filename\*=UTF-8''(.*)$/.exec(header)![1];
    expect(decodeURIComponent(star)).toMatch(/^CROSUL ANIVERSAR BRAȘOV RUNNERS – EDIȚIA A II-A 2026 \d{4}-\d{2}-\d{2}\.xlsx$/);

    const { rows } = readSheet(Buffer.from(await response.arrayBuffer()));
    const cells = rows.flat().map(String);
    expect(cells).toContain("Ștefan Țepeș");
    expect(cells).toContain("Ana Brașov");
  });

  it("the CSV export keeps its plain name", async () => {
    const race = await createRace(TITLE);
    await register(race.id, "Ștefan Țepeș", 1);
    state.actor = await staff("ADMIN");

    const response = await exportRegistrations(new Request(`http://localhost/api/admin/registrations/export?eventId=${race.id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="registrations.csv"; filename*=UTF-8''registrations.csv`);
  });

  it("an export across every event is named inscrieri, and still a valid header", async () => {
    const race = await createRace(TITLE);
    await register(race.id, "Ștefan Țepeș", 1);
    state.actor = await staff("ADMIN");

    const response = await exportRegistrations(new Request("http://localhost/api/admin/registrations/export?format=xlsx"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="inscrieri \d{4}-\d{2}-\d{2}\.xlsx"; filename\*=UTF-8''inscrieri%20/);
  });
});
