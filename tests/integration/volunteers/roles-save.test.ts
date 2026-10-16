import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerCategories, eventVolunteerRoles } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { encodeRoleBaseline, roleBaselineOf } from "@/modules/volunteers/role-baseline";
import { roleBox } from "@/modules/volunteers/role-rows";
import { changeVolunteerRoles, listVolunteerRoles, type VolunteerRolesRowRequest, VolunteerRoleRowError } from "@/modules/volunteers/volunteers";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { roleDescription } from "../../helpers/role-description";

/** The public cache's expiry, watched: one save of many roles tells the public page once (§791). */
const cache = vi.hoisted(() => ({ revalidatePublicContent: vi.fn() }));
vi.mock("@/modules/public-cache/cache", () => cache);

/**
 * §791 — the event editor's «Roluri» card saved at once (`changeVolunteerRoles`; the owner, 2026-10-16: «să pot face batch edit la roluri, nu să dau
 * save de fiecare dată, ci un Save All»), straight through the service: every row read before anything is written and the first refused one
 * refusing the whole save, naming the role; then, in one transaction, only the roles that differ written — one audit row each — the blank
 * row of a category ignored until a name is typed in it, the position box ordering each category, and the public page told once.
 */
const NOW = new Date("2026-10-16T09:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let otherEventId: string;
let admin: StaffUser;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
let start: { id: string };
let route: { id: string };

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

async function person(role: StaffRole): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: role, role }).returning();
  return row;
}

beforeEach(async () => {
  await resetTables(db);
  cache.revalidatePublicContent.mockClear();
  admin = await person("ADMIN");
  for (const role of ["MODERATOR", "DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) staff[role] = await person(role);
  const [first, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z") },
      { type: "GROUP_RUN", startsAt: new Date("2026-11-04T16:00:00.000Z") },
    ])
    .returning({ id: events.id });
  eventId = first.id;
  otherEventId = second.id;
  [start, route] = await db
    .insert(eventVolunteerCategories)
    .values([
      { eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0 },
      { eventId, nameRo: "Traseu", nameEn: "Route", sort: 1 },
    ])
    .returning({ id: eventVolunteerCategories.id });
});

/** A saved role, in the order it is given: `position` is its place in the event's list. */
async function seed(nameRo: string, categoryId: string | null, over: Partial<typeof eventVolunteerRoles.$inferInsert> = {}) {
  const position = over.position ?? (await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, over.eventId ?? eventId))).length;
  const [row] = await db
    .insert(eventVolunteerRoles)
    .values({ eventId, nameRo, nameEn: `${nameRo} EN`, needed: 2, categoryId, position, createdAt: new Date(NOW.getTime() + position), ...over })
    .returning();
  return row;
}

/** One row of the form: a saved role (its id) or the blank row of a category (`new-<id>`), its boxes by their short names. */
const row = (id: string | null, fields: Record<string, unknown>, key = id ?? "new-none"): VolunteerRolesRowRequest => ({ key, id, fields });
const save = (rows: VolunteerRolesRowRequest[], actor: StaffUser = admin) => changeVolunteerRoles(db, actor, { eventId, rows }, NOW);
const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(auditLogs.createdAt);
const names = async () => (await listVolunteerRoles(db, eventId)).map((role) => role.nameRo);
const refusal = async (rows: VolunteerRolesRowRequest[]) => save(rows).then(
  () => {
    throw new Error("the save was not refused");
  },
  (error: unknown) => error as VolunteerRoleRowError,
);

