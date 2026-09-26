import { describe, expect, it } from "vitest";
import {
  applyClubTodo,
  canEditClubTodo,
  canReadClubTodo,
  CLUB_TODO_MAX_ITEMS,
  type ClubTodoItem,
  ClubTodoFull,
  clubTodoInputSchema,
  ClubTodoMissing,
  clubTodoOwners,
  filterClubTodo,
  isCalendarDay,
  isClubTodoOverdue,
  openClubTodoCount,
  readClubTodoValue,
  resolveClubTodoOwner,
} from "@/modules/club-todo/domain/club-todo";
import { CLUB_TODO_OWNER_SUGGESTIONS, startingClubTodo } from "@/modules/club-todo/domain/starting-list";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * BR-REQ-090-05 and BR-REQ-060-01 — «De făcut», the club's own checklist on `/admin/tasks`
 * (`DECISIONS.md` §NNN; the owner, 2026-09-26: "I need another folder — a list for Amalia (the
 * club's to-do)"). The list operations, the count, the owner filter, the starting list's shape
 * and the role gate, all pure; the stored row and the audit trail are `tests/integration/
 * club-todo/club-todo.test.ts`.
 */

const NOW = new Date("2026-09-27T08:30:00.000Z");
let counter = 0;
const context = { now: NOW, by: "Dev Moderator", newId: () => `new-${(counter += 1)}` };

function line(id: string, order: number, patch: Partial<ClubTodoItem> = {}): ClubTodoItem {
  return {
    id,
    text: `Line ${id}`,
    owner: null,
    done: false,
    doneAt: null,
    by: null,
    createdAt: "2026-09-26T12:00:00.000Z",
    due: null,
    order,
    ...patch,
  };
}

const input = (text: string, owner = "", due = "") => clubTodoInputSchema.parse({ text, owner, due });

describe("§NNN the starting list — the owner's two messages of 2026-09-26", () => {
  const items = startingClubTodo();

  it("is nineteen lines: the Administrator's twelve, then the Organizer's seven, in their order", () => {
    expect(items).toHaveLength(19);
    expect(items.slice(0, 12).every((item) => item.owner === "Amalia")).toBe(true);
    expect(items.slice(12).every((item) => item.owner === "Dani")).toBe(true);
    expect(items.map((item) => item.order)).toEqual(Array.from({ length: 19 }, (_, index) => index + 1));
    expect(items[0].text).toMatch(/^Intră în backoffice/);
    expect(items[12].text).toMatch(/^Intră în backoffice .*«Înscrieri»/);
  });

  it("has fixed, unique ids, so a tick pressed before anything is stored finds its line", () => {
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(19);
    expect(ids[0]).toBe("start-amalia-01");
    expect(ids[18]).toBe("start-dani-07");
    expect(startingClubTodo().map((item) => item.id)).toEqual(ids);
  });

  it("carries no address and no URL — the repository is public", () => {
    for (const item of items) {
      expect(item.text, item.id).not.toMatch(/@/);
      expect(item.text, item.id).not.toMatch(/https?:|www\./i);
      // No host of any kind: a page is named by its path in the backoffice, never by its domain.
      expect(item.text, item.id).not.toMatch(/\b[a-z0-9-]+\.(com|ro|net|org|app)\b/i);
    }
    expect(items.some((item) => item.text.includes("adresa de Gmail a clubului"))).toBe(true);
  });

  it("dates the two «după 10 octombrie» lines, and only those", () => {
    const dated = items.filter((item) => item.due !== null);
    expect(dated.map((item) => [item.id, item.due])).toEqual([
      ["start-amalia-12", "2026-10-10"],
      ["start-dani-07", "2026-10-10"],
    ]);
    for (const item of dated) expect(item.text).toMatch(/^După 10 octombrie/);
  });

  it("starts with every line open, and every line valid by the stored schema", () => {
    expect(openClubTodoCount(items)).toBe(19);
    expect(readClubTodoValue({ items })).toEqual(items);
  });

  it("offers Amalia, Dani and Florin as «pentru cine»", () => {
    expect(CLUB_TODO_OWNER_SUGGESTIONS).toEqual(["Amalia", "Dani", "Florin"]);
  });
});

describe("§NNN reading the stored row", () => {
  it("drops a line it cannot read and a repeated id, and keeps the rest in order", () => {
    const value = {
      items: [line("b", 2), { id: "broken" }, line("a", 1), line("a", 3), line("c", 4, { due: "2026-02-30" })],
    };
    expect(readClubTodoValue(value).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("reads anything that is not a list as an empty one — never as the starting list again", () => {
    expect(readClubTodoValue(null)).toEqual([]);
    expect(readClubTodoValue({ items: "nope" })).toEqual([]);
    expect(readClubTodoValue({})).toEqual([]);
  });
});

describe("§NNN what a form posts", () => {
  it("trims the line, reads a blank owner and a blank day as none", () => {
    expect(input("  Sună primăria  ", "  ", "")).toEqual({ text: "Sună primăria", owner: null, due: null });
    expect(input("x", " Dani  Popescu ", "2026-10-10")).toEqual({ text: "x", owner: "Dani Popescu", due: "2026-10-10" });
  });

  it("refuses an empty line, a day that does not exist and an owner longer than a name", () => {
    expect(clubTodoInputSchema.safeParse({ text: "   ", owner: "", due: "" }).success).toBe(false);
    expect(clubTodoInputSchema.safeParse({ text: "x", owner: "", due: "2026-02-30" }).success).toBe(false);
    expect(clubTodoInputSchema.safeParse({ text: "x", owner: "", due: "10.10.2026" }).success).toBe(false);
    expect(clubTodoInputSchema.safeParse({ text: "x", owner: "a".repeat(41), due: "" }).success).toBe(false);
  });

  it("knows a calendar day", () => {
    expect(isCalendarDay("2026-10-10")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-1-1")).toBe(false);
  });
});

describe("§NNN the list operations", () => {
  const list = [line("a", 1, { owner: "Amalia" }), line("b", 2, { owner: "Dani" }), line("c", 3, { owner: "Amalia" })];

  it("adds a line at the end, open, with the next order number", () => {
    const result = applyClubTodo(list, { kind: "add", input: input("Nou", "Florin", "2026-10-01") }, context);
    expect(result.changed).toBe(true);
    expect(result.items).toHaveLength(4);
    expect(result.item).toMatchObject({ text: "Nou", owner: "Florin", due: "2026-10-01", done: false, order: 4, createdAt: NOW.toISOString() });
    expect(result.items.at(-1)?.id).toBe(result.item.id);
  });

  it("refuses to grow the list past its ceiling", () => {
    const full = Array.from({ length: CLUB_TODO_MAX_ITEMS }, (_, index) => line(`x${index}`, index + 1));
    expect(() => applyClubTodo(full, { kind: "add", input: input("one more") }, context)).toThrow(ClubTodoFull);
  });

  it("edits the words, the owner and the day, and says so only when something changed", () => {
    const edited = applyClubTodo(list, { kind: "edit", id: "b", input: input("Line b", "Dani", "2026-10-10") }, context);
    expect(edited.changed).toBe(true);
    expect(edited.item).toMatchObject({ id: "b", due: "2026-10-10", order: 2 });
    expect(edited.before?.due).toBeNull();
    const same = applyClubTodo(list, { kind: "edit", id: "b", input: input("Line b", "Dani") }, context);
    expect(same.changed).toBe(false);
  });

  it("ticks with who and when, and unticks back to open", () => {
    const ticked = applyClubTodo(list, { kind: "setDone", id: "a", done: true }, context);
    expect(ticked.item).toMatchObject({ done: true, doneAt: NOW.toISOString(), by: "Dev Moderator" });
    expect(openClubTodoCount(ticked.items)).toBe(2);
    // The state wanted, not a toggle: a second tick changes nothing.
    expect(applyClubTodo(ticked.items, { kind: "setDone", id: "a", done: true }, context).changed).toBe(false);
    const reopened = applyClubTodo(ticked.items, { kind: "setDone", id: "a", done: false }, context);
    expect(reopened.item).toMatchObject({ done: false, doneAt: null, by: null });
  });

  it("moves a line up and down among the open lines, and not past an end", () => {
    const up = applyClubTodo(list, { kind: "move", id: "b", direction: "up" }, context);
    expect(up.items.map((item) => item.id)).toEqual(["b", "a", "c"]);
    const down = applyClubTodo(list, { kind: "move", id: "b", direction: "down" }, context);
    expect(down.items.map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(applyClubTodo(list, { kind: "move", id: "a", direction: "up" }, context).changed).toBe(false);
    expect(applyClubTodo(list, { kind: "move", id: "c", direction: "down" }, context).changed).toBe(false);
  });

  it("moves among the lines the filter shows: Amalia's «c» up goes above Amalia's «a», past Dani's", () => {
    const moved = applyClubTodo(list, { kind: "move", id: "c", direction: "up", owner: "amalia" }, context);
    expect(moved.items.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("skips a done line when moving, and still moves two lines that shared an order number", () => {
    const withDone = [line("a", 1), line("b", 2, { done: true, doneAt: NOW.toISOString(), by: "x" }), line("c", 3)];
    expect(applyClubTodo(withDone, { kind: "move", id: "c", direction: "up" }, context).items.map((item) => item.id)).toEqual(["c", "b", "a"]);
    const tied = [line("a", 1), line("b", 1)];
    const moved = applyClubTodo(tied, { kind: "move", id: "b", direction: "up" }, context);
    expect(moved.changed).toBe(true);
    expect(moved.items.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("deletes a line", () => {
    const result = applyClubTodo(list, { kind: "delete", id: "b" }, context);
    expect(result.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(result.item.id).toBe("b");
  });

  it("refuses a line that is not there — a colleague deleted it a moment ago", () => {
    for (const op of [
      { kind: "edit", id: "zz", input: input("x") },
      { kind: "setDone", id: "zz", done: true },
      { kind: "move", id: "zz", direction: "up" },
      { kind: "delete", id: "zz" },
    ] as const) {
      expect(() => applyClubTodo(list, op, context)).toThrow(ClubTodoMissing);
    }
  });
});

describe("§NNN the count and the owner filter", () => {
  const list = [
    line("a", 1, { owner: "Amalia" }),
    line("b", 2, { owner: "Dani", done: true, doneAt: NOW.toISOString(), by: "x" }),
    line("c", 3, { owner: "dani" }),
    line("d", 4),
  ];

  it("counts the open lines over the whole list", () => {
    expect(openClubTodoCount(list)).toBe(3);
  });

  it("lists each owner once, in the list's order, whatever the case they were typed in", () => {
    expect(clubTodoOwners(list)).toEqual(["Amalia", "Dani"]);
  });

  it("filters by owner without case, and shows everything with no owner asked", () => {
    expect(filterClubTodo(list, "DANI").map((item) => item.id)).toEqual(["b", "c"]);
    expect(filterClubTodo(list, undefined).map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("reads a ?for= naming nobody on the list as everybody", () => {
    expect(resolveClubTodoOwner(list, "dani")).toBe("Dani");
    expect(resolveClubTodoOwner(list, "Ghost")).toBeUndefined();
    expect(resolveClubTodoOwner(list, undefined)).toBeUndefined();
  });

  it("marks an open line past its day as overdue, never a done one", () => {
    expect(isClubTodoOverdue(line("x", 1, { due: "2026-10-09" }), "2026-10-10")).toBe(true);
    expect(isClubTodoOverdue(line("x", 1, { due: "2026-10-10" }), "2026-10-10")).toBe(false);
    expect(isClubTodoOverdue(line("x", 1, { due: "2026-10-09", done: true }), "2026-10-10")).toBe(false);
  });
});

describe("§NNN BR-REQ-060-01 who reads and who writes the list", () => {
  it("is read from the Redactor up, never by the volunteer", () => {
    expect(STAFF_ROLES.filter(canReadClubTodo)).toEqual(["COPYWRITER", "MODERATOR", "DEV", "ADMIN", "SUPERADMIN"]);
  });

  it("is written by the Organizer, the Administrator and the Superadministrator — not by the Redactor or Tehnic", () => {
    expect(STAFF_ROLES.filter(canEditClubTodo)).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
  });
});
