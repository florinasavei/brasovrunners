import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { events, eventTranslations } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { addEliteEntry } from "@/modules/registrations/elite-list";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * «Elită — doar numele pe BIB» (§895; BR-REQ-038-01, BR-REQ-060-01): the sheet `GET /api/admin/events/<id>/bibs?elite=1`
 * prints every name on the event's elite list, the file named `…-elite.pdf`, for the roles that read the bibs — the
 * Organizer and the Administrators — and nobody else; the preview's `elite=1` draws one elite bib with a sample name.
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("@/auth", () => ({ signOut: async () => {} }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET: sheet } = await import("@/app/api/admin/events/[id]/bibs/route");
const { GET: preview } = await import("@/app/api/admin/events/[id]/bibs/preview/route");

describe("§895 the elite sheet's route", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  let eventId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    state.db = db;
  });
  afterAll(async () => close());

  let counter = 0;
  async function staff(role: StaffRole): Promise<StaffUser> {
    counter += 1;
    const [user] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}-${counter}@dev.test`, displayName: role, role }).returning();
    return user;
  }

  beforeEach(async () => {
    await resetTables(db);
    const [event] = await db
      .insert(events)
      .values({ type: "RACE", startsAt: new Date("2026-11-21T07:00:00Z"), registrationMode: "INTERNAL", locationName: "Start" })
      .returning();
    await db.insert(eventTranslations).values([
      { eventId: event.id, locale: "ro", title: "Crosul Tâmpei", slug: "crosul-tampei" },
      { eventId: event.id, locale: "en", title: "The Tâmpa cross", slug: "tampa-cross" },
    ]);
    eventId = event.id;
    const admin = await staff("ADMIN");
    for (const [name, bibNumber] of [["Eliud Kipchoge", "1"], ["Faith Kipyegon", ""], ["Jakob Ingebrigtsen", "3"]]) {
      await addEliteEntry(db, admin, eventId, { name, bibNumber }, new Date("2026-11-03T10:00:00Z"));
    }
  });

  const get = (query: string) => sheet(new Request(`http://localhost/api/admin/events/${eventId}/bibs?${query}`), { params: Promise.resolve({ id: eventId }) });

  it("prints every elite line for the Organizer, named «-elite», two to a page", async () => {
    state.actor = await staff("MODERATOR");
    const response = await get("locale=ro&elite=1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/bibs-[0-9a-f]{8}-elite\.pdf/);
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
    // One per page when asked, the name saying so.
    const one = await get("locale=ro&elite=1&layout=one");
    expect(one.headers.get("content-disposition")).toMatch(/-elite-one-per-page\.pdf/);
    expect(Buffer.from(await one.arrayBuffer()).toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(3);
  });

  it("ignores a range and a part on the elite sheet: the list is printed whole", async () => {
    state.actor = await staff("ADMIN");
    const response = await get("locale=en&elite=1&from=2&to=2&part=members&only=unprinted");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/bibs-[0-9a-f]{8}-elite\.pdf/);
    expect(Buffer.from(await response.arrayBuffer()).toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it.each<StaffRole>(["DEV", "CONTRIBUTOR", "COPYWRITER"])("refuses %s, as the sheet always has", async (role) => {
    state.actor = await staff(role);
    const response = await get("locale=ro&elite=1");
    expect(response.status).toBe(403);
  });

  it("draws one elite bib as the editor's sample, a PNG", async () => {
    state.actor = await staff("ADMIN");
    const response = await preview(new Request(`http://localhost/api/admin/events/${eventId}/bibs/preview?sample=1&locale=ro&elite=1&eliteNumber=1&number=7`), {
      params: Promise.resolve({ id: eventId }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});
