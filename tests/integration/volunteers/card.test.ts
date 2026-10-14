import { createTranslator } from "next-intl";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { deleteEvent, duplicateEvent } from "@/modules/content/events/service";
import type { OutboxRow } from "@/modules/notifications/outbox";
import { renderOutboxMessage } from "@/modules/notifications/render";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { changeVolunteer, changeVolunteerRole, listVolunteerRoles, listVolunteers, setAcceptsVolunteers, volunteerStandings } from "@/modules/volunteers/volunteers";
import type { FormOutcome } from "@/shared/forms/outcome";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §754 — an event's «Voluntari» card (BR-REQ-050-02, BR-REQ-060-01), through the real Server Actions:
 * the roles defined per event in both languages, ordered, edited and removed; the people entered by hand,
 * changed, confirmed, cancelled and deleted; every change audited with ids and never a name, an address or a
 * telephone number; the role asserted by the service whatever the card drew (the Organizer and the
 * Administrators write, the Tehnic role, the Redactor, a volunteer and a member are refused); a role with
 * people on it cannot be removed; and nothing here belongs to a copy of the event.
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
// The export route asks for its column words in the reader's language.
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

const NOW = new Date("2026-10-13T10:00:00.000Z");

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

/** A posted form; a list is a group of boxes posting one name several times (the roles ticked, §NNN). */
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

/** Runs an action that redirects on success and returns its refusal otherwise. */
async function post(action: Stateful, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

/** A one-button form: it always redirects back to the card, with the refusal's code in the address when it has one. */
async function press(action: (form: FormData) => Promise<void>, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

/** The same for a form that is handed the previous outcome: it redirects whatever it found, a refusal in the address. */
async function pressStateful(action: Stateful, data: FormData): Promise<string> {
  state.redirected.length = 0;
  await action(null, data).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
  return state.redirected.at(-1) ?? "";
}

const ROLE = { nameRo: "Punct de apă", nameEn: "Water point", needed: "4", descriptionRo: "", descriptionEn: "" };
const PERSON = { name: "Maria Test", email: "maria@example.test", phone: "0712 345 678", note: "" };

const trail = (id = eventId) => db.select().from(auditLogs).where(eq(auditLogs.entityId, id)).orderBy(auditLogs.createdAt);
const actionsOf = async () => (await trail()).map((row) => row.action);

async function addRole(fields: Record<string, string> = {}) {
  expect(await post(actions.addVolunteerRoleAction, form({ ...ROLE, ...fields }))).toBe("redirected");
  const roles = await listVolunteerRoles(db, eventId);
  return roles[roles.length - 1];
}

/** A person entered by hand who would do `roleId` and is given it — unless `fields` say otherwise (§NNN). */
async function addPerson(roleId: string, fields: Record<string, string | readonly string[]> = {}) {
  expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [roleId], assignedRoleId: roleId, ...fields }))).toBe("redirected");
  const rows = await listVolunteers(db, eventId);
  return rows[rows.length - 1];
}

