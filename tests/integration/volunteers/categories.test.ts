import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventVolunteerCategories, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { groupRolesByCategory } from "@/modules/volunteers/domain/volunteer";
import {
  changeVolunteer,
  changeVolunteerCategory,
  listVolunteerCategories,
  listVolunteerRoles,
  listVolunteers,
  readPublicVolunteerRoles,
  type VolunteerCategoryRequest,
} from "@/modules/volunteers/volunteers";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §774 — an event's volunteer roles in configurable categories, each with a contact person (the owner, 2026-10-14: «categorii cu
 * sub-categorii … Toate astea configurabile», «trebuie să fie o persoană de contact pentru voluntari … stabilită mai târziu»):
 * the table and its per-category uniqueness, the card's category verbs through the real Server Actions (add, rename, reorder, the
 * contact person's own save, delete only while empty), the role's «Categoria», the public read, the CSV — and the role asserted
 * by the service, whatever the card drew (BR-REQ-060-01).
 */
const state = vi.hoisted(() => ({ db: undefined as unknown, actor: undefined as unknown, redirected: [] as string[] }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
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

const actions = await import("@/app/[locale]/admin/events/[id]/volunteer-actions");
const exportRoute = await import("@/app/api/admin/events/[id]/volunteers/route");

const NOW = new Date("2026-10-14T10:00:00.000Z");

let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
let otherEventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
  state.db = db;
});
afterAll(async () => close());

async function person(role: StaffRole, name: string): Promise<StaffUser> {
  const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: name, role }).returning();
  return row;
}

beforeEach(async () => {
  await resetTables(db);
  staff.ADMIN = await person("ADMIN", "Ana Admin");
  staff.MODERATOR = await person("MODERATOR", "Oana Organizator");
  staff.DEV = await person("DEV", "Tudor Tehnic");
  staff.COPYWRITER = await person("COPYWRITER", "Rada Redactor");
  staff.CONTRIBUTOR = await person("CONTRIBUTOR", "Vlad Voluntar");
  staff.MEMBER = await person("MEMBER", "Membru Club");
  const [first, second] = await db
    .insert(events)
    .values([
      { type: "RACE", startsAt: new Date("2026-11-21T08:00:00.000Z") },
      { type: "GROUP_RUN", startsAt: new Date("2026-11-04T16:00:00.000Z") },
    ])
    .returning({ id: events.id });
  eventId = first.id;
  otherEventId = second.id;
  state.actor = staff.ADMIN;
  state.redirected.length = 0;
});

function form(fields: Record<string, string | readonly string[]>, event = eventId): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", event);
  for (const [name, value] of Object.entries(fields)) {
    if (typeof value === "string") data.set(name, value);
    else for (const item of value) data.append(name, item);
  }
  return data;
}