describe("§791 a save that changes nothing", () => {
  it("writes nothing, audits nothing, tells the public page nothing — a row that posts what the role already is", async () => {
    const water = await seed("Apă", route.id);
    const finish = await seed("Sosire", start.id, { needed: null, ...roleDescription("Aplauze.", "Cheer.") });
    const before = await db.select().from(eventVolunteerRoles);
    const result = await save([
      row(water.id, { nameRo: "Apă", nameEn: "Apă EN", needed: "2", unlimited: "", categoryId: route.id, position: "1" }),
      row(finish.id, { nameRo: "Sosire", nameEn: "Sosire EN", needed: "", unlimited: "on", categoryId: start.id, position: "1", descriptionRoBody: JSON.stringify(roleDescription("Aplauze.", null).descriptionRoJson), descriptionEnBody: JSON.stringify(roleDescription(null, "Cheer.").descriptionEnJson) }),
      row(null, { nameRo: "", nameEn: "", needed: "1", categoryId: start.id }, `new-${start.id}`),
    ]);
    expect(result).toEqual({ changed: false, edited: 0, created: 0 });
    expect(await trail()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
    expect(await db.select().from(eventVolunteerRoles)).toEqual(before);
  });

  it("writes nothing for an empty form, and a row that posts only the boxes it changes keeps the rest — the description, the colour, the category, the number", async () => {
    const role = await seed("Apă", route.id, { colour: "#1b5e20", ...roleDescription("Stai la km 5.", "Stand at km 5.") });
    expect(await save([])).toEqual({ changed: false, edited: 0, created: 0 });
    expect(await save([row(role.id, { nameEn: "Hydration" })])).toEqual({ changed: true, edited: 1, created: 0 });
    const [kept] = await listVolunteerRoles(db, eventId);
    expect(kept).toMatchObject({ nameRo: "Apă", nameEn: "Hydration", needed: 2, colour: "#1b5e20", categoryId: route.id, descriptionRo: "Stai la km 5.", descriptionEn: "Stand at km 5." });
    expect(kept.descriptionRoJson).not.toBeNull();
  });
});

describe("§791 several roles saved at once", () => {
  it("writes only the roles that differ — two changed, one untouched — with one audit row each and one expiry of the public page", async () => {
    const a = await seed("A", start.id);
    const b = await seed("B", start.id);
    const c = await seed("C", route.id);
    const result = await save([
      row(a.id, { nameRo: "A", nameEn: "A bis", needed: "5" }),
      row(b.id, { nameRo: "B", nameEn: "B EN", needed: "2" }),
      row(c.id, { nameRo: "C", nameEn: "C EN", needed: "", unlimited: "on" }),
    ]);
    expect(result).toEqual({ changed: true, edited: 2, created: 0 });
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.map((role) => [role.nameRo, role.nameEn, role.needed])).toEqual([["A", "A bis", 5], ["B", "B EN", 2], ["C", "C EN", null]]);
    const edited = (await trail()).filter((entry) => entry.action === "volunteer_role.edited");
    expect(edited).toHaveLength(2);
    expect(edited.map((entry) => entry.metadataJson)).toMatchObject([
      { roleId: a.id, fields: ["nameEn", "needed"], needed: 5 },
      { roleId: c.id, fields: ["needed"], needed: null },
    ]);
    expect(edited.every((entry) => entry.actorStaffUserId === admin.id && entry.entityType === "event")).toBe(true);
    // The trail names fields and ids, never a description's words.
    expect(JSON.stringify(edited)).not.toMatch(/Stai la/);
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
    expect(cache.revalidatePublicContent).toHaveBeenCalledWith("places");
  });

  it("refuses everything on a refused third row, naming that role and its category and the box — and writes nothing of the first two", async () => {
    const a = await seed("A", start.id);
    const b = await seed("B", start.id);
    const third = await seed("directionare", route.id);
    const error = await refusal([
      row(a.id, { nameRo: "A", nameEn: "A bis", needed: "5" }),
      row(b.id, { nameRo: "B", nameEn: "B bis", needed: "6" }),
      row(third.id, { nameRo: "directionare", nameEn: "", needed: "2" }),
    ]);
    expect(error).toBeInstanceOf(VolunteerRoleRowError);
    expect(error).toMatchObject({ code: "VOLUNTEER_ROLE_INVALID", problem: "nameEnMissing", fields: [roleBox(third.id, "nameEn")], row: { id: third.id, name: "directionare", categoryRo: "Traseu", categoryEn: "Route" } });
    expect((await listVolunteerRoles(db, eventId)).map((role) => [role.nameEn, role.needed])).toEqual([["A EN", 2], ["B EN", 2], ["directionare EN", 2]]);
    expect(await trail()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
  });

  it("refuses the FIRST refused row, in the form's order, and says why for each kind of refusal", async () => {
    const role = await seed("A", start.id);
    const boxes = (fields: Record<string, unknown>) => refusal([row(role.id, { nameRo: "A", nameEn: "A EN", needed: "2", ...fields })]);
    expect(await boxes({ nameRo: " " })).toMatchObject({ problem: "nameRoMissing", fields: [roleBox(role.id, "nameRo")] });
    expect(await boxes({ nameEn: "x".repeat(81) })).toMatchObject({ problem: "nameEnLong", fields: [roleBox(role.id, "nameEn")] });
    expect(await boxes({ needed: "0" })).toMatchObject({ problem: "needed", fields: [roleBox(role.id, "needed")] });
    expect(await boxes({ needed: "x" })).toMatchObject({ problem: "needed" });
    expect(await boxes({ descriptionRoBody: JSON.stringify(roleDescription("Dai apă.", null).descriptionRoJson), descriptionEnBody: JSON.stringify({ type: "doc", content: [] }) })).toMatchObject({
      problem: "description",
      fields: [roleBox(role.id, "descriptionEnBody")],
    });
    expect(await boxes({ colourChoice: "typed", colourTyped: "rosu" })).toMatchObject({ problem: "colour", fields: [roleBox(role.id, "colourTyped")] });
    expect(await boxes({ colourChoice: "typed", colourTyped: "#808080", position: "1" })).toMatchObject({ problem: "colourUnreadable", fields: [roleBox(role.id, "colourTyped")] });
    expect(await boxes({ position: "0" })).toMatchObject({ problem: "position", fields: [roleBox(role.id, "position")] });
    expect(await boxes({ position: "1.5" })).toMatchObject({ problem: "position" });
    expect(await boxes({ categoryId: "7d2c7f1c-0000-4000-8000-000000000000" })).toMatchObject({ problem: "category", fields: [roleBox(role.id, "categoryId")] });
    expect(await boxes({ categoryId: "nu-e-un-id" })).toMatchObject({ problem: "category" });
    // Two refused rows: the first in the form's order is the one named.
    const second = await seed("B", start.id);
    expect(await refusal([row(second.id, { nameRo: "B", nameEn: "", needed: "2" }), row(role.id, { nameRo: "", nameEn: "A EN", needed: "2" })])).toMatchObject({ row: { name: "B" }, problem: "nameEnMissing" });
    expect(await trail()).toHaveLength(0);
  });

  it("keeps the description's plain words when a row posts neither editor box, and takes the editor's two documents when it does", async () => {
    const role = await seed("A", start.id, roleDescription("Dai apă.", "Hand out water."));
    await save([row(role.id, { nameEn: "A bis" })]);
    expect((await listVolunteerRoles(db, eventId))[0]).toMatchObject({ descriptionRo: "Dai apă.", descriptionEn: "Hand out water." });
    await save([row(role.id, { descriptionRoBody: JSON.stringify(roleDescription("Dai apă și fructe.", null).descriptionRoJson), descriptionEnBody: JSON.stringify(roleDescription(null, "Water and fruit.").descriptionEnJson) })]);
    const [changed] = await listVolunteerRoles(db, eventId);
    expect(changed).toMatchObject({ descriptionRo: "Dai apă și fructe.", descriptionEn: "Water and fruit." });
    expect((await trail()).filter((entry) => entry.action === "volunteer_role.edited").at(-1)?.metadataJson).toMatchObject({ fields: ["descriptionRo", "descriptionEn"] });
  });
});

describe("§791 the blank row of a category adds a role", () => {
  it("ignores a blank row — both names empty, whatever else it holds — and creates a role with a name, in its category, last", async () => {
    await seed("A", start.id);
    await seed("T1", route.id);
    await seed("T2", route.id);
    expect(await save([row(null, { nameRo: " ", nameEn: "", needed: "9", position: "1" }, `new-${route.id}`)])).toEqual({ changed: false, edited: 0, created: 0 });
    // The page posts the blank row's own «Categoria» (the card's category, its default); a caller of the service says it the same way.
    const result = await save([row(null, { nameRo: "T3", nameEn: "T3 EN", needed: "3", categoryId: route.id }, `new-${route.id}`)]);
    expect(result).toEqual({ changed: true, edited: 0, created: 1 });
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.map((role) => [role.nameRo, role.categoryId === route.id ? "route" : "start"])).toEqual([["A", "start"], ["T1", "route"], ["T2", "route"], ["T3", "route"]]);
    expect(roles.at(-1)).toMatchObject({ nameEn: "T3 EN", needed: 3, categoryId: route.id, position: 3 });
    const added = (await trail()).filter((entry) => entry.action === "volunteer_role.added");
    expect(added).toHaveLength(1);
    expect(added[0].metadataJson).toMatchObject({ roleId: roles.at(-1)!.id, nameRo: "T3", needed: 3, categoryId: route.id });
    expect(cache.revalidatePublicContent).toHaveBeenCalledTimes(1);
  });

  it("takes the category its own box says over the one in its key, a typed position as the place it asks, and one name alone as a refusal", async () => {
    await seed("A", start.id);
    await seed("B", start.id);
    const result = await save([row(null, { nameRo: "Nou", nameEn: "New", needed: "", unlimited: "on", categoryId: start.id, position: "1" }, `new-${route.id}`)]);
    expect(result.created).toBe(1);
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.map((role) => role.nameRo)).toEqual(["Nou", "A", "B"]);
    expect(roles[0]).toMatchObject({ categoryId: start.id, needed: null });
    const error = await refusal([row(null, { nameRo: "Doar română", nameEn: "", needed: "2", categoryId: route.id }, `new-${route.id}`)]);
    expect(error).toMatchObject({ problem: "nameEnMissing", fields: [roleBox(`new-${route.id}`, "nameEn")], row: { id: null, name: "Doar română", categoryRo: "Traseu" } });
  });

  it("gives the band's colour to a new role through the same rule as a saved one", async () => {
    await save([row(null, { nameRo: "Nou", nameEn: "New", needed: "1", colourChoice: "#1b5e20", colourTyped: "" })]);
    expect((await listVolunteerRoles(db, eventId))[0].colour).toBe("#1b5e20");
  });

  it("takes at most thirty roles on an event, naming the row that would be the thirty-first", async () => {
    for (let index = 0; index < 29; index += 1) await seed(`R${index}`, null);
    expect((await save([row(null, { nameRo: "Al treizecilea", nameEn: "Thirtieth", needed: "1" })])).created).toBe(1);
    const error = await refusal([row(null, { nameRo: "Încă unul", nameEn: "One more", needed: "1" })]);
    expect(error).toMatchObject({ problem: "tooMany", fields: [roleBox("new-none", "nameRo")] });
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(30);
  });
});