describe("§754 an event's volunteer roles", () => {
  it("adds a role with both names, how many it needs and a description in both languages, and audits it", async () => {
    const role = await addRole({ nameRo: "  Punct   de apă ", descriptionRo: "Dai apă", descriptionEn: "Hand out water" });
    expect(role).toMatchObject({ eventId, nameRo: "Punct de apă", nameEn: "Water point", needed: 4, descriptionRo: "Dai apă", descriptionEn: "Hand out water", position: 0 });
    const [row] = await trail();
    expect(row).toMatchObject({ action: "volunteer_role.added", actorStaffUserId: staff.ADMIN!.id, entityType: "event" });
    expect(row.metadataJson).toMatchObject({ roleId: role.id, nameRo: "Punct de apă", needed: 4 });
  });

  it("refuses a role with one name missing, a bad number, or half a description — keeping every box — and writes nothing", async () => {
    for (const [fields, box] of [
      [{ nameEn: "" }, "nameEn"],
      [{ nameRo: " " }, "nameRo"],
      [{ needed: "0" }, "needed"],
      [{ needed: "x" }, "needed"],
      [{ descriptionRo: "Dai apă" }, "descriptionEn"],
    ] as const) {
      const outcome = await post(actions.addVolunteerRoleAction, form({ ...ROLE, ...fields }));
      expect(outcome, box).toMatchObject({ error: "VALIDATION_ERROR", fields: [box] });
      expect((outcome as FormOutcome).values.nameRo?.[0]).toBe(fields.nameRo ?? ROLE.nameRo);
    }
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(0);
    expect(await trail()).toHaveLength(0);
  });

  it("lists the roles in the order they were added, and a role belongs to one event", async () => {
    const first = await addRole();
    const second = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.id)).toEqual([first.id, second.id]);
    expect(await listVolunteerRoles(db, otherEventId)).toHaveLength(0);
  });

  it("changes a role, audits which fields changed, and writes nothing for a save that changes nothing", async () => {
    const role = await addRole();
    expect(await post(actions.editVolunteerRoleAction, form({ ...ROLE, roleId: role.id, needed: "6", nameEn: "Hydration point" }))).toBe("redirected");
    expect(await listVolunteerRoles(db, eventId)).toMatchObject([{ id: role.id, needed: 6, nameEn: "Hydration point", nameRo: "Punct de apă" }]);
    const edited = (await trail()).filter((row) => row.action === "volunteer_role.edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].metadataJson).toMatchObject({ fields: ["nameEn", "needed"] });
    expect(await post(actions.editVolunteerRoleAction, form({ ...ROLE, roleId: role.id, needed: "6", nameEn: "Hydration point" }))).toBe("redirected");
    expect((await trail()).filter((row) => row.action === "volunteer_role.edited")).toHaveLength(1);
  });

  it("moves a role up and down, never past the ends, and renumbers positions without gaps", async () => {
    const a = await addRole({ nameRo: "A", nameEn: "A" });
    const b = await addRole({ nameRo: "B", nameEn: "B" });
    const c = await addRole({ nameRo: "C", nameEn: "C" });
    const order = async () => (await listVolunteerRoles(db, eventId)).map((role) => role.nameRo);
    await press(actions.moveVolunteerRoleAction, form({ roleId: c.id, direction: "up" }));
    expect(await order()).toEqual(["A", "C", "B"]);
    await press(actions.moveVolunteerRoleAction, form({ roleId: a.id, direction: "up" }));
    expect(await order()).toEqual(["A", "C", "B"]);
    await press(actions.moveVolunteerRoleAction, form({ roleId: a.id, direction: "down" }));
    expect(await order()).toEqual(["C", "A", "B"]);
    await press(actions.moveVolunteerRoleAction, form({ roleId: b.id, direction: "down" }));
    expect(await order()).toEqual(["C", "A", "B"]);
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.position)).toEqual([0, 1, 2]);
    expect((await actionsOf()).filter((action) => action === "volunteer_role.moved")).toHaveLength(2);
  });

  it("removes a role nobody is on, but never one with people on it — cancelled ones included — until they are moved or gone", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    const maria = await addPerson(water.id);
    const refusal = await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: water.id }));
    expect(refusal).toContain("volunteerError=VOLUNTEER_ROLE_HAS_PEOPLE");
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(2);
    // A cancelled person still holds the role: the row is kept, and so is the role.
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CANCELLED" }));
    expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: water.id }))).toContain("VOLUNTEER_ROLE_HAS_PEOPLE");
    // Moved to another role, and the role given no longer ticked by them: the role goes.
    expect(await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [finish.id], assignedRoleId: finish.id }))).toBe("redirected");
    expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: water.id }))).not.toContain("volunteerError");
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.id)).toEqual([finish.id]);
    expect(await actionsOf()).toContain("volunteer_role.deleted");
  });

  it("§NNN never removes a role somebody only ticked, given no role yet — their offer names it", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    const dana = await addPerson(water.id, { roleIds: [water.id, finish.id], assignedRoleId: "" });
    expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: finish.id }))).toContain("volunteerError=VOLUNTEER_ROLE_HAS_PEOPLE");
    // Their ticks changed: the role is nobody's any more, and goes.
    expect(await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: dana.id, roleIds: [water.id], assignedRoleId: "" }))).toBe("redirected");
    expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: finish.id }))).not.toContain("volunteerError");
    expect((await listVolunteerRoles(db, eventId)).map((role) => role.id)).toEqual([water.id]);
  });

  it("refuses a role of another event, and a malformed id, as «not there»", async () => {
    const foreign = (await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "A", nameEn: "A", needed: 1 }).returning())[0];
    await expect(changeVolunteerRole(db, staff.ADMIN!, { kind: "edit", eventId, id: foreign.id, fields: ROLE }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeVolunteerRole(db, staff.ADMIN!, { kind: "delete", eventId, id: "not-an-id" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeVolunteerRole(db, staff.ADMIN!, { kind: "add", eventId: "nope", fields: ROLE }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("takes at most thirty roles on an event", async () => {
    for (let index = 0; index < 30; index += 1) await addRole({ nameRo: `Rol ${index}`, nameEn: `Role ${index}` });
    const outcome = await post(actions.addVolunteerRoleAction, form({ ...ROLE, nameRo: "Încă unul", nameEn: "One more" }));
    expect(outcome).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(30);
  });
});

describe("§754 an event's volunteers, entered by hand", () => {
  it("adds a person with the telephone number composed to E.164, «Înscris», from the staff, and audits ids only", async () => {
    const role = await addRole();
    const row = await addPerson(role.id, { note: "Prietena lui Dan" });
    expect(row).toMatchObject({
      eventId,
      roleId: role.id,
      name: "Maria Test",
      email: "maria@example.test",
      phone: "+40712345678",
      state: "REGISTERED",
      source: "STAFF",
      note: "Prietena lui Dan",
      message: null,
    });
    // The identity and who entered it live on the row, not in the list the card draws.
    const [stored] = await db.select().from(eventVolunteers).where(eq(eventVolunteers.id, row.id));
    expect(stored).toMatchObject({ canonicalEmail: "maria@example.test", canonicalizationVersion: 2, createdByStaffUserId: staff.ADMIN!.id, privacyNoticeVersion: null });
    const added = (await trail()).find((entry) => entry.action === "volunteer.added");
    expect(added?.metadataJson).toMatchObject({ volunteerId: row.id, roleId: role.id });
    expect(JSON.stringify(added?.metadataJson)).not.toMatch(/Maria|maria@|\+4071|Prietena/);
  });

  it("takes a number typed with the country code, and refuses one that cannot be dialled", async () => {
    const role = await addRole();
    expect((await addPerson(role.id, { phone: "+44 7911 123456", email: "uk@example.test", name: "Un Britanic" })).phone).toBe("+447911123456");
    const outcome = await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], email: "alt@example.test", phone: "abc" }));
    expect(outcome).toMatchObject({ error: "VALIDATION_ERROR", fields: ["phone"] });
  });

  it("keeps one row per person per event on the canonical address: case, whitespace and a Gmail tag are one person", async () => {
    const role = await addRole();
    await addPerson(role.id, { email: "Ana.Pop+club@Gmail.com" });
    const outcome = await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], email: " ana.pop@gmail.com ", name: "Altă Ană" }));
    expect(outcome).toMatchObject({ error: "VOLUNTEER_ALREADY_LISTED", fields: ["email"] });
    expect(await listVolunteers(db, eventId)).toHaveLength(1);
    // Another event is another list.
    const foreign = (await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "A", nameEn: "A", needed: 1 }).returning())[0];
    await changeVolunteer(db, staff.ADMIN!, { kind: "add", eventId: otherEventId, fields: { roleIds: [foreign.id], name: "Ana Pop", email: "ana.pop@gmail.com", phone: "+40712345678" } }, NOW);
    expect(await listVolunteers(db, otherEventId)).toHaveLength(1);
  });

  it("refuses a role of another event, an unknown role, and nothing ticked with no role given, naming the box", async () => {
    const own = await addRole();
    const foreign = (await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "A", nameEn: "A", needed: 1 }).returning())[0];
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [foreign.id] }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["roleIds"] });
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [own.id, foreign.id] }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["roleIds"] });
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [own.id], assignedRoleId: foreign.id }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["assignedRoleId"] });
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: ["nope"] }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["roleIds"] });
    expect(await post(actions.addVolunteerAction, form({ ...PERSON, assignedRoleId: "" }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["roleIds"] });
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
  });

  it("§NNN enters a person with the roles they would do and no role given, or with a role given alone — kept as their one choice — and tells only a role given", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    const ticked = await addPerson(water.id, { roleIds: [finish.id, water.id], assignedRoleId: "" });
    expect(ticked).toMatchObject({ roleId: null, choiceIds: [water.id, finish.id] });
    const given = await addPerson(finish.id, { roleIds: [], email: "ion@example.test", name: "Ion Test" });
    expect(given).toMatchObject({ roleId: finish.id, choiceIds: [finish.id] });
    const told = await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_ROLE_ASSIGNED"));
    expect(told.map((row) => [row.recipientEmail, row.payloadJson])).toEqual([["ion@example.test", { eventId, volunteerId: given.id, roleId: finish.id }]]);
    const added = (await trail()).filter((row) => row.action === "volunteer.added").map((row) => row.metadataJson);
    expect(added).toEqual([
      { volunteerId: ticked.id, roleId: null, roleIds: [finish.id, water.id] },
      { volunteerId: given.id, roleId: finish.id, roleIds: [finish.id] },
    ]);
  });

  it("changes a person — name, address, telephone, role, note — audits the names of the fields and not their values, and refuses an address already listed", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    const maria = await addPerson(water.id);
    const ion = await addPerson(water.id, { name: "Ion Test", email: "ion@example.test" });
    expect(
      await post(
        actions.editVolunteerAction,
        form({ ...PERSON, volunteerId: maria.id, roleIds: [water.id, finish.id], assignedRoleId: finish.id, name: "Maria Nouă", email: "Maria.Noua@Example.test", note: "Confirmată pe telefon" }),
      ),
    ).toBe("redirected");
    const [changed] = (await listVolunteers(db, eventId)).filter((row) => row.id === maria.id);
    expect(changed).toMatchObject({ roleId: finish.id, choiceIds: [water.id, finish.id], name: "Maria Nouă", email: "Maria.Noua@Example.test", note: "Confirmată pe telefon", phone: "+40712345678" });
    const [edited] = (await trail()).filter((row) => row.action === "volunteer.edited");
    expect(edited.metadataJson).toMatchObject({ volunteerId: maria.id, fields: ["roleId", "name", "email", "note", "roleIds"] });
    expect(JSON.stringify(edited.metadataJson)).not.toMatch(/Maria|maria|Confirmată/);
    // The role newly given is told to the person, at the address the row now holds.
    const toldMaria = async () =>
      (await db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_ROLE_ASSIGNED"))).filter(
        (row) => (row.payloadJson as { volunteerId: string }).volunteerId === maria.id,
      );
    const told = await toldMaria();
    expect(told.map((row) => [row.recipientEmail, (row.payloadJson as { roleId: string }).roleId])).toEqual([
      ["maria@example.test", water.id],
      ["Maria.Noua@Example.test", finish.id],
    ]);
    // Ion's address is taken: refused, naming the box, keeping what was typed.
    const clash = await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [finish.id], assignedRoleId: finish.id, email: ion.email }));
    expect(clash).toMatchObject({ error: "VOLUNTEER_ALREADY_LISTED", fields: ["email"] });
    // Saving the same address spelled differently is no clash with oneself.
    expect(
      await post(
        actions.editVolunteerAction,
        form({ ...PERSON, volunteerId: maria.id, roleIds: [water.id, finish.id], assignedRoleId: finish.id, name: "Maria Nouă", email: "maria.noua@example.test", note: "Confirmată pe telefon" }),
      ),
    ).toBe("redirected");
    // The role taken back: «De repartizat» again, nothing told.
    expect(await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [water.id, finish.id], assignedRoleId: "", name: "Maria Nouă", email: "maria.noua@example.test", note: "Confirmată pe telefon" }))).toBe("redirected");
    expect((await listVolunteers(db, eventId)).find((row) => row.id === maria.id)).toMatchObject({ roleId: null, choiceIds: [water.id, finish.id] });
    expect(await toldMaria()).toHaveLength(2);
  });

  it("confirms, cancels and reopens by the state it is told, audits the change once, and says nothing for a press that changes nothing", async () => {
    const role = await addRole();
    const maria = await addPerson(role.id);
    const stateNow = async () => (await listVolunteers(db, eventId))[0].state;
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CONFIRMED" }));
    expect(await stateNow()).toBe("CONFIRMED");
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CONFIRMED" }));
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CANCELLED" }));
    expect(await stateNow()).toBe("CANCELLED");
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "REGISTERED" }));
    expect(await stateNow()).toBe("REGISTERED");
    const changes = (await trail()).filter((row) => row.action === "volunteer.state_changed").map((row) => row.metadataJson);
    expect(changes).toMatchObject([
      { from: "REGISTERED", to: "CONFIRMED" },
      { from: "CONFIRMED", to: "CANCELLED" },
      { from: "CANCELLED", to: "REGISTERED" },
    ]);
    // A state that is no state is the person's typo, not a database error.
    expect(await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "BANNED" }))).toContain("volunteerError=VALIDATION_ERROR");
  });

  it("deletes a person, with the address and the telephone number, and leaves a trail that names nobody", async () => {
    const role = await addRole();
    const maria = await addPerson(role.id);
    expect(await pressStateful(actions.deleteVolunteerAction, form({ volunteerId: maria.id }))).not.toContain("volunteerError");
    expect(await listVolunteers(db, eventId)).toHaveLength(0);
    const [deleted] = (await trail()).filter((row) => row.action === "volunteer.deleted");
    expect(deleted.metadataJson).toMatchObject({ volunteerId: maria.id, roleId: role.id });
    expect(JSON.stringify(await trail())).not.toMatch(/maria@|\+4071|Maria Test/);
  });

  it("refuses a person of another event as «not there»", async () => {
    const foreignRole = (await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "A", nameEn: "A", needed: 1 }).returning())[0];
    const [foreign] = await db
      .insert(eventVolunteers)
      .values({ eventId: otherEventId, roleId: foreignRole.id, name: "Altcineva", email: "alt@example.test", canonicalEmail: "alt@example.test", canonicalizationVersion: 2, phone: "+40712345678", source: "STAFF" })
      .returning();
    await expect(changeVolunteer(db, staff.ADMIN!, { kind: "delete", eventId, id: foreign.id }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeVolunteer(db, staff.ADMIN!, { kind: "setState", eventId, id: foreign.id, state: "CONFIRMED" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listVolunteers(db, otherEventId)).toHaveLength(1);
  });
});

