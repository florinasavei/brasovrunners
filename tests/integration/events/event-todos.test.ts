import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTodos } from "@/db/schema/event-todos";
import { eventTranslations, events } from "@/db/schema/events";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { duplicateEvent } from "@/modules/content/events/service";
import { countOpenEventTodos, listEventTodos } from "@/modules/event-todos/event-todos";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import type { FormOutcome } from "@/shared/forms/outcome";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * §NNN — an event's own to-dos (BR-REQ-050-01, BR-REQ-060-01), through the real Server Actions:
 * add with a priority, change it, assign, tick and untick, delete; every change that changes
 * something audited with who and the words; the role asserted by the service whatever the card
 * drew (the Administrator and the Organizer write, the Tehnic is refused); a to-do belongs to one
 * date. The session and navigation stand-ins are `event-cover.test.ts`'s.
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
vi.mock("@/modules/staff-identity/session", () => ({
  DEV_STAFF_COOKIE: "dev-staff",
  requireStaff: async () => state.actor,
  requireStaffCapability: async () => state.actor,
}));

const { addEventTodoAction, deleteEventTodoAction, editEventTodoAction, setEventTodoDoneAction } = await import("@/app/[locale]/admin/events/[id]/todo-actions");

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

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  data.set("uiLocale", "ro");
  data.set("eventId", eventId);
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Runs an action that redirects on success and returns its refusal otherwise. */
async function post(action: (previous: FormOutcome | null, form: FormData) => Promise<FormOutcome | null>, data: FormData) {
  return action(null, data).catch((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return "redirected" as const;
    throw error;
  });
}

async function tick(itemId: string, done: boolean) {
  await setEventTodoDoneAction(form({ itemId, done: done ? "1" : "0" })).catch((error: unknown) => {
    if (!(error instanceof Error && error.message === "NEXT_REDIRECT")) throw error;
  });
}

const trail = () => db.select().from(auditLogs).where(eq(auditLogs.entityId, eventId)).orderBy(auditLogs.createdAt);
const actions = async () => (await trail()).map((row) => row.action);

async function addOne(fields: Record<string, string> = {}) {
  expect(await post(addEventTodoAction, form({ text: "Pune harta Strava", priority: "NORMAL", assignee: "", due: "", ...fields }))).toBe("redirected");
  const items = await listEventTodos(db, eventId);
  return items[items.length - 1];
}

