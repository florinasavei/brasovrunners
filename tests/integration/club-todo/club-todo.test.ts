import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { platformSettings } from "@/db/schema/platform-settings";
import { staffUsers } from "@/db/schema/staff-users";
import { changeClubTodo, readClubTodo } from "@/modules/club-todo/club-todo";
import { CLUB_TODO_ENTITY_ID, CLUB_TODO_SETTING_KEY } from "@/modules/club-todo/domain/club-todo";
import { firstClubTodo } from "@/modules/club-todo/domain/starting-list";
import { isDomainError } from "@/shared/errors/domain-error";
import type { StaffRole } from "@/modules/staff-identity/domain/roles";
import { createTestDatabase, resetTables, type TestDatabase } from "../../helpers/db";

/**
 * BR-REQ-090-05 and BR-REQ-060-01 — «De făcut», the club's checklist (`DECISIONS.md` §438), as
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

describe("§438 the club's checklist, stored", () => {
  it("reads the starting list while nothing is stored, and stores nothing by reading", async () => {
    const state = await readClubTodo(db);
    expect(state.stored).toBe(false);
    expect(state.items).toHaveLength(20);
    // §NNN: a fresh club gets the two pages in the pre-fill, and not §438's line 11 they replace.
    expect(state.items.map((item) => item.id)).toEqual(expect.arrayContaining(["start-admin-team-page", "start-admin-faq-page"]));
    expect(state.items.map((item) => item.id)).not.toContain("start-admin-11");
    expect(await storedRow()).toBeUndefined();
  });

  it("stores the starting list with the first change on it, and audits the change with who and the words", async () => {
    const organizer = await staff("MODERATOR");
    await changeClubTodo(db, organizer, { kind: "setDone", id: "start-organizer-01", done: true }, NOW);

    const state = await readClubTodo(db);
    expect(state.stored).toBe(true);
    expect(state.items).toHaveLength(20);
    expect(state.items.find((item) => item.id === "start-organizer-01")).toMatchObject({
      done: true,
      doneAt: NOW.toISOString(),
      by: "Dev MODERATOR",
    });
    expect((await storedRow())?.updatedByStaffUserId).toBe(organizer.id);

    const [row] = await trail();
    expect(row.action).toBe("club_todo.done");
    expect(row.actorStaffUserId).toBe(organizer.id);
    expect(row.entityType).toBe("platform_setting");
    expect(row.metadataJson).toMatchObject({ itemId: "start-organizer-01", owner: "Organizator" });
    expect(String((row.metadataJson as { text: string }).text)).toMatch(/^Intră în backoffice/);
  });

  it("adds, edits, moves, unticks and deletes — one audit row each, in order", async () => {
    const admin = await staff("ADMIN");
    const added = await changeClubTodo(db, admin, { kind: "add", text: "  Comandă tricourile  ", owner: "Ana", due: "2026-10-15" }, at(1));
    expect(added.item).toMatchObject({ text: "Comandă tricourile", owner: "Ana", due: "2026-10-15", order: 21 });

    await changeClubTodo(db, admin, { kind: "edit", id: added.item.id, text: "Comandă tricourile (M, L)", owner: "", due: "" }, at(2));
    await changeClubTodo(db, admin, { kind: "move", id: added.item.id, direction: "up" }, at(3));
    await changeClubTodo(db, admin, { kind: "setDone", id: added.item.id, done: true }, at(4));
    await changeClubTodo(db, admin, { kind: "setDone", id: added.item.id, done: false }, at(5));
    await changeClubTodo(db, admin, { kind: "delete", id: "start-admin-08" }, at(6));

    const { items } = await readClubTodo(db);
    expect(items).toHaveLength(20);
    expect(items.some((item) => item.id === "start-admin-08")).toBe(false);
    const mine = items.find((item) => item.id === added.item.id);
    expect(mine).toMatchObject({ text: "Comandă tricourile (M, L)", owner: null, due: null, done: false });
    // Moved up one, above the last starting line.
    expect(items.at(-1)?.id).toBe("start-organizer-07");
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
      from: { text: "Comandă tricourile", owner: "Ana", due: "2026-10-15" },
      to: { text: "Comandă tricourile (M, L)", owner: null, due: null },
    });
    expect(rows[5].metadataJson).toMatchObject({ itemId: "start-admin-08", text: "(bonus) Refă seria Happy Monday și pe Facebook." });
  });

  it("never brings a deleted starting line back", async () => {
    const admin = await staff("SUPERADMIN");
    await changeClubTodo(db, admin, { kind: "delete", id: "start-admin-01" }, NOW);
    await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-02", done: true }, NOW);
    const { items } = await readClubTodo(db);
    expect(items.map((item) => item.id)).not.toContain("start-admin-01");
    expect(items).toHaveLength(19);
  });

  describe("§NNN a list stored before the two pages were written", () => {
    const PAGES = ["start-admin-team-page", "start-admin-faq-page"];

    /**
     * Production's row: §438's nineteen lines as the club left them, one ticked and one deleted, no
     * marker — line 11 as §438 wrote it unless `line11` says what the club did to it.
     */
    async function storeOldList(line11: Partial<{ text: string; done: boolean }> = {}) {
      const old = firstClubTodo()
        .filter((item) => item.id !== "start-admin-08")
        .map((item, index) => ({
          ...item,
          order: index + 1,
          ...(item.id === "start-admin-01" ? { done: true, doneAt: NOW.toISOString(), by: "Dev ADMIN" } : {}),
          ...(item.id === "start-admin-11" ? { ...line11, ...(line11.done ? { doneAt: NOW.toISOString(), by: "Dev ADMIN" } : {}) } : {}),
        }));
      await db.insert(platformSettings).values({ key: CLUB_TODO_SETTING_KEY, value: { items: old }, updatedAt: NOW });
      return old;
    }

    it("gains exactly the two pages on the next read, loses §438's untouched line 11 they replace, and a second read changes nothing", async () => {
      const old = await storeOldList();
      const first = await readClubTodo(db);
      expect(first.items).toHaveLength(old.length + 2 - 1);
      expect(first.items.map((item) => item.id)).not.toContain("start-admin-11");
      expect(first.items.slice(-2).map((item) => item.id)).toEqual(PAGES);
      expect(first.items.slice(-2).every((item) => item.owner === "Administrator" && !item.done)).toBe(true);
      // Nothing the club did is undone: the tick stays, the deleted line stays gone.
      expect(first.items.find((item) => item.id === "start-admin-01")?.done).toBe(true);
      expect(first.items.map((item) => item.id)).not.toContain("start-admin-08");

      const second = await readClubTodo(db);
      expect(second.items).toEqual(first.items);
    });

    it("stores them with the next write, audited only for the press, and never re-adds one the club ticked or deleted", async () => {
      await storeOldList();
      const admin = await staff("ADMIN");
      await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-team-page", done: true }, at(1));
      await changeClubTodo(db, admin, { kind: "delete", id: "start-admin-faq-page" }, at(2));

      const stored = (await storedRow())?.value as { items: { id: string }[]; seenDefaults: string[] };
      expect(stored.seenDefaults).toEqual(expect.arrayContaining(PAGES));
      expect(stored.items.map((item) => item.id)).toContain("start-admin-team-page");
      expect(stored.items.map((item) => item.id)).not.toContain("start-admin-faq-page");

      const { items } = await readClubTodo(db);
      expect(items.filter((item) => PAGES.includes(item.id)).map((item) => [item.id, item.done])).toEqual([["start-admin-team-page", true]]);
      expect((await trail()).map((row) => row.action)).toEqual(["club_todo.done", "club_todo.deleted"]);
    });

    it("stores the list without line 11 once the team line arrives, and never brings it back", async () => {
      await storeOldList();
      const admin = await staff("ADMIN");
      await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-02", done: true }, at(1));
      const stored = (await storedRow())?.value as { items: { id: string }[]; seenDefaults: string[] };
      expect(stored.items.map((item) => item.id)).not.toContain("start-admin-11");
      expect(stored.seenDefaults).toContain("start-admin-11");
      expect((await readClubTodo(db)).items.map((item) => item.id)).not.toContain("start-admin-11");
      expect((await trail()).map((row) => row.action)).toEqual(["club_todo.done"]);
    });

    it("keeps line 11 beside the team line when the club edited it or ticked it", async () => {
      await storeOldList({ text: "Echipa: pozele voluntarilor, până vineri" });
      const edited = await readClubTodo(db);
      expect(edited.items.find((item) => item.id === "start-admin-11")?.text).toBe("Echipa: pozele voluntarilor, până vineri");
      expect(edited.items.map((item) => item.id)).toContain("start-admin-team-page");

      await resetTables(db);
      await storeOldList({ done: true });
      const admin = await staff("ADMIN");
      await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-02", done: true }, at(1));
      const { items } = await readClubTodo(db);
      expect(items.find((item) => item.id === "start-admin-11")?.done).toBe(true);
      expect(items.map((item) => item.id)).toContain("start-admin-team-page");
    });

    it("stores them even when the press itself changes nothing, without an audit row", async () => {
      await storeOldList();
      const admin = await staff("ADMIN");
      await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-02", done: false }, at(1));
      const stored = (await storedRow())?.value as { items: { id: string }[]; seenDefaults: string[] };
      expect(stored.items.map((item) => item.id)).toEqual(expect.arrayContaining(PAGES));
      expect(stored.seenDefaults).toEqual(expect.arrayContaining(PAGES));
      expect(await trail()).toEqual([]);
    });
  });

  it("records nothing in the audit trail when nothing changes", async () => {
    const admin = await staff("ADMIN");
    await changeClubTodo(db, admin, { kind: "move", id: "start-admin-01", direction: "up" }, NOW);
    await changeClubTodo(db, admin, { kind: "setDone", id: "start-admin-01", done: false }, NOW);
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
      expect(await refusal(changeClubTodo(db, await staff(role), { kind: "setDone", id: "start-admin-01", done: true }, NOW))).toBe("FORBIDDEN");
    }
    expect(await storedRow()).toBeUndefined();
    expect(await trail()).toEqual([]);
  });
});