describe("§791 «Poziția» orders each category", () => {
  it("moves a role to the place typed — before the role it ties with when it moves up, after it when it moves down — and rewrites the order without gaps", async () => {
    const [a, b, c, d] = [await seed("A", start.id, { position: 10 }), await seed("B", start.id, { position: 20 }), await seed("C", start.id, { position: 30 }), await seed("D", start.id, { position: 40 })];
    // D to the first place: the others keep their order after it.
    await save([row(d.id, { position: "1" })]);
    expect(await names()).toEqual(["D", "A", "B", "C"]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.position)).toEqual([0, 1, 2, 3]);
    // D to the third: it takes the place of the role it ties with, and that one goes before it.
    await save([row(d.id, { position: "3" })]);
    expect(await names()).toEqual(["A", "B", "D", "C"]);
    // Only the roles that typed a new place are audited: the ones that moved along are rewritten silently.
    const edited = (await trail()).filter((entry) => entry.action === "volunteer_role.edited");
    expect(edited).toHaveLength(2);
    expect(edited.map((entry) => entry.metadataJson)).toMatchObject([
      { roleId: d.id, fields: ["position"], positionFrom: 4, positionTo: 1 },
      { roleId: d.id, fields: ["position"], positionFrom: 1, positionTo: 3 },
    ]);
    expect([a.id, b.id, c.id]).toHaveLength(3);
  });

  it("sorts every category by the numbers posted in one save, a role that left its number alone keeping its place, ties by the order it was in", async () => {
    const a = await seed("A", start.id);
    const b = await seed("B", start.id);
    const c = await seed("C", start.id);
    const x = await seed("X", route.id);
    const y = await seed("Y", route.id);
    // The page posts every role's «Poziția» as shown: A 1, B 2, C 3 — and here C asks for 1 and Y for 1.
    const result = await save([
      row(a.id, { position: "1" }),
      row(b.id, { position: "2" }),
      row(c.id, { position: "1" }),
      row(x.id, { position: "1" }),
      row(y.id, { position: "1" }),
    ]);
    expect(result).toEqual({ changed: true, edited: 2, created: 0 });
    expect(await names()).toEqual(["C", "A", "B", "Y", "X"]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("puts a role typed past the end last, and counts a typed place held already as nothing", async () => {
    const a = await seed("A", start.id);
    await seed("B", start.id);
    expect((await save([row(a.id, { position: "99" })])).edited).toBe(1);
    expect(await names()).toEqual(["B", "A"]);
    expect(await save([row(a.id, { position: "99" })])).toEqual({ changed: false, edited: 0, created: 0 });
    expect(await save([row(a.id, { position: "2" })])).toEqual({ changed: false, edited: 0, created: 0 });
  });

  it("closes the gaps a delete left, once something is saved", async () => {
    const a = await seed("A", start.id, { position: 3 });
    await seed("B", start.id, { position: 9 });
    await save([row(a.id, { nameEn: "A bis" })]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.position)).toEqual([0, 1]);
  });
});

describe("§791 «Categoria» moves a role", () => {
  it("moves a role to another category — to the end of it unless a place is typed — and audits the category it left and the one it joined", async () => {
    const a = await seed("A", start.id);
    await seed("B", start.id);
    await seed("T1", route.id);
    await seed("T2", route.id);
    await save([row(a.id, { categoryId: route.id })]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => [role.nameRo, role.categoryId === route.id ? "route" : "start"])).toEqual([["B", "start"], ["T1", "route"], ["T2", "route"], ["A", "route"]]);
    const [entry] = (await trail()).filter((row2) => row2.action === "volunteer_role.edited");
    expect(entry.metadataJson).toMatchObject({ roleId: a.id, fields: ["categoryId"], categoryFrom: start.id, categoryTo: route.id });
    // Back to the first place of the start's, by typing it.
    await save([row(a.id, { categoryId: start.id, position: "1" })]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.nameRo)).toEqual(["A", "B", "T1", "T2"]);
    // To «Alte roluri» (an empty choice): none.
    await save([row(a.id, { categoryId: "" })]);
    expect((await listVolunteerRoles(db, eventId)).find((role) => role.id === a.id)?.categoryId).toBeNull();
    expect((await names()).at(-1)).toBe("A");
  });

  it("refuses a name already under the category the role moves to, in either language and whatever the case, and writes nothing", async () => {
    const a = await seed("Direcționare", start.id, { nameEn: "Guidance" });
    await seed("DIRECȚIONARE", route.id, { nameEn: "Other" });
    expect(await refusal([row(a.id, { categoryId: route.id })])).toMatchObject({ problem: "taken", fields: [roleBox(a.id, "nameRo")], row: { categoryRo: "Traseu" } });
    await db.update(eventVolunteerRoles).set({ nameRo: "Alta" }).where(eq(eventVolunteerRoles.nameRo, "DIRECȚIONARE"));
    await db.update(eventVolunteerRoles).set({ nameEn: "guidance" }).where(eq(eventVolunteerRoles.nameRo, "Alta"));
    expect(await refusal([row(a.id, { categoryId: route.id })])).toMatchObject({ problem: "taken", fields: [roleBox(a.id, "nameEn")] });
    expect((await listVolunteerRoles(db, eventId)).find((role) => role.id === a.id)?.categoryId).toBe(start.id);
  });

  it("swaps the names of two roles in one save — neither is a clash, and the unique index is never met half way", async () => {
    const a = await seed("A", start.id, { nameEn: "AA" });
    const b = await seed("B", start.id, { nameEn: "BB" });
    const result = await save([row(a.id, { nameRo: "B", nameEn: "BB" }), row(b.id, { nameRo: "A", nameEn: "AA" })]);
    expect(result).toEqual({ changed: true, edited: 2, created: 0 });
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.map((role) => [role.id, role.nameRo, role.nameEn])).toEqual([[a.id, "B", "BB"], [b.id, "A", "AA"]]);
  });

  it("is a clash only with a role that stays: two roles may trade categories, and the same name stands in two categories", async () => {
    const a = await seed("Ajutor", start.id, { nameEn: "Help" });
    const b = await seed("Ajutor", route.id, { nameEn: "Help" });
    expect(await save([row(a.id, { categoryId: route.id }), row(b.id, { categoryId: start.id })])).toMatchObject({ changed: true, edited: 2 });
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.find((role) => role.id === a.id)?.categoryId).toBe(route.id);
    expect(roles.find((role) => role.id === b.id)?.categoryId).toBe(start.id);
  });
});

