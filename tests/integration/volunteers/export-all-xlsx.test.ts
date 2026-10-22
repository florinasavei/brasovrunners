import { writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerCategories, eventVolunteerRoleAssignments, eventVolunteerRoleChoices, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { SHEET_FRAME, SHEET_TINT } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { readSheet, unzip } from "../../helpers/xlsx";

/**
 * §846 — the volunteers' spreadsheet «formatat frumos», and «Descarcă Excel: toate evenimentele» on the «Voluntari» screen
 * (the owner, 2026-10-22: «La voluntari vreau să descarc și excel formatat frumos, nu doar CSV»). The file is read as bytes
 * (`helpers/xlsx.ts`), never through a library's own round trip: the header in the club's blue with white words, a filter on
 * every column, the row tinted by its «Stare» through a rule over its own cell, «De repartizat» spelled out, and a second
 * sheet «Pe roluri» with each role's «N din M», what it still lacks and a total; the every-event file has «Eveniment» first,
 * one audit row per event, and the card's gate.
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

const { GET: eventFile } = await import("@/app/api/admin/events/[id]/volunteers/route");
const { GET: everyEventFile } = await import("@/app/api/admin/volunteers/export/route");

let db: TestDatabase;
let close: () => Promise<void>;
let crossId: string;
let trailId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const words = ro.Admin.volunteers;
/** The writer's colours as the styles part spells them: `FF` and the hex in capitals. */
const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function seedEvent(title: string, startsAt: string) {
  const [event] = await db.insert(events).values({ type: "RACE", startsAt: new Date(startsAt), acceptsVolunteers: true }).returning({ id: events.id });
  await db.insert(eventTranslations).values([
    { eventId: event.id, locale: "ro", slug: `ro-${event.id.slice(0, 8)}`, title },
    { eventId: event.id, locale: "en", slug: `en-${event.id.slice(0, 8)}`, title: `${title} (EN)` },
  ]);
  return event.id;
}

async function seedPerson(eventId: string, name: string, state: "REGISTERED" | "CONFIRMED" | "CANCELLED", createdAt: string) {
  const [person] = await db
    .insert(eventVolunteers)
    .values({
      eventId,
      name,
      email: `${name.toLowerCase().replace(/\s/g, ".")}@example.test`,
      canonicalEmail: `${name.toLowerCase().replace(/\s/g, ".")}@example.test`,
      canonicalizationVersion: 1,
      phone: "0712345678",
      source: "PUBLIC",
      state,
      createdAt: new Date(createdAt),
    })
    .returning({ id: eventVolunteers.id });
  return person.id;
}

beforeEach(async () => {
  await resetTables(db);
  const [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  const [dev] = await db.insert(staffUsers).values({ email: "dev@example.test", displayName: "Tudor Tehnic", role: "DEV" }).returning();
  staff.ADMIN = admin;
  staff.DEV = dev;
  state.actor = admin;

  crossId = await seedEvent("Crosul Brașovului", "2026-11-21T08:00:00.000Z");
  trailId = await seedEvent("Tâmpa Trail", "2027-05-10T07:00:00.000Z");
  const [water, finish, unnumbered] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId: crossId, nameRo: "Punct de apă", nameEn: "Water point", needed: 3, position: 0 },
      { eventId: crossId, nameRo: "Sosire", nameEn: "Finish", needed: 1, position: 1 },
      { eventId: crossId, nameRo: "Ajutor", nameEn: "Helper", needed: null, position: 2 },
    ])
    .returning({ id: eventVolunteerRoles.id });
  const [marshal] = await db.insert(eventVolunteerRoles).values({ eventId: trailId, nameRo: "Marcaj", nameEn: "Marking", needed: 2, position: 0 }).returning({ id: eventVolunteerRoles.id });

  const ana = await seedPerson(crossId, "Ana Pop", "CONFIRMED", "2026-10-01T10:00:00.000Z");
  const dan = await seedPerson(crossId, "Dan Ene", "REGISTERED", "2026-10-02T10:00:00.000Z");
  const ion = await seedPerson(crossId, "Ion Lupu", "REGISTERED", "2026-10-03T10:00:00.000Z");
  await seedPerson(crossId, "Eva Stan", "CANCELLED", "2026-10-04T10:00:00.000Z");
  const mara = await seedPerson(trailId, "Mara Dinu", "CONFIRMED", "2026-10-05T10:00:00.000Z");
  await db.insert(eventVolunteerRoleChoices).values([
    { volunteerId: ana, roleId: water.id },
    { volunteerId: dan, roleId: water.id },
    { volunteerId: ion, roleId: water.id },
    { volunteerId: ion, roleId: finish.id },
    { volunteerId: mara, roleId: marshal.id },
  ]);
  await db.insert(eventVolunteerRoleAssignments).values([
    { volunteerId: ana, roleId: water.id },
    { volunteerId: dan, roleId: finish.id },
    { volunteerId: dan, roleId: unnumbered.id },
    { volunteerId: mara, roleId: marshal.id },
  ]);
});

