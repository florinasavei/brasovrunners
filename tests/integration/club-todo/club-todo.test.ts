import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { changeClubTodo, readClubTodo } from "@/modules/club-todo/club-todo";
import { CLUB_TODO_ENTITY_ID, CLUB_TODO_SETTING_KEY } from "@/modules/club-todo/domain/club-todo";
import { isDomainError } from "@/shared/errors/domain-error";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-05 and BR-REQ-060-01 — «De făcut», the club's checklist (`DECISIONS.md` §NNN), as
 * stored: one `platform_settings` row, `clubTodo`, that does not exist until somebody first
 * changes the starting list; every write under the row lock, audited with who and the line's
 * words; the role asserted by the service, whatever the page drew.
 */
const NOW = new Date("2026-09-27T08:30:00.000Z");
/** A minute after `NOW` per step, so the trail reads back in the order the steps ran. */
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

let db: TestDatabase;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());
});
afterAll(async () => close());
beforeEach(async () => {
  await resetTables(db);
});

async function staff(role: StaffRole) {
  const [row] = await db
    .insert(staffUsers)
    .values({ email: `${role.toLowerCase()}@example.ro`, displayName: `Dev ${role}`, role })
    .returning();
  return row;
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error.code;
    throw error;
  }
  throw new Error("expected a refusal");
}

async function storedRow() {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, CLUB_TODO_SETTING_KEY));
  return row;
}

async function trail() {
  return db.select().from(auditLogs).where(eq(auditLogs.entityId, CLUB_TODO_ENTITY_ID)).orderBy(auditLogs.createdAt);
}

describe("§NNN the club's checklist, stored", () => {
  it("reads the starting list while nothing is stored, and stores nothing by reading", async () => {
    const state = await readClubTodo(db);
    expect(state.stored).toBe(false);
    expect(state.items).toHaveLength(19);
    expect(await storedRow()).toBeUndefined();
  });

  it("stores the starting list with the first change on it, and audits the change with who and the words", async () => {
    const organizer = await staff("MODERATOR");
    await changeClubTodo(db, organizer, { kind: "setDone", id: "start-dani-01", done: true }, NOW);

    const state = await readClubTodo(db);
    expect(state.stored).toBe(true);
    expect(state.items).toHaveLength(19);
    expect(state.items.find((item) => item.id === "start-dani-01")).toMatchObject({
      done: true,
      doneAt: NOW.toISOString(),
      by: "Dev MODERATOR",
    });
    expect((await storedRow())?.updatedByStaffUserId).toBe(organizer.id);

    const [row] = await trail();
    expect(row.action).toBe("club_todo.done");
    expect(row.actorStaffUserId).toBe(organizer.id);
    expect(row.entityType).toBe("platform_setting");
    expect(row.metadataJson).toMatchObject({ itemId: "start-dani-01", owner: "Dani" });
    expect(String((row.metadataJson as { text: string }).text)).toMatch(/^Intră în backoffice/);
  });

  it("adds, edits, moves, unticks and deletes — one audit row each, in order", async () => {
    const admin = await staff("ADMIN");
    const added = await changeClubTodo(db, admin, { kind: "add", text: "  Comandă tricourile  ", owner: "Florin", due: "2026-10-15" }, at(1));
    expect(added.item).toMatchObject({ text: "Comandă tricourile", owner: "Florin", due: "2026-10-15", order: 20 });

    await changeClubTodo(db, admin, { kind: "edit", id: added.item.id, text: "Comandă tricourile (M, L)", owner: "", due: "" }, at(2));
    await changeClubTodo(db, admin, { kind: "move", id: added.item.id, direction: "up" }, at(3));
    await changeClubTodo(db, admin, { kind: "setDone", id: added.item.id, done: true }, at(4));
    await changeClubTodo(db, admin, { kind: "setDone", id: added.item.id, done: false }, at(5));
    await changeClubTodo(db, admin, { kind: "delete", id: "start-amalia-08" }, at(6));

    const { items } = await readClubTodo(db);
    expect(items).toHaveLength(19);
    expect(items.some((item) => item.id === "start-amalia-08")).toBe(false);
    const mine = items.find((item) => item.id === added.item.id);
    expect(mine).toMatchObject({ text: "Comandă tricourile (M, L)", owner: null, due: null, done: false });
    // Moved up one, above the last starting line.
    expect(items.at(-1)?.id).toBe("start-dani-07");
    expect(items.at(-2)?.id).toBe(added.item.id);

    const rows = await trail();
    expect(rows.map((row) => row.action)).toEqual([
      "club_todo.added",
      "club_todo.edited",
      "club_todo.moved",
      "club_todo.done",
      "club_todo.reopened",
      "club_todo.deleted",
    ]);
    expect(rows[1].metadataJson).toMatchObject({
      from: { text: "Comandă tricourile", owner: "Florin", due: "2026-10-15" },
      to: { text: "Comandă tricourile (M, L)", owner: null, due: null },
    });
    expect(rows[5].metadataJson).toMatchObject({ itemId: "start-amalia-08", text: "(bonus) Refă seria Happy Monday și pe Facebook." });
  });

  it("never brings a deleted starting line back", async () => {
    const admin = await staff("SUPERADMIN");
    await changeClubTodo(db, admin, { kind: "delete", id: "start-amalia-01" }, NOW);
    await changeClubTodo(db, admin, { kind: "setDone", id: "start-amalia-02", done: true }, NOW);
    const { items } = await readClubTodo(db);
    expect(items.map((item) => item.id)).not.toContain("start-amalia-01");
    expect(items).toHaveLength(18);
  });

  it("writes nothing and records nothing when nothing changes", async () => {
    const admin = await staff("ADMIN");
    await changeClubTodo(db, admin, { kind: "move", id: "start-amalia-01", direction: "up" }, NOW);
    await changeClubTodo(db, admin, { kind: "setDone", id: "start-amalia-01", done: false }, NOW);
    expect(await trail()).toEqual([]);
  });

  it("refuses a line typed wrong, naming the box, and a line that is gone", async () => {
    const admin = await staff("ADMIN");
    let fields: readonly string[] = [];
    try {
      await changeClubTodo(db, admin, { kind: "add", text: "   ", owner: "", due: "2026-02-30" }, NOW);
    } catch (error) {
      if (!isDomainError(error)) throw error;
      expect(error.code).toBe("VALIDATION_ERROR");
      fields = error.fields;
    }
    expect([...fields].sort()).toEqual(["due", "text"]);
    expect(await refusal(changeClubTodo(db, admin, { kind: "delete", id: "no-such-line" }, NOW))).toBe("NOT_FOUND");
    expect(await trail()).toEqual([]);
  });

  it("is refused on the server to the Redactor, Tehnic and the volunteer, and leaves no trace", async () => {
    for (const role of ["COPYWRITER", "DEV", "CONTRIBUTOR"] as const) {
      expect(await refusal(changeClubTodo(db, await staff(role), { kind: "setDone", id: "start-amalia-01", done: true }, NOW))).toBe("FORBIDDEN");
    }
    expect(await storedRow()).toBeUndefined();
    expect(await trail()).toEqual([]);
  });
});