describe("§791 «Nelimitat» and the number", () => {
  it("saves a role without a number when the tick is posted, whatever the number box holds, and a number again when it is not", async () => {
    const a = await seed("A", start.id);
    await save([row(a.id, { needed: "7", unlimited: "on" })]);
    expect((await listVolunteerRoles(db, eventId))[0].needed).toBeNull();
    expect(await save([row(a.id, { needed: "7", unlimited: "on" })])).toEqual({ changed: false, edited: 0, created: 0 });
    await save([row(a.id, { needed: "6", unlimited: "" })]);
    expect((await listVolunteerRoles(db, eventId))[0].needed).toBe(6);
    expect((await trail()).filter((entry) => entry.action === "volunteer_role.edited").map((entry) => entry.metadataJson)).toMatchObject([
      { fields: ["needed"], needed: null },
      { fields: ["needed"], needed: 6 },
    ]);
  });

  it("refuses an empty number box with no tick, at the number's box", async () => {
    const a = await seed("A", start.id);
    expect(await refusal([row(a.id, { needed: "", unlimited: "" })])).toMatchObject({ problem: "needed", fields: [roleBox(a.id, "needed")] });
  });
});

describe("§791 who may save, and what is not this event's", () => {
  it("lets the Organizer and the Administrator, refuses the others on the first call and writes nothing", async () => {
    const a = await seed("A", start.id);
    for (const actor of [staff.DEV!, staff.COPYWRITER!, staff.CONTRIBUTOR!, staff.MEMBER!]) {
      await expect(save([row(a.id, { nameEn: "Hacked" })], actor), actor.role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await listVolunteerRoles(db, eventId))[0].nameEn).toBe("A EN");
    expect(await trail()).toHaveLength(0);
    expect(cache.revalidatePublicContent).not.toHaveBeenCalled();
    expect((await save([row(a.id, { nameEn: "Organizer" })], staff.MODERATOR!)).edited).toBe(1);
    expect((await save([row(a.id, { nameEn: "Administrator" })], admin)).edited).toBe(1);
  });

  it("refuses a role of another event as «gone» (named), a malformed id as «not there», and writes nothing of the rows before it", async () => {
    const mine = await seed("A", start.id);
    const foreign = await seed("F", null, { eventId: otherEventId, position: 0 });
    await expect(save([row(mine.id, { nameEn: "Changed" }), row(foreign.id, { nameRo: "F", nameEn: "Hacked" })])).rejects.toMatchObject({ code: "VOLUNTEER_ROLE_INVALID", problem: "gone" });
    await expect(save([row("not-an-id", { nameEn: "x" })])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeVolunteerRoles(db, admin, { eventId: "nope", rows: [row(mine.id, {})] }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listVolunteerRoles(db, eventId))[0].nameEn).toBe("A EN");
    expect((await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, foreign.id)))[0].nameEn).toBe("F EN");
  });

  it("refuses a save that names one role twice — its change would be audited twice — and writes nothing", async () => {
    const a = await seed("A", start.id);
    await expect(save([row(a.id, { nameEn: "One" }), row(a.id, { nameEn: "Two" }, "again")])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await listVolunteerRoles(db, eventId))[0].nameEn).toBe("A EN");
    expect(await trail()).toHaveLength(0);
  });
});