type Stateful = (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>;

async function post(action: Stateful, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

/** A form that redirects whatever it found; the refusal's code is in the address. */
async function pressStateful(action: Stateful, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(null, data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

async function press(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

const START = { nameRo: "Start / Sosire", nameEn: "Start / Finish" };
const ROUTE = { nameRo: "Traseu", nameEn: "Route" };
const GUIDANCE = { nameRo: "Direcționare", nameEn: "Guidance", needed: "2", descriptionRo: "", descriptionEn: "" };

const trail = (id = eventId) => db.select().from(auditLogs).where(eq(auditLogs.entityId, id)).orderBy(auditLogs.createdAt);
const actionsOf = async () => (await trail()).map((row) => row.action);

async function addCategory(fields: Record<string, string> = START, event = eventId) {
  expect(await post(actions.addVolunteerCategoryAction, form(fields, event))).toBe("redirected");
  const all = await listVolunteerCategories(db, event);
  return all[all.length - 1];
}

async function addRole(fields: Record<string, string> = {}, event = eventId) {
  expect(await post(actions.addVolunteerRoleAction, form({ ...GUIDANCE, ...fields }, event))).toBe("redirected");
  const all = await listVolunteerRoles(db, event);
  return all[all.length - 1];
}

describe("§774 the table: categories, and a role's name once per category", () => {
  const category = async (event: string, nameRo: string, nameEn: string, sort = 0) =>
    (await db.insert(eventVolunteerCategories).values({ eventId: event, nameRo, nameEn, sort }).returning())[0];
  const role = (event: string, categoryId: string | null, nameRo: string, nameEn: string) =>
    db.insert(eventVolunteerRoles).values({ eventId: event, categoryId, nameRo, nameEn, needed: 1 }).returning();

  it("keeps every contact column optional and a category's names within their bound", async () => {
    const row = await category(eventId, "Traseu", "Route");
    expect(row).toMatchObject({ contactName: null, contactPhone: null, contactEmail: null, sort: 0 });
    await expect(db.insert(eventVolunteerCategories).values({ eventId, nameRo: "", nameEn: "x" })).rejects.toThrow();
    await expect(db.insert(eventVolunteerCategories).values({ eventId, nameRo: "x".repeat(81), nameEn: "x" })).rejects.toThrow();
    await expect(db.update(eventVolunteerCategories).set({ contactPhone: "0".repeat(41) }).where(eq(eventVolunteerCategories.id, row.id))).rejects.toThrow();
  });

  it("lets the same role name stand in two categories, once in each — and refuses it twice in one, in either language, whatever the case", async () => {
    const start = await category(eventId, "Start / Sosire", "Start / Finish", 0);
    const route = await category(eventId, "Traseu", "Route", 1);
    await role(eventId, start.id, "Direcționare", "Guidance");
    await role(eventId, route.id, "Direcționare", "Guidance");
    await expect(role(eventId, route.id, "direcționare", "Marshal")).rejects.toThrow();
    await expect(role(eventId, route.id, "Altceva", "GUIDANCE")).rejects.toThrow();
    // …and once among the roles under none: the unfiled ones are one group of their own.
    await role(eventId, null, "Direcționare", "Guidance");
    await expect(role(eventId, null, "Direcționare", "Other")).rejects.toThrow();
    // Another event is another list.
    await role(otherEventId, null, "Direcționare", "Guidance");
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(3);
  });

  it("holds a category's name once per event in each language, whatever the case, and once more on another event", async () => {
    await category(eventId, "Traseu", "Route");
    await expect(category(eventId, "TRASEU", "Course")).rejects.toThrow();
    await expect(category(eventId, "Alt traseu", "route")).rejects.toThrow();
    await category(otherEventId, "Traseu", "Route");
  });

  it("refuses a category's delete while a role sits under it, and takes both with the event", async () => {
    const route = await category(eventId, "Traseu", "Route");
    await role(eventId, route.id, "Direcționare", "Guidance");
    await expect(db.delete(eventVolunteerCategories).where(eq(eventVolunteerCategories.id, route.id))).rejects.toThrow();
    // Deleting the event cascades to the roles and the categories in no promised order: it must not refuse itself.
    await db.delete(events).where(eq(events.id, eventId));
    expect(await db.select().from(eventVolunteerCategories).where(eq(eventVolunteerCategories.eventId, eventId))).toHaveLength(0);
    expect(await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId))).toHaveLength(0);
  });
});

describe("§774 «Adaugă o categorie», rename, reorder — through the real Server Actions", () => {
  it("adds a category with both names, in the order added, and audits it", async () => {
    const start = await addCategory({ nameRo: "  Start  / Sosire ", nameEn: "Start / Finish" });
    expect(start).toMatchObject({ eventId, nameRo: "Start / Sosire", nameEn: "Start / Finish", sort: 0, contact: null });
    const route = await addCategory(ROUTE);
    expect(route.sort).toBe(1);
    expect((await listVolunteerCategories(db, eventId)).map((row) => row.id)).toEqual([start.id, route.id]);
    expect(await listVolunteerCategories(db, otherEventId)).toHaveLength(0);
    const [row] = await trail();
    expect(row).toMatchObject({ action: "volunteer_category.added", actorStaffUserId: staff.ADMIN!.id, entityType: "event" });
    expect(row.metadataJson).toEqual({ categoryId: start.id, nameRo: "Start / Sosire", nameEn: "Start / Finish" });
  });

  it("refuses one name missing or too long — keeping every box — and a name already on the event, naming its box", async () => {
    for (const [fields, box] of [
      [{ nameEn: "" }, "nameEn"],
      [{ nameRo: " " }, "nameRo"],
      [{ nameRo: "x".repeat(81) }, "nameRo"],
    ] as const) {
      const outcome = await post(actions.addVolunteerCategoryAction, form({ ...ROUTE, ...fields }));
      expect(outcome, box).toMatchObject({ error: "VALIDATION_ERROR", fields: [box] });
      expect((outcome as FormOutcome).values.nameEn?.[0]).toBe(fields.nameEn ?? ROUTE.nameEn);
    }
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(0);
    await addCategory(ROUTE);
    expect(await post(actions.addVolunteerCategoryAction, form({ nameRo: "TRASEU", nameEn: "Other" }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN", fields: ["nameRo"] });
    expect(await post(actions.addVolunteerCategoryAction, form({ nameRo: "Alt traseu", nameEn: "route" }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN", fields: ["nameEn"] });
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(1);
    // The same name on another event is fine.
    await addCategory(ROUTE, otherEventId);
  });

  it("takes at most twelve categories on one event", async () => {
    for (let index = 1; index <= 12; index += 1) await addCategory({ nameRo: `Categoria ${index}`, nameEn: `Category ${index}` });
    expect(await post(actions.addVolunteerCategoryAction, form({ nameRo: "A treisprezecea", nameEn: "The thirteenth" }))).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(12);
  });

  it("renames a category, audits which fields changed, and writes nothing for a save that changes nothing", async () => {
    const route = await addCategory(ROUTE);
    expect(await post(actions.editVolunteerCategoryAction, form({ categoryId: route.id, nameRo: "Traseul", nameEn: "Route" }))).toBe("redirected");
    expect((await listVolunteerCategories(db, eventId))[0]).toMatchObject({ nameRo: "Traseul", nameEn: "Route" });
    const edited = (await trail()).filter((row) => row.action === "volunteer_category.edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].metadataJson).toMatchObject({ categoryId: route.id, fields: ["nameRo"] });
    await post(actions.editVolunteerCategoryAction, form({ categoryId: route.id, nameRo: "Traseul", nameEn: "Route" }));
    expect((await trail()).filter((row) => row.action === "volunteer_category.edited")).toHaveLength(1);
    // Keeping its own name is no clash; taking another category's is.
    const start = await addCategory(START);
    expect(await post(actions.editVolunteerCategoryAction, form({ categoryId: start.id, nameRo: "Traseul", nameEn: "Start / Finish" }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN", fields: ["nameRo"] });
  });

  it("moves a category up and down, never past the ends, and renumbers without gaps", async () => {
    const a = await addCategory({ nameRo: "A", nameEn: "A" });
    const b = await addCategory({ nameRo: "B", nameEn: "B" });
    const c = await addCategory({ nameRo: "C", nameEn: "C" });
    const order = async () => (await listVolunteerCategories(db, eventId)).map((row) => row.nameRo);
    await press(actions.moveVolunteerCategoryAction, form({ categoryId: c.id, direction: "up" }));
    expect(await order()).toEqual(["A", "C", "B"]);
    await press(actions.moveVolunteerCategoryAction, form({ categoryId: a.id, direction: "up" }));
    expect(await order()).toEqual(["A", "C", "B"]);
    await press(actions.moveVolunteerCategoryAction, form({ categoryId: a.id, direction: "down" }));
    expect(await order()).toEqual(["C", "A", "B"]);
    await press(actions.moveVolunteerCategoryAction, form({ categoryId: b.id, direction: "down" }));
    expect(await order()).toEqual(["C", "A", "B"]);
    expect((await listVolunteerCategories(db, eventId)).map((row) => row.sort)).toEqual([0, 1, 2]);
    expect((await actionsOf()).filter((action) => action === "volunteer_category.moved")).toHaveLength(2);
  });

  it("deletes a category only while no role is under it: refused with its sentence otherwise, and the role stays", async () => {
    const route = await addCategory(ROUTE);
    const guidance = await addRole({ categoryId: route.id });
    expect(await pressStateful(actions.deleteVolunteerCategoryAction, form({ categoryId: route.id }))).toContain("volunteerError=VOLUNTEER_CATEGORY_HAS_ROLES");
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(1);
    expect((await actionsOf()).filter((action) => action === "volunteer_category.deleted")).toHaveLength(0);
    expect(ro.Admin.errors.VOLUNTEER_CATEGORY_HAS_ROLES).toMatch(/roluri/);
    expect(en.Admin.errors.VOLUNTEER_CATEGORY_HAS_ROLES).toMatch(/roles/);
    // Emptied — the role deleted — the category goes, and the trail names it.
    await post(actions.deleteVolunteerRoleAction, form({ roleId: guidance.id }));
    expect(await pressStateful(actions.deleteVolunteerCategoryAction, form({ categoryId: route.id }))).not.toContain("volunteerError");
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(0);
    const [deleted] = (await trail()).filter((row) => row.action === "volunteer_category.deleted");
    expect(deleted.metadataJson).toEqual({ categoryId: route.id, nameRo: "Traseu", nameEn: "Route" });
  });

  it("is the Organizer's and the Administrators' to write: the Tehnic role, the Redactor, a volunteer and a member are refused, whatever the card drew", async () => {
    const route = await addCategory(ROUTE);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[role];
      const requests: VolunteerCategoryRequest[] = [
        { kind: "add", eventId, fields: START },
        { kind: "edit", eventId, id: route.id, fields: ROUTE },
        { kind: "contact", eventId, id: route.id, fields: { contactName: "Ana" } },
        { kind: "move", eventId, id: route.id, direction: "up" },
        { kind: "delete", eventId, id: route.id },
      ];
      for (const request of requests) {
        await expect(changeVolunteerCategory(db, staff[role]!, request, NOW), `${role} ${request.kind}`).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    expect(await listVolunteerCategories(db, eventId)).toHaveLength(1);
    // The Organizer writes.
    await expect(changeVolunteerCategory(db, staff.MODERATOR!, { kind: "add", eventId, fields: START }, NOW)).resolves.toMatchObject({ changed: true });
  });

  it("answers a category that is not there, or is another event's, as not found — a forged id too", async () => {
    const foreign = await addCategory(ROUTE, otherEventId);
    for (const id of [foreign.id, "7d2c7f1c-0000-4000-8000-000000000000", "not-an-id"]) {
      const requests: VolunteerCategoryRequest[] = [
        { kind: "edit", eventId, id, fields: ROUTE },
        { kind: "contact", eventId, id, fields: { contactName: "Ana" } },
        { kind: "move", eventId, id, direction: "up" },
        { kind: "delete", eventId, id },
      ];
      for (const request of requests) {
        await expect(changeVolunteerCategory(db, staff.ADMIN!, request, NOW), `${request.kind} ${id}`).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
    }
    expect(await listVolunteerCategories(db, otherEventId)).toHaveLength(1);
  });
});

describe("§774 «Persoana de contact» of a category: three optional boxes, its own save, audited", () => {
  const contact = (over: Record<string, string> = {}) => ({ contactName: "Ana Popescu", contactPhone: "0712 345 678", contactEmail: "ana@example.test", ...over });

  it("is empty when the category is made, and set later by its own form: the phone read as a Romanian number, the address kept as typed", async () => {
    const route = await addCategory(ROUTE);
    expect(route).toMatchObject({ contact: null, contactName: null, contactPhone: null, contactEmail: null });
    expect(await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact() }))).toBe("redirected");
    const [saved] = await listVolunteerCategories(db, eventId);
    expect(saved).toMatchObject({ contactName: "Ana Popescu", contactPhone: "+40712345678", contactEmail: "ana@example.test" });
    expect(saved.contact).toEqual({ name: "Ana Popescu", phone: "+40712345678", email: "ana@example.test" });
  });

  it("audits the boxes that changed and never their words — a third person's name and number — and writes nothing when nothing changed", async () => {
    const route = await addCategory(ROUTE);
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact() }));
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact() }));
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact({ contactEmail: "" }) }));
    const edits = (await trail()).filter((row) => row.action === "volunteer_category.contact_edited");
    expect(edits.map((row) => row.metadataJson)).toEqual([
      { categoryId: route.id, nameRo: "Traseu", fields: ["contactName", "contactPhone", "contactEmail"] },
      { categoryId: route.id, nameRo: "Traseu", fields: ["contactEmail"] },
    ]);
    const text = JSON.stringify(await trail());
    expect(text).not.toContain("Ana Popescu");
    expect(text).not.toContain("0712");
    expect(text).not.toContain("example.test");
    expect(edits[0]).toMatchObject({ actorStaffUserId: staff.ADMIN!.id, entityType: "event", entityId: eventId });
  });

  it("clears the whole contact when every box is emptied, and refuses an address that is none — naming its box, keeping what was typed", async () => {
    const route = await addCategory(ROUTE);
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact() }));
    const refused = await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact({ contactEmail: "not an address" }) }));
    expect(refused).toMatchObject({ error: "VALIDATION_ERROR", fields: ["contactEmail"] });
    expect((refused as FormOutcome).values.contactName?.[0]).toBe("Ana Popescu");
    expect((await listVolunteerCategories(db, eventId))[0].contactEmail).toBe("ana@example.test");
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, contactName: "", contactPhone: "", contactEmail: "" }));
    expect((await listVolunteerCategories(db, eventId))[0].contact).toBeNull();
  });

  it("is saved on its own: the category's names and its roles are untouched, and a rename leaves the contact as it is", async () => {
    const route = await addCategory(ROUTE);
    const guidance = await addRole({ categoryId: route.id });
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, ...contact() }));
    await post(actions.editVolunteerCategoryAction, form({ categoryId: route.id, nameRo: "Pe traseu", nameEn: "On the route" }));
    const [saved] = await listVolunteerCategories(db, eventId);
    expect(saved).toMatchObject({ nameRo: "Pe traseu", contactName: "Ana Popescu" });
    expect((await listVolunteerRoles(db, eventId))[0]).toMatchObject({ id: guidance.id, categoryId: route.id });
  });
});