describe("§NNN an event's own to-dos", () => {
  it("adds a line with its priority, who takes it and the day, and audits it", async () => {
    const item = await addOne({ text: "  Confirmă   barierele  ", priority: "URGENT", assignee: staff.MODERATOR!.id, due: "2026-11-10" });
    expect(item).toMatchObject({
      text: "Confirmă barierele",
      priority: "URGENT",
      assigneeStaffUserId: staff.MODERATOR!.id,
      assigneeName: "Oana Organizator",
      dueOn: "2026-11-10",
      doneAt: null,
    });
    expect(state.redirected[0]).toContain("#box-todos");
    const [row] = await trail();
    expect(row).toMatchObject({ action: "event_todo.added", entityType: "event", actorStaffUserId: staff.ADMIN!.id });
    expect(row.metadataJson).toMatchObject({ itemId: item.id, text: "Confirmă barierele", priority: "URGENT" });
  });

  it("makes the priority «Normală» when none is posted and refuses an empty line, keeping what was typed", async () => {
    const item = await addOne({ priority: "" });
    expect(item.priority).toBe("NORMAL");
    const refusal = await post(addEventTodoAction, form({ text: "   ", priority: "HIGH", assignee: "", due: "" }));
    expect(refusal).toMatchObject({ error: "VALIDATION_ERROR", fields: expect.arrayContaining(["text"]) });
    expect((await listEventTodos(db, eventId)).length).toBe(1);
  });

  it("refuses a line over 200 characters, a day that does not exist and a person who has no backoffice account", async () => {
    expect(await post(addEventTodoAction, form({ text: "x".repeat(201) }))).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(await post(addEventTodoAction, form({ text: "ok", due: "2026-02-30" }))).toMatchObject({ error: "VALIDATION_ERROR", fields: expect.arrayContaining(["due"]) });
    // A member of the club's zone has no screen to read the line on.
    expect(await post(addEventTodoAction, form({ text: "ok", assignee: staff.MEMBER!.id }))).toMatchObject({ error: "VALIDATION_ERROR", fields: ["assignee"] });
    expect(await post(addEventTodoAction, form({ text: "ok", assignee: "7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e" }))).toMatchObject({ error: "VALIDATION_ERROR" });
    expect(await listEventTodos(db, eventId)).toEqual([]);
  });

  it("changes the words, the priority, who and the day in one save, audited as from and to; an unchanged save records nothing", async () => {
    const item = await addOne();
    await post(editEventTodoAction, form({ itemId: item.id, text: "Pune harta Garmin", priority: "HIGH", assignee: staff.ADMIN!.id, due: "2026-11-15" }));
    const [after] = await listEventTodos(db, eventId);
    expect(after).toMatchObject({ text: "Pune harta Garmin", priority: "HIGH", assigneeName: "Ana Admin", dueOn: "2026-11-15" });
    const edited = (await trail()).filter((row) => row.action === "event_todo.edited");
    expect(edited).toHaveLength(1);
    expect(edited[0].metadataJson).toMatchObject({
      from: { text: "Pune harta Strava", priority: "NORMAL", assignee: null, due: null },
      to: { text: "Pune harta Garmin", priority: "HIGH", assignee: staff.ADMIN!.id, due: "2026-11-15" },
    });

    await post(editEventTodoAction, form({ itemId: item.id, text: "Pune harta Garmin", priority: "HIGH", assignee: staff.ADMIN!.id, due: "2026-11-15" }));
    expect((await actions()).filter((action) => action === "event_todo.edited")).toHaveLength(1);

    // Taking the person and the day off is a change too.
    await post(editEventTodoAction, form({ itemId: item.id, text: "Pune harta Garmin", priority: "LOW", assignee: "", due: "" }));
    expect((await listEventTodos(db, eventId))[0]).toMatchObject({ priority: "LOW", assigneeStaffUserId: null, dueOn: null });
  });

  it("ticks and unticks, naming who and when, and a second tick on a ticked line records nothing", async () => {
    const item = await addOne();
    state.actor = staff.MODERATOR;
    await tick(item.id, true);
    const [ticked] = await listEventTodos(db, eventId);
    expect(ticked.doneAt).toBeInstanceOf(Date);
    expect(ticked.doneByName).toBe("Oana Organizator");
    expect(await countOpenEventTodos(db, [eventId])).toEqual(new Map());

    await tick(item.id, true);
    await tick(item.id, false);
    const [reopened] = await listEventTodos(db, eventId);
    expect(reopened).toMatchObject({ doneAt: null, doneByName: null });
    expect(await countOpenEventTodos(db, [eventId, otherEventId])).toEqual(new Map([[eventId, 1]]));
    expect(await actions()).toEqual(["event_todo.added", "event_todo.done", "event_todo.reopened"]);
  });

  it("deletes a line and keeps its words in the trail", async () => {
    const item = await addOne({ text: "Scrie programul" });
    await post(deleteEventTodoAction, form({ itemId: item.id }));
    expect(await listEventTodos(db, eventId)).toEqual([]);
    const deleted = (await trail()).find((row) => row.action === "event_todo.deleted");
    expect(deleted?.metadataJson).toMatchObject({ itemId: item.id, text: "Scrie programul" });
  });

  it("lets the Administrator and the Organizer write, and refuses the Tehnic, the Redactor and the volunteer in the service", async () => {
    for (const role of ["ADMIN", "MODERATOR"] as const) {
      state.actor = staff[role];
      await addOne({ text: `Rând de la ${role}` });
    }
    expect(await listEventTodos(db, eventId)).toHaveLength(2);

    const [mine] = await listEventTodos(db, eventId);
    for (const role of ["DEV", "COPYWRITER", "CONTRIBUTOR"] as const) {
      state.actor = staff[role] ?? (await person(role, `Nume ${role}`));
      expect(await post(addEventTodoAction, form({ text: "nu se poate" }))).toMatchObject({ error: "FORBIDDEN" });
      expect(await post(editEventTodoAction, form({ itemId: mine.id, text: "schimbat" }))).toBe("redirected");
      expect(await post(deleteEventTodoAction, form({ itemId: mine.id }))).toBe("redirected");
      await tick(mine.id, true);
    }
    // The three one-button forms redirect back with the refusal's code, and changed nothing.
    expect(state.redirected.filter((url) => url.includes("todoError=FORBIDDEN"))).toHaveLength(9);
    const after = await listEventTodos(db, eventId);
    expect(after).toHaveLength(2);
    expect(after.every((item) => item.doneAt === null && item.text.startsWith("Rând de la"))).toBe(true);
    expect(await actions()).toEqual(["event_todo.added", "event_todo.added"]);
  });

  it("belongs to one date: a line of another event is not found, and a duplicate starts with none", async () => {
    const item = await addOne();
    // The same id posted against another event's page finds nothing.
    const wrong = new FormData();
    wrong.set("uiLocale", "ro");
    wrong.set("eventId", otherEventId);
    wrong.set("itemId", item.id);
    await expect(deleteEventTodoAction(null, wrong)).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected.at(-1)).toContain("todoError=NOT_FOUND");
    expect(await db.select().from(eventTodos).where(eq(eventTodos.id, item.id))).toHaveLength(1);
    expect(await listEventTodos(db, otherEventId)).toEqual([]);

    // A duplicate is another date: it starts with an empty list, the source keeps its line.
    await db.insert(eventTranslations).values([
      { eventId, locale: "ro", slug: "cursa", title: "Cursa" },
      { eventId, locale: "en", slug: "the-race", title: "The race" },
    ]);
    const copy = await duplicateEvent(db, { actor: staff.ADMIN as StaffUser, eventId });
    expect(await listEventTodos(db, copy.id)).toEqual([]);
    expect(await listEventTodos(db, eventId)).toHaveLength(1);
  });

  it("goes with its event: deleting the event deletes its lines and nothing else", async () => {
    await addOne();
    await db.delete(events).where(and(eq(events.id, eventId)));
    expect(await db.select().from(eventTodos)).toEqual([]);
    expect(await db.select().from(staffUsers)).not.toEqual([]);
  });
});