/** The hidden box the card draws in a saved role's row: the role as the form was drawn, at its place among its category's roles. */
const drawn = (role: typeof eventVolunteerRoles.$inferSelect, rank: number) => encodeRoleBaseline(roleBaselineOf(role, rank));
/** A saved role's row as the form posts it: every box with the value it was drawn with, the baseline, and what the person changes. */
const drawnRow = (role: typeof eventVolunteerRoles.$inferSelect, rank: number, changes: Record<string, unknown> = {}) =>
  row(role.id, {
    nameRo: role.nameRo,
    nameEn: role.nameEn,
    needed: role.needed === null ? "" : String(role.needed),
    unlimited: role.needed === null ? "on" : "",
    categoryId: role.categoryId ?? "",
    position: String(rank),
    was: drawn(role, rank),
    ...changes,
  });

describe("§791 a form opened before another save", () => {
  it("does not write the old values back over a role the person never touched — nor the order another session set", async () => {
    const x = await seed("X", start.id, { needed: 4 });
    const y = await seed("Y", start.id);
    const z = await seed("Z", start.id);
    // The form is drawn: X, Y, Z at 1, 2, 3.
    const drawnX = x;
    const drawnY = y;
    const drawnZ = z;
    // Another session renames X, raises its number and moves it to the end.
    await save([row(x.id, { nameRo: "Bar", nameEn: "Bar EN", needed: "6", position: "3" })]);
    expect(await names()).toEqual(["Y", "Z", "Bar"]);
    cache.revalidatePublicContent.mockClear();
    const audited = (await trail()).length;
    // This form, drawn before, changes only Y's name and posts everything else as it was drawn.
    const result = await save([drawnRow(drawnX, 1), drawnRow(drawnY, 2, { nameEn: "Why" }), drawnRow(drawnZ, 3)]);
    expect(result).toEqual({ changed: true, edited: 1, created: 0 });
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.map((role) => role.nameRo)).toEqual(["Y", "Z", "Bar"]);
    expect(roles.find((role) => role.id === x.id)).toMatchObject({ nameRo: "Bar", nameEn: "Bar EN", needed: 6 });
    expect(roles.find((role) => role.id === y.id)?.nameEn).toBe("Why");
    const entries = (await trail()).slice(audited);
    expect(entries).toHaveLength(1);
    expect(entries[0].metadataJson).toMatchObject({ roleId: y.id, fields: ["nameEn"] });
  });

  it("writes nothing and audits nothing when the form is saved as drawn, however the roles have changed since", async () => {
    const x = await seed("X", start.id);
    await save([row(x.id, { nameEn: "Elsewhere" })]);
    const before = await db.select().from(eventVolunteerRoles);
    const audited = (await trail()).length;
    expect(await save([drawnRow(x, 1)])).toEqual({ changed: false, edited: 0, created: 0 });
    expect(await db.select().from(eventVolunteerRoles)).toEqual(before);
    expect(await trail()).toHaveLength(audited);
  });

  it("refuses a role the person touched when someone else changed it meanwhile — «stale», named, nothing written — and a role deleted meanwhile as «gone»", async () => {
    const x = await seed("X", start.id);
    const y = await seed("Y", start.id);
    await save([row(x.id, { nameEn: "Theirs" })]);
    const refused = await refusal([drawnRow(y, 2, { nameEn: "Mine" }), drawnRow(x, 1, { nameEn: "Mine too" })]);
    expect(refused).toBeInstanceOf(VolunteerRoleRowError);
    expect(refused.code).toBe("VOLUNTEER_ROLE_INVALID");
    expect(refused.problem).toBe("stale");
    expect(refused.row).toMatchObject({ id: x.id, name: "X", categoryRo: "Start / Sosire" });
    expect(refused.fields).toEqual([roleBox(x.id, "nameRo")]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.nameEn)).toEqual(["Theirs", "Y EN"]);
    // The place typed on a role whose place moved meanwhile is stale too.
    await save([row(y.id, { position: "1" })]);
    expect((await refusal([drawnRow(x, 1, { position: "2" })])).problem).toBe("stale");
    // Deleted meanwhile: said by its name.
    await db.delete(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, y.id));
    const gone = await refusal([drawnRow(y, 1, { nameEn: "Late" })]);
    expect(gone.problem).toBe("gone");
    expect(gone.row.name).toBe("Y");
    expect(gone.fields).toEqual([roleBox(y.id, "nameRo")]);
  });

  it("does not let a role left alone collide with a name another session gave a different role", async () => {
    const x = await seed("X", start.id);
    const y = await seed("Y", start.id);
    // Another session renames X «Zed» and Y «X» (a swap that left Y's old name free): this form still carries X as «X» and Y as «Y».
    await save([row(x.id, { nameRo: "Zed", nameEn: "Zed EN" }), row(y.id, { nameRo: "X", nameEn: "X EN" })]);
    const result = await save([drawnRow(x, 1), drawnRow(y, 2)]);
    expect(result).toEqual({ changed: false, edited: 0, created: 0 });
    expect(await names()).toEqual(["Zed", "X"]);
  });

  it("takes a «Poziția» as typed only when it differs from the number the box was drawn with — so a role moved to another category with the box left alone goes last", async () => {
    const a = await seed("A", start.id);
    await seed("B", start.id);
    await seed("T1", route.id);
    await seed("T2", route.id);
    // The box reads 1 (A's place among the start's roles): left alone, the role goes to the end of the route.
    await save([drawnRow(a, 1, { categoryId: route.id })]);
    expect((await listVolunteerRoles(db, eventId)).filter((role) => role.categoryId === route.id).map((role) => role.nameRo)).toEqual(["T1", "T2", "A"]);
    // A number other than the one drawn is the place asked for.
    const [moved] = await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.id, a.id));
    await save([drawnRow(moved, 3, { categoryId: start.id, position: "1" })]);
    expect((await listVolunteerRoles(db, eventId)).filter((role) => role.categoryId === start.id).map((role) => role.nameRo)).toEqual(["A", "B"]);
  });
});