describe("§NNN «Dă-i rolul …»: the organizers give each volunteer one role", () => {
  const told = () => db.select().from(emailOutbox).where(eq(emailOutbox.messageType, "VOLUNTEER_ROLE_ASSIGNED"));
  const render = async (row: typeof emailOutbox.$inferSelect) =>
    renderOutboxMessage({ ...(row as unknown as OutboxRow), status: "PROCESSING", lockedAt: NOW }, db, NOW);

  beforeEach(async () => {
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "cursa", title: "Cursa" },
      { eventId, locale: "en", slug: "the-race", title: "The race" },
    ]);
  });

  it("gives an offer one of the roles it ticked — counted then, «N din M» — audits it and tells the person in one short email", async () => {
    const water = await addRole({ needed: "2", descriptionRo: "Dai apă la km 5.", descriptionEn: "Hand out water at km 5." });
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish", needed: "1" });
    const maria = await addPerson(water.id, { roleIds: [water.id, finish.id], assignedRoleId: "" });
    expect(volunteerStandings(await listVolunteerRoles(db, eventId), await listVolunteers(db, eventId)).map((standing) => standing.taken)).toEqual([0, 0]);
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }))).not.toContain("volunteerError");
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ roleId: water.id, choiceIds: [water.id, finish.id] });
    // «1 din 2» on the role given; the other role the person ticked still counts nobody.
    expect(volunteerStandings(await listVolunteerRoles(db, eventId), await listVolunteers(db, eventId)).map((standing) => [standing.taken, standing.needed])).toEqual([
      [1, 2],
      [0, 1],
    ]);
    const [assigned] = (await trail()).filter((row) => row.action === "volunteer.assigned");
    expect(assigned).toMatchObject({ actorStaffUserId: staff.ADMIN!.id, entityType: "event", entityId: eventId });
    expect(assigned.metadataJson).toEqual({ volunteerId: maria.id, roleId: water.id, from: null });
    // One email, to the person, in their language, naming the role — no token, nothing to press.
    const [message] = await told();
    expect(message).toMatchObject({ recipientEmail: "maria@example.test", locale: "ro", participantId: null, registrationId: null, requestedByStaffUserId: staff.ADMIN!.id });
    expect(message.payloadJson).toEqual({ eventId, volunteerId: maria.id, roleId: water.id });
    const rendered = await render(message);
    expect(rendered.subject).toBe("Rolul tău de voluntar la Cursa / Your volunteer role at The race");
    expect(rendered.text).toContain("Rol: Punct de apă");
    expect(rendered.text).toContain("Role: Water point");
    expect(rendered.text).toContain("Organizatorii ți-au dat un rol la Cursa: Punct de apă.");
    expect(rendered.text).toContain("Ce presupune rolul: Dai apă la km 5.");
    expect(rendered.text).toContain("What the role involves: Hand out water at km 5.");
    expect(rendered.text).not.toMatch(/token|\/registrations\/|km 5\.\./i);
    // A second press of the same role changes nothing and tells nobody again.
    await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }));
    expect(await told()).toHaveLength(1);
    expect((await trail()).filter((row) => row.action === "volunteer.assigned")).toHaveLength(1);
  });

  it("gives any role of the event — one the person never ticked too — and announces only the role that stands", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    const maria = await addPerson(water.id, { roleIds: [water.id], assignedRoleId: "" });
    await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }));
    await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: finish.id }));
    // The offer stays what the person ticked; the role given is the organizers'.
    expect((await listVolunteers(db, eventId))[0]).toMatchObject({ roleId: finish.id, choiceIds: [water.id] });
    expect((await trail()).filter((row) => row.action === "volunteer.assigned").map((row) => row.metadataJson)).toEqual([
      { volunteerId: maria.id, roleId: water.id, from: null },
      { volunteerId: maria.id, roleId: finish.id, from: water.id },
    ]);
    const [first, second] = await told();
    // The first message would name a role changed since: withdrawn at the send; the second leaves.
    await expect(render(first)).rejects.toThrow(/role was changed/);
    expect((await render(second)).text).toContain("Rol: Sosire");
    // Taken back by hand: the last message is withdrawn too.
    await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [water.id], assignedRoleId: "" }));
    await expect(render(second)).rejects.toThrow(/role was changed/);
  });

  it("refuses a role of another event or no role, a person of another event, and a cancelled person — reopen first", async () => {
    const water = await addRole();
    const maria = await addPerson(water.id, { assignedRoleId: "" });
    const foreign = (await db.insert(eventVolunteerRoles).values({ eventId: otherEventId, nameRo: "A", nameEn: "A", needed: 1 }).returning())[0];
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: foreign.id }))).toContain("volunteerError=VALIDATION_ERROR");
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: "" }))).toContain("volunteerError=VALIDATION_ERROR");
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }, otherEventId))).toContain("volunteerError=");
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CANCELLED" }));
    expect(await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }))).toContain("volunteerError=CONFLICT");
    expect((await listVolunteers(db, eventId))[0].roleId).toBeNull();
    expect(await told()).toHaveLength(0);
    // The service, called directly by a role that may not: refused before anything is read.
    await expect(changeVolunteer(db, staff.DEV!, { kind: "assign", eventId, id: maria.id, roleId: water.id }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("withdraws the role's email when the person was cancelled, or their address corrected, before it left", async () => {
    const water = await addRole();
    const maria = await addPerson(water.id, { assignedRoleId: "" });
    await press(actions.assignVolunteerAction, form({ volunteerId: maria.id, roleId: water.id }));
    const [message] = await told();
    await post(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [water.id], assignedRoleId: water.id, email: "alta@example.test" }));
    await expect(render(message)).rejects.toThrow(/address changed/);
    await press(actions.setVolunteerStateAction, form({ volunteerId: maria.id, state: "CANCELLED" }));
    await expect(render(message)).rejects.toThrow(/cancelled/);
  });
});

