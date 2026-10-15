import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eventVolunteerCategories, eventVolunteerRoles } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { DEFAULT_BADGE_DESIGN, readBadgeDesign } from "@/modules/volunteers/badges/badge-design";
import { readBadgeDesignForm } from "@/modules/volunteers/badges/badge-query";
import { badgePrintEntries, badgeRoleLabel, badgeRoleName, listBadgeRoles, readPrintCounts, saveBadgeDesign } from "@/modules/volunteers/badges/badges";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — the badges and the categories (the owner, 2026-10-14: «trebuie să fie o persoană de contact pentru voluntari»): «Câte ecusoane» lists
 * the roles under their categories; a badge's band shows the role only; the coordinator's telephone, ticked with no number typed in the
 * design, is the telephone of the contact person of the role's category — and the design's own number, when typed, wins on every role.
 */
const NOW = new Date("2026-10-14T08:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let admin: StaffUser;
let eventId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  [admin] = await db.insert(staffUsers).values({ email: "admin@example.test", displayName: "Ana Admin", role: "ADMIN" }).returning();
  [{ id: eventId }] = await db.insert(events).values({ type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z") }).returning({ id: events.id });
});

async function withCategories() {
  const [start, route] = await db
    .insert(eventVolunteerCategories)
    .values([
      { eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
      { eventId, nameRo: "Traseu", nameEn: "Route", sort: 1, contactName: "Ana Popescu", contactPhone: "+40712345678", contactEmail: null },
    ])
    .returning();
  const [onRoute, atStart, loose] = await db
    .insert(eventVolunteerRoles)
    .values([
      { eventId, categoryId: route.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 4, position: 0 },
      { eventId, categoryId: start.id, nameRo: "Direcționare", nameEn: "Guidance", needed: 2, position: 1 },
      { eventId, categoryId: null, nameRo: "Foto/Video", nameEn: "Photo/Video", needed: 1, position: 2 },
    ])
    .returning();
  return { start, route, onRoute, atStart, loose };
}

const values = (fields: Record<string, string>) =>
  readBadgeDesignForm((name) => fields[name] ?? null);
const FORM = { "badge.design.size": "strip90", "badge.design.showLogo": "on", "badge.design.showTitle": "on", "badge.design.writingLine": "on", "badge.design.cutMarks": "on" };

describe("§NNN «Câte ecusoane»: the roles under their categories", () => {
  it("lists them in the category order — the start's, the route's, then the roles under none — with their category's words and its contact's telephone", async () => {
    const { onRoute, atStart, loose } = await withCategories();
    const roles = await listBadgeRoles(db, eventId);
    expect(roles.map((role) => role.id)).toEqual([atStart.id, onRoute.id, loose.id]);
    expect(roles.map((role) => [role.categoryRo, role.categoryEn, role.categoryPhone])).toEqual([
      ["Start / Sosire", "Start / Finish", null],
      ["Traseu", "Route", "+40712345678"],
      [null, null, null],
    ]);
    // The page names a role with its category; the band prints the role only.
    expect(roles.map((role) => badgeRoleLabel(role, "ro"))).toEqual(["Direcționare (Start / Sosire)", "Direcționare (Traseu)", "Foto/Video"]);
    expect(roles.map((role) => badgeRoleName(role, "ro"))).toEqual(["Direcționare", "Direcționare", "Foto/Video"]);
    expect(roles.map((role) => badgeRoleLabel(role, "en"))).toEqual(["Guidance (Start / Finish)", "Guidance (Route)", "Photo/Video"]);
  });

  it("is the order as before for an event with no category", async () => {
    await db.insert(eventVolunteerRoles).values([
      { eventId, nameRo: "B", nameEn: "B", needed: 1, position: 1 },
      { eventId, nameRo: "A", nameEn: "A", needed: 1, position: 0 },
    ]);
    expect((await listBadgeRoles(db, eventId)).map((role) => role.nameRo)).toEqual(["A", "B"]);
    expect(await listBadgeRoles(db, "00000000-0000-4000-8000-000000000000")).toEqual([]);
  });

  it("hands the sheet each role's name only and its category's telephone, in the badge's language", async () => {
    await withCategories();
    const roles = await listBadgeRoles(db, eventId);
    const counts = readPrintCounts(new URLSearchParams(), roles);
    if ("refused" in counts) throw new Error("the defaults are refused");
    const entries = badgePrintEntries(roles, counts, "en");
    expect(entries.map((entry) => entry.role)).toEqual([
      { name: "Guidance", colour: expect.any(String), phone: null },
      { name: "Guidance", colour: expect.any(String), phone: "+40712345678" },
      { name: "Photo/Video", colour: expect.any(String), phone: null },
    ]);
    expect(entries.map((entry) => entry.count)).toEqual([2, 4, 1]);
  });
});

describe("§NNN «Telefonul coordonatorului» ticked with no number: the category's telephone", () => {
  it("saves the design with the tick and no number — the badges then carry each role's category telephone — and audits it", async () => {
    const saved = await saveBadgeDesign(db, admin, eventId, values({ ...FORM, "badge.design.showPhone": "on" }), NOW);
    expect(saved).toEqual({ changed: true });
    const [row] = await db.select({ design: events.badgeDesign }).from(events).where(eq(events.id, eventId));
    expect(readBadgeDesign(row.design)).toMatchObject({ showPhone: true, phone: "" });
  });

  it("still refuses a number typed that is no number, with the tick on or off, and keeps a typed one", async () => {
    for (const fields of [
      { ...FORM, "badge.design.showPhone": "on", "badge.design.phone": "call me" },
      { ...FORM, "badge.design.phone": "call me" },
    ]) {
      await expect(saveBadgeDesign(db, admin, eventId, values(fields), NOW)).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["badge.design.phone"] });
    }
    await saveBadgeDesign(db, admin, eventId, values({ ...FORM, "badge.design.showPhone": "on", "badge.design.phone": "0712 345 678" }), NOW);
    const [row] = await db.select({ design: events.badgeDesign }).from(events).where(eq(events.id, eventId));
    expect(readBadgeDesign(row.design)).toMatchObject({ showPhone: true, phone: "0712 345 678" });
    expect(DEFAULT_BADGE_DESIGN.showPhone).toBe(false);
  });
});
