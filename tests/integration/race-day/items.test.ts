import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { eventRaceDayItems } from "@/db/schema/race-day-items";
import { staffUsers, type StaffUser } from "@/db/schema/staff-users";
import { changeRaceDayItem, listRaceDayItems, RACE_DAY_ITEMS_MAX } from "@/modules/race-day/items";
import { STAFF_ROLES, type StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";
import { createRace } from "../../helpers/results";

/**
 * §NNN — «Lucruri de adus», the service (BR-REQ-060-01, BR-REQ-037-08): whoever works the desk reads and ticks; the Organizer
 * and the Administrators add, change and delete; a tick posts the state it wants and stamps who and when; at most
 * `RACE_DAY_ITEMS_MAX` things; one audit row a change, the item's id alone; the rows go with their event.
 */
let db: TestDatabase;
let close: () => Promise<void>;
let eventId: string;
const staff: Partial<Record<StaffRole, StaffUser>> = {};
const NOW = new Date("2026-11-21T06:30:00.000Z");

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());

beforeEach(async () => {
  await resetTables(db);
  for (const role of STAFF_ROLES) {
    const [row] = await db.insert(staffUsers).values({ email: `${role.toLowerCase()}@example.test`, displayName: `Ana ${role}`, role }).returning();
    staff[role] = row;
  }
  eventId = (await createRace(db)).id;
});

const add = (role: StaffRole, label = "Prelungitoare", note = "") => changeRaceDayItem(db, staff[role]!, { kind: "add", eventId, label, note }, NOW);
const tick = (role: StaffRole, id: string, brought: boolean, at = NOW) => changeRaceDayItem(db, staff[role]!, { kind: "setBrought", eventId, id, brought }, at);
const trail = async () =>
  (await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, eventId), like(auditLogs.action, "event.race_day_item_%")))).map((row) => ({
    action: row.action,
    metadata: row.metadataJson,
  }));