describe("§754 «Primește voluntari»", () => {
  it("switches the event's tick on and off through its own form, audits a change and not a repeat, and leaves the event's version alone", async () => {
    const [before] = await db.select().from(events).where(eq(events.id, eventId));
    expect(before.acceptsVolunteers).toBe(false);
    await press(actions.switchVolunteersAction, form({ on: "1" }));
    const [on] = await db.select().from(events).where(eq(events.id, eventId));
    expect(on.acceptsVolunteers).toBe(true);
    expect(on.version).toBe(before.version);
    await press(actions.switchVolunteersAction, form({ on: "1" }));
    await press(actions.switchVolunteersAction, form({ on: "0" }));
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].acceptsVolunteers).toBe(false);
    expect((await trail()).filter((row) => row.action === "event.volunteers_switched").map((row) => row.metadataJson)).toEqual([{ on: true }, { on: false }]);
  });

  it("switching it off keeps every role and every person", async () => {
    const role = await addRole();
    await addPerson(role.id);
    await press(actions.switchVolunteersAction, form({ on: "1" }));
    await press(actions.switchVolunteersAction, form({ on: "0" }));
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(1);
    expect(await listVolunteers(db, eventId)).toHaveLength(1);
  });
});

describe("§754 who may do what (BR-REQ-060-01) — the service asserts it, whatever the card drew", () => {
  it("lets the Organizer, the Administrator and the Superadministrator write", async () => {
    const superadmin = await person("SUPERADMIN", "Sara Superadmin");
    for (const actor of [staff.MODERATOR!, staff.ADMIN!, superadmin]) {
      state.actor = actor;
      const outcome = await post(actions.addVolunteerRoleAction, form({ ...ROLE, nameRo: `Rol ${actor.role}`, nameEn: `Role ${actor.role}` }));
      expect(outcome, actor.role).toBe("redirected");
    }
    expect(await listVolunteerRoles(db, eventId)).toHaveLength(3);
  });

  it("refuses the Tehnic role, the Redactor, a volunteer and a member on every verb, and writes nothing", async () => {
    const role = await addRole();
    const maria = await addPerson(role.id);
    for (const key of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) {
      state.actor = staff[key];
      // An «add» keeps what was typed and says why; an «edit» goes back to the card with the code in the address.
      const refusals = [
        await post(actions.addVolunteerRoleAction, form({ ...ROLE, nameRo: "Alt rol", nameEn: "Other role" })),
        await post(actions.addVolunteerAction, form({ ...PERSON, roleIds: [role.id], email: "alt@example.test" })),
      ];
      for (const refusal of refusals) expect(refusal, key).toMatchObject({ error: "FORBIDDEN" });
      expect(await pressStateful(actions.editVolunteerRoleAction, form({ ...ROLE, roleId: role.id, needed: "9" })), key).toContain("volunteerError=FORBIDDEN");
      expect(await pressStateful(actions.editVolunteerAction, form({ ...PERSON, volunteerId: maria.id, roleIds: [role.id], name: "Schimbat" })), key).toContain("volunteerError=FORBIDDEN");
      for (const [name, action, fields] of [
        ["move", actions.moveVolunteerRoleAction, { roleId: role.id, direction: "down" }],
        ["state", actions.setVolunteerStateAction, { volunteerId: maria.id, state: "CONFIRMED" }],
        // «Dă-i rolul …» (§NNN): the same set of roles may, nobody else.
        ["assign", actions.assignVolunteerAction, { volunteerId: maria.id, roleId: role.id }],
        ["switch", actions.switchVolunteersAction, { on: "1" }],
      ] as const) {
        expect(await press(action, form(fields)), `${key} ${name}`).toContain("volunteerError=FORBIDDEN");
      }
      expect(await pressStateful(actions.deleteVolunteerAction, form({ volunteerId: maria.id })), key).toContain("FORBIDDEN");
      expect(await pressStateful(actions.deleteVolunteerRoleAction, form({ roleId: role.id })), key).toContain("FORBIDDEN");
    }
    expect(await listVolunteerRoles(db, eventId)).toMatchObject([{ needed: 4, nameRo: "Punct de apă" }]);
    expect(await listVolunteers(db, eventId)).toMatchObject([{ name: "Maria Test", state: "REGISTERED" }]);
    expect((await db.select().from(events).where(eq(events.id, eventId)))[0].acceptsVolunteers).toBe(false);
    // The service, called directly: the same refusal, with the role named.
    await expect(setAcceptsVolunteers(db, staff.DEV!, { eventId, on: true }, NOW)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("§754 the CSV", () => {
  async function get(actor: StaffUser, id = eventId, lang = "ro") {
    state.actor = actor;
    return exportRoute.GET(new Request(`https://example.test/api/admin/events/${id}/volunteers?lang=${lang}`), { params: Promise.resolve({ id }) });
  }

  it("downloads the event's volunteers grouped by role in the reader's language, with a BOM, and records that it was taken — without a name", async () => {
    const water = await addRole();
    const finish = await addRole({ nameRo: "Sosire", nameEn: "Finish" });
    await addPerson(finish.id, { name: "Ion Test", email: "ion@example.test" });
    await addPerson(water.id, { name: "=SUM(A1)", email: "maria@example.test" });
    await addPerson(water.id, { roleIds: [finish.id, water.id], assignedRoleId: "", name: "Dana Test", email: "dana@example.test" });
    const response = await get(staff.MODERATOR!);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="voluntari-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // `Response.text()` drops a BOM by the spec, so the bytes are read: EF BB BF first, for Excel on Windows.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text.startsWith("Rolul dat,S-a oferit pentru,Nume,Email,Telefon,Stare,Sursă,Mesaj,Notă,Data")).toBe(true);
    const lines = text.split("\r\n");
    // The offer nobody placed first, with no role given and the roles chosen; then Punct de apă (the club's
    // order), then Sosire; a formula opens as text.
    expect(lines[1].startsWith(',"Punct de apă, Sosire",Dana Test,')).toBe(true);
    expect(lines[2]).toContain("Punct de apă");
    expect(lines[2]).not.toMatch(/,=SUM/);
    expect(lines[3]).toContain("Sosire");
    expect(await actionsOf()).toContain("volunteer.exported");
    const [exported] = (await trail()).filter((row) => row.action === "volunteer.exported");
    expect(exported.metadataJson).toEqual({ rows: 3 });
    // The English reader's words.
    const english = await (await get(staff.ADMIN!, eventId, "en")).text();
    expect(english).toContain("Role given,Offered for,Name,Email,Telephone,State,Source,Message,Note,Date");
    expect(english).toContain('"Water point, Finish"');
  });

  it("refuses the Tehnic role, a volunteer and a member with a 403, a stranger with a 401, and a malformed or unknown event with a 404", async () => {
    for (const key of ["DEV", "COPYWRITER", "CONTRIBUTOR", "MEMBER"] as const) expect((await get(staff[key]!)).status, key).toBe(403);
    expect((await get(staff.ADMIN!, "not-an-id")).status).toBe(404);
    expect((await get(staff.ADMIN!, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect(await actionsOf()).not.toContain("volunteer.exported");
  });
});

describe("§754 a copy of an event is not its volunteers", () => {
  it("copies neither the roles nor the people nor the tick: a copy takes no volunteers until the club says so", async () => {
    const role = await addRole();
    await addPerson(role.id);
    await db.update(events).set({ acceptsVolunteers: true }).where(eq(events.id, eventId));
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "cursa", title: "Cursa" },
      { eventId, locale: "en", slug: "the-race", title: "The race" },
    ]);
    const copyId = (await duplicateEvent(db, { actor: staff.ADMIN!, eventId })).id;
    expect(await listVolunteerRoles(db, copyId)).toHaveLength(0);
    expect(await listVolunteers(db, copyId)).toHaveLength(0);
    expect((await db.select().from(events).where(eq(events.id, copyId)))[0].acceptsVolunteers).toBe(false);
  });
});

describe("§754 deleting an event", () => {
  it("takes its roles and its people with it — the role's RESTRICT never stands in the way of the event's cascade", async () => {
    const role = await addRole();
    await addPerson(role.id);
    await addPerson(role.id, { email: "ion@example.test", name: "Ion Test" });
    await deleteEvent(db, { actor: staff.ADMIN!, eventId });
    expect(await db.select().from(events).where(eq(events.id, eventId))).toEqual([]);
    expect(await db.select().from(eventVolunteerRoles).where(eq(eventVolunteerRoles.eventId, eventId))).toEqual([]);
    expect(await db.select().from(eventVolunteers).where(eq(eventVolunteers.eventId, eventId))).toEqual([]);
  });
});