const oneEvent = (query: string) => eventFile(new Request(`http://localhost/api/admin/events/${crossId}/volunteers?${query}`), { params: Promise.resolve({ id: crossId }) });
const allEvents = (query: string) => everyEventFile(new Request(`http://localhost/api/admin/volunteers/export?${query}`));
const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());

describe("the volunteers' spreadsheet, «formatat frumos» (§846)", () => {
  it("frames the people: the club's blue header with white words, a filter on every column, «De repartizat», a tint per state", async () => {
    const buffer = await bytes(await oneEvent("format=xlsx&lang=ro"));
    if (process.env.VOLUNTEERS_XLSX_SAMPLE) writeFileSync(process.env.VOLUNTEERS_XLSX_SAMPLE, buffer);
    const parts = unzip(buffer);
    const sheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
    const styles = parts.get("xl/styles.xml") ?? "";

    // The header's fill and words: the club's deep blue, white.
    expect(styles).toContain(argb(SHEET_FRAME.header));
    expect(styles).toContain(argb(SHEET_FRAME.headerInk));
    // One event: no «Eveniment» column; the filter covers the header and the four people, twenty columns wide.
    const { rows } = readSheet(buffer);
    expect(rows[0][0]).toBe(words.csvColumns.name);
    expect(rows).toHaveLength(5);
    expect(sheet).toMatch(/<\/sheetData><autoFilter ref="A1:T5"\/>/);
    expect(parts.get("xl/workbook.xml")).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Voluntari'!$A$1:$T$5</definedName>`);
    // Printed, the header repeats on every page.
    expect(parts.get("xl/workbook.xml")).toContain(`<definedName name="_xlnm.Print_Titles" localSheetId="0">'Voluntari'!$1:$1</definedName>`);
    // The header and the name stay on screen.
    expect(sheet).toMatch(/<pane [^>]*xSplit="1"/);
    expect(sheet).toMatch(/<pane [^>]*ySplit="1"/);

    // Grouped as the CSV: the offer nobody placed first, then by the first role given. Ion has no role: «De repartizat»;
    // Eva is cancelled and has none, and needs none.
    const names = rows.slice(1).map((row) => row[0]);
    expect(names).toEqual(["Ion Lupu", "Eva Stan", "Ana Pop", "Dan Ene"]);
    expect(rows[1][2]).toBe(words.unassigned.title);
    expect(rows[2][2]).toBeUndefined();
    expect(rows[3][2]).toBe("Punct de apă");

    // A tint per state, by a rule over the row's own «Stare» cell — so a state changed in the file recolours its row.
    for (const word of [words.states.CONFIRMED, words.states.REGISTERED, words.states.CANCELLED]) expect(sheet).toContain(`<formula>$B2="${word}"</formula>`);
    expect(sheet).toContain('sqref="A2:T5"');
    for (const tint of [SHEET_TINT.success, SHEET_TINT.warning, SHEET_TINT.neutral]) expect(styles).toContain(argb(tint));
  });

  it("counts the roles on «Pe roluri»: needed, given, confirmed, still lacking, offered, and a total", async () => {
    const buffer = await bytes(await oneEvent("format=xlsx&lang=ro"));
    const { rows, sheetName } = readSheet(buffer, 2);
    expect(sheetName).toBe(words.sheet.roles);
    // No role has a category: no «Categorie» column.
    expect(rows[0]).toEqual([words.sheet.role, words.sheet.needed, words.sheet.taken, words.sheet.confirmed, words.sheet.free, words.sheet.offered]);
    // Punct de apă: 3 needed, Ana given it and confirmed, 2 lacking, 3 offered (Ana, Dan, Ion — Eva cancelled is not counted).
    expect(rows[1]).toEqual(["Punct de apă", "3", "1", "1", "2", "3"]);
    // Sosire: 1 needed, Dan given it, not confirmed, none lacking, Ion offered.
    expect(rows[2]).toEqual(["Sosire", "1", "1", "0", "0", "1"]);
    // Ajutor has no number: «fără număr», nothing lacking.
    expect(rows[3].slice(0, 2)).toEqual(["Ajutor", words.sheet.noNumber]);
    expect(rows[3][4]).toBe("—");
    // The total: what the numbered roles need and lack; the offers are not summed (an empty cell is not written).
    expect(rows[4].slice(0, 5)).toEqual([words.sheet.total, "4", "3", "1", "2"]);
    expect(rows[4][5]).toBeUndefined();
    // A report somebody hands round: printed one page wide.
    const sheet = unzip(buffer).get("xl/worksheets/sheet2.xml") ?? "";
    expect(sheet).toContain('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
    expect(sheet).toMatch(/<pageSetup fitToWidth="1" fitToHeight="0" [^>]*orientation="landscape"/);
  });

  it("names each role's category once the event has categories, «Alte roluri» for the rest", async () => {
    const [route] = await db.insert(eventVolunteerCategories).values({ eventId: crossId, nameRo: "Traseu", nameEn: "Course", sort: 0 }).returning({ id: eventVolunteerCategories.id });
    await db.update(eventVolunteerRoles).set({ categoryId: route.id }).where(eq(eventVolunteerRoles.nameRo, "Punct de apă"));
    const { rows } = readSheet(await bytes(await oneEvent("format=xlsx&lang=ro")), 2);
    expect(rows[0].slice(0, 2)).toEqual([words.sheet.category, words.sheet.role]);
    expect(rows.slice(1, 4).map((row) => [row[0], row[1]])).toEqual([
      ["Traseu", "Punct de apă"],
      [words.otherCategory, "Sosire"],
      [words.otherCategory, "Ajutor"],
    ]);
  });

  it("reads in English", async () => {
    const buffer = await bytes(await oneEvent("format=xlsx&lang=en"));
    expect(readSheet(buffer).sheetName).toBe(en.Admin.volunteers.sheet.people);
    expect(readSheet(buffer).rows[1][2]).toBe(en.Admin.volunteers.unassigned.title);
    expect(readSheet(buffer, 2).rows[1][0]).toBe("Water point");
  });
});

describe("«Descarcă Excel: toate evenimentele» (§846)", () => {
  it("puts every event the screen offers in one workbook, «Eveniment» first, named for every event", async () => {
    const response = await allEvents("lang=ro");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="voluntari-toate-evenimentele-\d{4}-\d{2}-\d{2}\.xlsx"/);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const buffer = await bytes(response);
    if (process.env.VOLUNTEERS_XLSX_SAMPLE_ALL) writeFileSync(process.env.VOLUNTEERS_XLSX_SAMPLE_ALL, buffer);
    const { rows } = readSheet(buffer);
    expect(rows[0].slice(0, 2)).toEqual([words.sheet.event, words.csvColumns.name]);
    // The select's order (newest first), each event's people as its own file has them.
    expect(rows.slice(1).map((row) => [row[0], row[1]])).toEqual([
      ["Tâmpa Trail · 10.05.2027", "Mara Dinu"],
      ["Crosul Brașovului · 21.11.2026", "Ion Lupu"],
      ["Crosul Brașovului · 21.11.2026", "Eva Stan"],
      ["Crosul Brașovului · 21.11.2026", "Ana Pop"],
      ["Crosul Brașovului · 21.11.2026", "Dan Ene"],
    ]);
    // The header, the event and the name stay on screen; the filter is one column wider.
    expect(unzip(buffer).get("xl/worksheets/sheet1.xml")).toMatch(/<pane [^>]*xSplit="2"/);
    expect(unzip(buffer).get("xl/worksheets/sheet1.xml")).toContain('<autoFilter ref="A1:U6"/>');
    // «Pe roluri»: each event's roles, each with its total.
    const roles = readSheet(buffer, 2).rows.slice(1);
    expect(roles.map((row) => [row[0], row[1]])).toEqual([
      ["Tâmpa Trail · 10.05.2027", "Marcaj"],
      ["Tâmpa Trail · 10.05.2027", words.sheet.total],
      ["Crosul Brașovului · 21.11.2026", "Punct de apă"],
      ["Crosul Brașovului · 21.11.2026", "Sosire"],
      ["Crosul Brașovului · 21.11.2026", "Ajutor"],
      ["Crosul Brașovului · 21.11.2026", words.sheet.total],
    ]);
  });

  it("leaves one audit row per event, as each event's own download does — who, which event, how many rows", async () => {
    await allEvents("lang=ro");
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, "volunteer.exported"));
    expect(audits.map((row) => [row.entityId, (row.metadataJson as { rows: number }).rows]).sort()).toEqual(
      [
        [crossId, 4],
        [trailId, 1],
      ].sort(),
    );
  });

  it("writes a header-only file for an event that takes volunteers and has nobody yet, and for no event at all", async () => {
    await db.delete(eventVolunteers);
    const buffer = await bytes(await allEvents("lang=ro"));
    expect(readSheet(buffer).rows).toHaveLength(1);
    expect(unzip(buffer).get("xl/worksheets/sheet1.xml")).toContain('<autoFilter ref="A1:U1"/>');
    // The roles still say what each event needs.
    expect(readSheet(buffer, 2).rows.slice(1).map((row) => row[1])).toEqual(["Marcaj", words.sheet.total, "Punct de apă", "Sosire", "Ajutor", words.sheet.total]);

    await db.delete(events);
    const empty = readSheet(await bytes(await allEvents("lang=ro")));
    expect(empty.rows).toHaveLength(1);
  });

  it("is refused to the Tehnic role", async () => {
    state.actor = staff.DEV;
    expect((await allEvents("lang=ro")).status).toBe(403);
  });
});