describe("§NNN the gates, for every role", () => {
  const DESK = new Set<StaffRole>(["CONTRIBUTOR", "COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"]);
  const WRITERS = new Set<StaffRole>(["MODERATOR", "ADMIN", "SUPERADMIN"]);

  for (const role of STAFF_ROLES) {
    it(`${role}: ${WRITERS.has(role) ? "reads, ticks and writes" : DESK.has(role) ? "reads and ticks, never writes" : "neither reads nor ticks"}`, async () => {
      const { item } = await add("ADMIN", "Markere");
      if (DESK.has(role)) {
        expect((await listRaceDayItems(db, staff[role]!, eventId)).map((row) => row.label)).toEqual(["Markere"]);
      } else {
        await expect(listRaceDayItems(db, staff[role]!, eventId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      if (DESK.has(role)) {
        expect((await tick(role, item.id, true)).changed).toBe(true);
      } else {
        await expect(tick(role, item.id, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const writes = [
        () => add(role, "Bandă"),
        () => changeRaceDayItem(db, staff[role]!, { kind: "edit", eventId, id: item.id, label: "Markere negre", note: "" }, NOW),
        () => changeRaceDayItem(db, staff[role]!, { kind: "remove", eventId, id: item.id }, NOW),
      ];
      for (const write of writes) {
        if (WRITERS.has(role)) await expect(write()).resolves.toMatchObject({ changed: true });
        else await expect(write()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });
  }
});

describe("§NNN the list and its words", () => {
  it("appends in order, trims the words, keeps an empty note as none, and refuses words out of bounds by their box", async () => {
    await add("MODERATOR", "  Prelungitoare ", " 3 bucăți ");
    await add("MODERATOR", "Markere");
    const list = await listRaceDayItems(db, staff.CONTRIBUTOR!, eventId);
    expect(list.map((row) => [row.label, row.note, row.position])).toEqual([
      ["Prelungitoare", "3 bucăți", 1],
      ["Markere", null, 2],
    ]);
    await expect(add("MODERATOR", "   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["label"] });
    await expect(add("MODERATOR", "x".repeat(121))).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["label"] });
    await expect(add("MODERATOR", "Bandă", "y".repeat(201))).rejects.toMatchObject({ code: "VALIDATION_ERROR", fields: ["note"] });
    expect(await listRaceDayItems(db, staff.CONTRIBUTOR!, eventId)).toHaveLength(2);
  });

  it("refuses a thing of another event, a malformed id and an event that is not there as NOT_FOUND", async () => {
    const other = (await createRace(db)).id;
    const { item } = await changeRaceDayItem(db, staff.ADMIN!, { kind: "add", eventId: other, label: "Masă", note: "" }, NOW);
    await expect(tick("ADMIN", item.id, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(tick("ADMIN", "not-a-uuid", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(changeRaceDayItem(db, staff.ADMIN!, { kind: "add", eventId: "00000000-0000-4000-8000-000000000000", label: "Masă", note: "" }, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it(`holds at most ${RACE_DAY_ITEMS_MAX} things: the next is RACE_DAY_ITEMS_FULL`, async () => {
    await db.insert(eventRaceDayItems).values(Array.from({ length: RACE_DAY_ITEMS_MAX }, (_, index) => ({ eventId, label: `Lucru ${index + 1}`, position: index + 1 })));
    await expect(add("ADMIN", "Încă unul")).rejects.toMatchObject({ code: "RACE_DAY_ITEMS_FULL" });
    expect(await db.$count(eventRaceDayItems, eq(eventRaceDayItems.eventId, eventId))).toBe(RACE_DAY_ITEMS_MAX);
  });
});

describe("§NNN the tick", () => {
  it("posts the state it wants: ticked stamps who and when, a second tick saves the same and writes nothing, unticked clears both", async () => {
    const { item } = await add("MODERATOR");
    expect((await tick("CONTRIBUTOR", item.id, true)).changed).toBe(true);
    let [row] = await listRaceDayItems(db, staff.ADMIN!, eventId);
    expect(row).toMatchObject({ brought: true, broughtByName: "Ana CONTRIBUTOR" });
    expect(row.broughtAt?.toISOString()).toBe(NOW.toISOString());

    // A double press, later, by somebody else: the same state, nothing written, the first stamp kept.
    expect((await tick("ADMIN", item.id, true, new Date("2026-11-21T07:00:00.000Z"))).changed).toBe(false);
    [row] = await listRaceDayItems(db, staff.ADMIN!, eventId);
    expect(row).toMatchObject({ brought: true, broughtByName: "Ana CONTRIBUTOR" });

    expect((await tick("DEV", item.id, false)).changed).toBe(true);
    const [stored] = await db.select().from(eventRaceDayItems).where(eq(eventRaceDayItems.id, item.id));
    expect(stored).toMatchObject({ brought: false, broughtAt: null, broughtByStaffUserId: null });
    expect((await tick("DEV", item.id, false)).changed).toBe(false);
  });

  it("names nobody once the account that ticked is gone", async () => {
    const { item } = await add("MODERATOR");
    await tick("CONTRIBUTOR", item.id, true);
    await db.delete(staffUsers).where(eq(staffUsers.id, staff.CONTRIBUTOR!.id));
    const [row] = await listRaceDayItems(db, staff.ADMIN!, eventId);
    expect(row).toMatchObject({ brought: true, broughtByName: null });
  });
});

describe("§NNN the trail, and the event", () => {
  it("writes one audit row a change, the item's id alone — and none for a press that changed nothing", async () => {
    const { item } = await add("MODERATOR", "Prelungitoare", "le aduce Ana");
    await changeRaceDayItem(db, staff.ADMIN!, { kind: "edit", eventId, id: item.id, label: "Prelungitoare", note: "le aduce Ana" }, NOW);
    await changeRaceDayItem(db, staff.ADMIN!, { kind: "edit", eventId, id: item.id, label: "Prelungitoare 10 m", note: "le aduce Ana" }, NOW);
    await tick("CONTRIBUTOR", item.id, true);
    await tick("CONTRIBUTOR", item.id, true);
    await tick("CONTRIBUTOR", item.id, false);
    await changeRaceDayItem(db, staff.ADMIN!, { kind: "remove", eventId, id: item.id }, NOW);
    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual([
      "event.race_day_item_added",
      "event.race_day_item_edited",
      "event.race_day_item_brought",
      "event.race_day_item_unbrought",
      "event.race_day_item_removed",
    ]);
    for (const row of rows) expect(row.metadata).toEqual({ itemId: item.id });
  });

  it("goes with its event", async () => {
    await add("ADMIN", "Masă");
    await db.delete(events).where(eq(events.id, eventId));
    expect(await db.$count(eventRaceDayItems)).toBe(0);
  });
});