describe("§774 a role's «Categoria»", () => {
  it("adds a role under a category — the same name in two — and audits its category", async () => {
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    const first = await addRole({ categoryId: start.id });
    const second = await addRole({ categoryId: route.id });
    expect([first.categoryId, second.categoryId]).toEqual([start.id, route.id]);
    expect([first.nameRo, second.nameRo]).toEqual(["Direcționare", "Direcționare"]);
    const added = (await trail()).filter((row) => row.action === "volunteer_role.added");
    expect(added[1].metadataJson).toMatchObject({ roleId: second.id, categoryId: route.id });
  });

  it("files a role under none when the choice says so or the form draws none — and refuses a category that is not this event's, naming the box", async () => {
    const route = await addCategory(ROUTE);
    expect((await addRole({ categoryId: "" })).categoryId).toBeNull();
    expect((await addRole({ nameRo: "Fără alegere", nameEn: "No choice" })).categoryId).toBeNull();
    const foreign = await addCategory(START, otherEventId);
    for (const categoryId of [foreign.id, "7d2c7f1c-0000-4000-8000-000000000000", "not-an-id"]) {
      const outcome = await post(actions.addVolunteerRoleAction, form({ ...GUIDANCE, nameRo: "Alta", nameEn: "Other", categoryId }));
      expect(outcome, categoryId).toMatchObject({ error: "VALIDATION_ERROR", fields: ["categoryId"] });
    }
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(2);
    expect(route.id).toBeTruthy();
  });

  it("refuses a name twice under one category — in either language, whatever the case — but takes it under another, and under none", async () => {
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    await addRole({ categoryId: route.id });
    expect(await post(actions.addVolunteerRoleAction, form({ ...GUIDANCE, nameRo: "DIRECȚIONARE", nameEn: "Other", categoryId: route.id }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN", fields: ["nameRo"] });
    expect(await post(actions.addVolunteerRoleAction, form({ ...GUIDANCE, nameRo: "Alta", categoryId: route.id }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN", fields: ["nameEn"] });
    await addRole({ categoryId: start.id });
    await addRole({ categoryId: "" });
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(3);
    // A role's own name saved again under its own category is no clash.
    const [first] = await listVolunteerRoles(db, eventId);
    expect(await post(actions.editVolunteerRoleAction, form({ ...GUIDANCE, roleId: first.id, categoryId: route.id, needed: "5" }))).toBe("redirected");
  });

  it("moves a role to another category on «Modifică» — to the end of it — leaves it where it is when the form draws no choice, and refuses a name that clashes there", async () => {
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    const a = await addRole({ nameRo: "A", nameEn: "A", categoryId: start.id });
    const b = await addRole({ nameRo: "B", nameEn: "B", categoryId: route.id });
    const c = await addRole({ nameRo: "C", nameEn: "C", categoryId: start.id });
    // A saved by a form with no «Categoria» box (a caller before the categories): the role stays.
    await post(actions.editVolunteerRoleAction, form({ ...GUIDANCE, roleId: a.id, nameRo: "A", nameEn: "A", needed: "3" }));
    expect((await listVolunteerRoles(db, eventId)).find((role) => role.id === a.id)).toMatchObject({ categoryId: start.id, needed: 3 });
    await post(actions.editVolunteerRoleAction, form({ ...GUIDANCE, roleId: a.id, nameRo: "A", nameEn: "A", needed: "3", categoryId: route.id }));
    const roles = await listVolunteerRoles(db, eventId);
    expect(roles.find((role) => role.id === a.id)).toMatchObject({ categoryId: route.id });
    const grouped = groupRolesByCategory(await listVolunteerCategories(db, eventId), roles);
    // No group for the roles under none while there are none: the headings are the categories'.
    expect(grouped.map((group) => group.roles.map((role) => role.nameRo))).toEqual([["C"], ["B", "A"]]);
    const edited = (await trail()).filter((row) => row.action === "volunteer_role.edited").at(-1)!;
    expect(edited.metadataJson).toMatchObject({ roleId: a.id, fields: ["categoryId"], categoryFrom: start.id, categoryTo: route.id });
    // «B» under the route already: «B» from the start cannot join it.
    const clash = await addRole({ nameRo: "B", nameEn: "B2", categoryId: start.id });
    expect(await post(actions.editVolunteerRoleAction, form({ ...GUIDANCE, roleId: clash.id, nameRo: "B", nameEn: "B2", categoryId: route.id }))).toMatchObject({ error: "VOLUNTEER_NAME_TAKEN" });
    expect(b.id && c.id).toBeTruthy();
  });

  it("moves a role up and down inside its own category only, the others' places untouched", async () => {
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    const r1 = await addRole({ nameRo: "R1", nameEn: "R1", categoryId: route.id });
    const s1 = await addRole({ nameRo: "S1", nameEn: "S1", categoryId: start.id });
    const r2 = await addRole({ nameRo: "R2", nameEn: "R2", categoryId: route.id });
    const s2 = await addRole({ nameRo: "S2", nameEn: "S2", categoryId: start.id });
    const grouped = async () => groupRolesByCategory(await listVolunteerCategories(db, eventId), await listVolunteerRoles(db, eventId)).map((group) => group.roles.map((role) => role.nameRo));
    expect(await grouped()).toEqual([["S1", "S2"], ["R1", "R2"]]);
    await press(actions.moveVolunteerRoleAction, form({ roleId: r2.id, direction: "up" }));
    expect(await grouped()).toEqual([["S1", "S2"], ["R2", "R1"]]);
    // «Up» of the first role of a category is nothing, though other roles are above it in the event's order.
    await press(actions.moveVolunteerRoleAction, form({ roleId: s1.id, direction: "up" }));
    await press(actions.moveVolunteerRoleAction, form({ roleId: r2.id, direction: "up" }));
    expect(await grouped()).toEqual([["S1", "S2"], ["R2", "R1"]]);
    await press(actions.moveVolunteerRoleAction, form({ roleId: s1.id, direction: "down" }));
    expect(await grouped()).toEqual([["S2", "S1"], ["R2", "R1"]]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.position)).toEqual([0, 1, 2, 3]);
    expect(r1.id && s2.id).toBeTruthy();
  });
});

describe("§774 the public read: the headings, their roles and the contact person", () => {
  it("hands the page the categories in the club's order with each one's contact, and each role's category", async () => {
    await db.update(events).set({ acceptsVolunteers: true }).where(eq(events.id, eventId));
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, contactName: "Ana Popescu", contactPhone: "0712 345 678", contactEmail: "" }));
    const guidance = await addRole({ categoryId: route.id });
    const read = await readPublicVolunteerRoles(db, eventId);
    expect(read.categories).toEqual([
      { id: start.id, nameRo: "Start / Sosire", nameEn: "Start / Finish", contact: null },
      { id: route.id, nameRo: "Traseu", nameEn: "Route", contact: { name: "Ana Popescu", phone: "+40712345678", email: null } },
    ]);
    expect(read.roles).toMatchObject([{ id: guidance.id, categoryId: route.id, free: 2 }]);
    // The groups the page draws: the heading with no role to tick is not among them.
    expect(groupRolesByCategory(read.categories, read.roles, { withRoles: true }).map((group) => group.category?.nameRo)).toEqual(["Traseu"]);
  });

  it("says nothing of the categories while the event takes no volunteers", async () => {
    await addCategory(ROUTE);
    expect(await readPublicVolunteerRoles(db, eventId)).toEqual({ acceptsVolunteers: false, shirts: false, showCounts: false, roles: [], categories: [] });
  });

  it("drops a role that is full from its heading, and with it a heading with no other role", async () => {
    await db.update(events).set({ acceptsVolunteers: true }).where(eq(events.id, eventId));
    const route = await addCategory(ROUTE);
    const start = await addCategory(START);
    const guidance = await addRole({ categoryId: route.id, needed: "1" });
    await addRole({ nameRo: "Foto/Video", nameEn: "Photo/Video", categoryId: start.id, needed: "2" });
    await changeVolunteer(
      db,
      staff.ADMIN!,
      { kind: "add", eventId, fields: { roleIds: [guidance.id], assignedRoleId: guidance.id, name: "Maria", email: "maria@example.test", phone: "+40712345678", note: "" } },
      NOW,
    );
    const read = await readPublicVolunteerRoles(db, eventId);
    const open = read.roles.filter((role) => role.free > 0);
    expect(groupRolesByCategory(read.categories, open, { withRoles: true }).map((group) => group.category?.nameRo)).toEqual(["Start / Sosire"]);
  });
});

describe("§774 the CSV: a role named alone says its category, the contact person is never in it", () => {
  async function get(actor: StaffUser, lang = "ro") {
    state.actor = actor;
    return exportRoute.GET(new Request(`https://example.test/api/admin/events/${eventId}/volunteers?lang=${lang}`), { params: Promise.resolve({ id: eventId }) });
  }

  it("names the role given and the roles offered for as «Direcționare (Traseu)» in each language, in the category order — and holds no word of the contact", async () => {
    const start = await addCategory(START);
    const route = await addCategory(ROUTE);
    await post(actions.saveVolunteerCategoryContactAction, form({ categoryId: route.id, contactName: "Ana Popescu", contactPhone: "0712 345 678", contactEmail: "coordonator@club.test" }));
    const onRoute = await addRole({ categoryId: route.id });
    const atStart = await addRole({ categoryId: start.id });
    const loose = await addRole({ nameRo: "Foto/Video", nameEn: "Photo/Video", categoryId: "" });
    await changeVolunteer(db, staff.ADMIN!, { kind: "add", eventId, fields: { roleIds: [onRoute.id, loose.id], assignedRoleId: onRoute.id, name: "Ion Test", email: "ion@example.test", phone: "+40712000111", note: "" } }, NOW);
    await changeVolunteer(db, staff.ADMIN!, { kind: "add", eventId, fields: { roleIds: [atStart.id], assignedRoleId: atStart.id, name: "Dana Test", email: "dana@example.test", phone: "+40712000222", note: "" } }, NOW);
    const csv = await (await get(staff.MODERATOR!)).text();
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    // Grouped by the role given in the category order: the start's first, then the route's.
    expect(lines[1]).toContain("Direcționare (Start / Sosire)");
    expect(lines[1]).toContain("Dana Test");
    expect(lines[2]).toContain("Direcționare (Traseu),\"Direcționare (Traseu), Foto/Video\"");
    expect(csv).not.toMatch(/Ana Popescu|coordonator@club\.test|0712 345|\+40712345678/);
    const english = await (await get(staff.ADMIN!, "en")).text();
    expect(english).toContain("Guidance (Route)");
    expect(english).toContain("Guidance (Start / Finish)");
    expect(english).not.toMatch(/Ana Popescu|coordonator@club\.test/);
  });

  it("is unchanged for an event with no category: the role's name alone", async () => {
    const role = await addRole();
    await changeVolunteer(db, staff.ADMIN!, { kind: "add", eventId, fields: { roleIds: [role.id], assignedRoleId: role.id, name: "Ion Test", email: "ion@example.test", phone: "+40712000111", note: "" } }, NOW);
    const csv = await (await get(staff.ADMIN!)).text();
    expect(csv).toContain("Direcționare,Direcționare");
    expect(csv).not.toContain("Direcționare (");
  });
});

describe("§774 what an event's volunteers see of a category stays with their event", () => {
  it("lists the people under their role whatever its category, and a category delete never takes a volunteer", async () => {
    const route = await addCategory(ROUTE);
    const guidance = await addRole({ categoryId: route.id });
    await changeVolunteer(db, staff.ADMIN!, { kind: "add", eventId, fields: { roleIds: [guidance.id], assignedRoleId: guidance.id, name: "Ion Test", email: "ion@example.test", phone: "+40712000111", note: "" } }, NOW);
    expect(await pressStateful(actions.deleteVolunteerCategoryAction, form({ categoryId: route.id }))).toContain("VOLUNTEER_CATEGORY_HAS_ROLES");
    expect(await listVolunteers(db, eventId)).toHaveLength(1);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId))).toHaveLength(1);
    // A role's delete is still refused with a person on it, whatever its category.
    expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: guidance.id }))).toContain("VOLUNTEER_ROLE_HAS_PEOPLE");
    expect(await actionsOf()).not.toContain("volunteer_category.deleted");
  });
});
