import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet } from "../../helpers/xlsx";

/**
 * §NNN — «Descarcă Excel» for an event's volunteers (the owner, 2026-10-21: «I wanna be able to export volunteers in
 * excel as well»): `format=xlsx` on the CSV's route answers a spreadsheet with the CSV's words — the header in the
 * reader's language, one row per volunteer, the roles given and offered joined by «, », the sheet named «Voluntari» —
 * named by the club's date like the CSV; the CSV itself is unchanged; the role gate is the card's (`canManageVolunteers`).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/db/client", () => ({ getDb: () => state.db }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: "ro" | "en"; namespace: string }) =>
    createTranslator({ locale, messages: locale === "ro" ? ro : en, namespace: namespace as "Admin" }),
}));
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { GET } = await import("@/app/api/admin/events/[id]/volunteers/route");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  const [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  const [dev] = await db.insert(staffUsers).values({ email: "dev@example.test", displayName: "Tudor Tehnic", role: "DEV" }).returning();
  staff.ADMIN = admin;
  staff.DEV = dev;
  state.actor = admin;
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z"), acceptsVolunteers: true }).returning({ id: events.id });
  eventId = event.id;
  const [water, finish] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 },
      { eventId, nameRo: "Sosire", nameEn: "Finish", needed: 2, position: 1 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  const [ana] = await db
    .insert(eventVolunteers)
    .values({
      eventId,
      name: "Ana Pop",
      email: "ana.pop@example.test",
      canonicalEmail: "ana.pop@example.test",
      canonicalizationVersion: 1,
      phone: "0712345678",
      source: "PUBLIC",
      state: "CONFIRMED",
      roleId: water.id,
      city: "Brașov",
      age: 34,
      message: "=SUM(1) vin cu mașina",
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
    })
    .returning({ id: eventVolunteers.id });
  await db.insert(eventVolunteerRoleChoices).values([{ volunteerId: ana.id, roleId: water.id }]);
  await db.insert(eventVolunteerRoleAssignments).values([
    { volunteerId: ana.id, roleId: water.id },
    { volunteerId: ana.id, roleId: finish.id },
  ]);
});

const download = (query: string) => GET(new Request(`http://localhost/api/admin/events/${eventId}/volunteers?${query}`), { params: Promise.resolve({ id: eventId }) });

describe("«Descarcă Excel» (§NNN)", () => {
  it("answers a spreadsheet with the CSV's words in the reader's language, named by the club's date", async () => {
    const response = await download("format=xlsx&lang=ro");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="voluntari-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const { rows, sheetName } = readSheet(Buffer.from(await response.arrayBuffer()));
    expect(sheetName).toBe("Voluntari");
    const header = rows[0];
    expect(header.slice(0, 7)).toEqual([
      ro.Admin.volunteers.csvColumns.name,
      ro.Admin.volunteers.csvColumns.state,
      ro.Admin.volunteers.csvColumns.role,
      ro.Admin.volunteers.csvColumns.choices,
      ro.Admin.volunteers.csvColumns.email,
      ro.Admin.volunteers.csvColumns.phone,
      ro.Admin.volunteers.csvColumns.source,
    ]);
    expect(header.at(-2)).toBe(ro.Admin.volunteers.csvColumns.message);
    expect(rows).toHaveLength(2);
    const ana = rows[1];
    expect(ana.slice(0, 7)).toEqual(["Ana Pop", "Confirmat", "Punct de apă, Sosire", "Punct de apă", "ana.pop@example.test", "0712345678", "Din formular"]);
    // The age a number, the city as typed, the message a text cell — a formula-looking message stays words.
    expect(ana[header.indexOf(ro.Admin.volunteers.csvColumns.age)]).toBe("34");
    expect(ana[header.indexOf(ro.Admin.volunteers.csvColumns.city)]).toBe("Brașov");
    expect(ana[header.indexOf(ro.Admin.volunteers.csvColumns.message)]).toBe("=SUM(1) vin cu mașina");
  });

  it("reads in English too, and the CSV is still the CSV", async () => {
    const english = readSheet(Buffer.from(await (await download("format=xlsx&lang=en")).arrayBuffer()));
    expect(english.sheetName).toBe("Volunteers");
    expect(english.rows[1].slice(0, 4)).toEqual(["Ana Pop", "Confirmed", "Water point, Finish", "Water point"]);

    const csv = await download("lang=ro");
    expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("Content-Disposition")).toMatch(/voluntari-\d{4}-\d{2}-\d{2}\.csv/);
    // The BOM is on the wire (`subscribers-csv.ts`); `Response.text()` decodes it away, so the bytes are read.
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    // The CSV keeps its own order (§761): the role given first, nothing moved.
    expect(text.split("\r\n")[0].startsWith(`${ro.Admin.volunteers.csvColumns.role},`)).toBe(true);
    expect(text).toContain("Ana Pop");
  });

  it("is refused to the Tehnic role whatever the format", async () => {
    state.actor = staff.DEV;
    expect((await download("format=xlsx&lang=ro")).status).toBe(403);
    expect((await download("lang=ro")).status).toBe(403);
  });
});
