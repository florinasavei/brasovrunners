import { describe, expect, it } from "vitest";
import type { PageTodo } from "@/modules/content/events/domain/page-todos";
import {
  canEditEventTodos,
  canReadEventTodos,
  compareTodos,
  EVENT_TODO_PRIORITIES,
  EVENT_TODO_TEXT_MAX,
  eventTodoInputSchema,
  isTodoOverdue,
  readEventTodoPriority,
  type SortableTodo,
  sortTodos,
} from "@/modules/event-todos/domain/event-todo";
import type { EventTodoItem } from "@/modules/event-todos/event-todos";
import { eventTodoRows } from "@/modules/event-todos/rows";
import { STAFF_ROLES } from "@/modules/staff-identity/domain/roles";

/**
 * §NNN — an event's own to-dos (BR-REQ-050-01): the priority scale, what a form may post, who
 * may read and write, and the one order the card lists its rows in.
 */
const row = (key: string, priority: SortableTodo["priority"], dueOn: string | null = null, createdAt: string | null = "2026-10-01T00:00:00.000Z"): SortableTodo => ({
  key,
  priority,
  dueOn,
  createdAt,
});

describe("§NNN the order of the list", () => {
  it("puts urgent before high before normal before low", () => {
    const sorted = sortTodos([row("low", "LOW"), row("normal", "NORMAL"), row("urgent", "URGENT"), row("high", "HIGH")]);
    expect(sorted.map((item) => item.key)).toEqual(["urgent", "high", "normal", "low"]);
  });

  it("breaks a tie of priority by the due day, the earlier first and no day last", () => {
    const sorted = sortTodos([row("none", "HIGH"), row("later", "HIGH", "2026-11-20"), row("sooner", "HIGH", "2026-11-02")]);
    expect(sorted.map((item) => item.key)).toEqual(["sooner", "later", "none"]);
  });

  it("breaks a tie of priority and day by age, the older first, and a computed row (no age) before a typed one", () => {
    const sorted = sortTodos([
      row("newer", "NORMAL", null, "2026-10-12T00:00:00.000Z"),
      row("computed", "NORMAL", null, null),
      row("older", "NORMAL", null, "2026-10-02T00:00:00.000Z"),
    ]);
    expect(sorted.map((item) => item.key)).toEqual(["computed", "older", "newer"]);
  });

  it("lets a higher priority win over an earlier day", () => {
    const sorted = sortTodos([row("early-low", "LOW", "2026-10-14"), row("late-urgent", "URGENT", "2027-01-01")]);
    expect(sorted.map((item) => item.key)).toEqual(["late-urgent", "early-low"]);
  });

  it("is total and leaves its input alone", () => {
    const input = [row("b", "NORMAL"), row("a", "NORMAL")];
    expect(sortTodos(input).map((item) => item.key)).toEqual(["a", "b"]);
    expect(input.map((item) => item.key)).toEqual(["b", "a"]);
    expect(compareTodos(input[0], input[0])).toBe(0);
  });
});

describe("§NNN the priority", () => {
  it("is a closed set of four, normal when a posted value is none of them", () => {
    expect(EVENT_TODO_PRIORITIES).toEqual(["URGENT", "HIGH", "NORMAL", "LOW"]);
    expect(readEventTodoPriority("HIGH")).toBe("HIGH");
    expect(readEventTodoPriority("whatever")).toBe("NORMAL");
    expect(readEventTodoPriority(undefined)).toBe("NORMAL");
  });
});

describe("§NNN what a form posts", () => {
  const ASSIGNEE = "7b2c1f0e-3d4a-4b5c-8d6e-0f1a2b3c4d5e";

  it("reads the line, the priority, who and the day, folding whitespace and blanks", () => {
    expect(eventTodoInputSchema.parse({ text: "  Pune   harta  ", priority: "URGENT", assignee: ASSIGNEE, due: "2026-11-01" })).toEqual({
      text: "Pune harta",
      priority: "URGENT",
      assignee: ASSIGNEE,
      due: "2026-11-01",
    });
    expect(eventTodoInputSchema.parse({ text: "x", priority: "", assignee: " ", due: "" })).toEqual({ text: "x", priority: "NORMAL", assignee: null, due: null });
  });

  it("refuses an empty line, a line over the limit, a day that does not exist and a person that is no id", () => {
    expect(eventTodoInputSchema.safeParse({ text: "   ", priority: "", assignee: "", due: "" }).success).toBe(false);
    expect(eventTodoInputSchema.safeParse({ text: "x".repeat(EVENT_TODO_TEXT_MAX + 1), priority: "", assignee: "", due: "" }).success).toBe(false);
    expect(eventTodoInputSchema.safeParse({ text: "x".repeat(EVENT_TODO_TEXT_MAX), priority: "", assignee: "", due: "" }).success).toBe(true);
    expect(eventTodoInputSchema.safeParse({ text: "x", priority: "", assignee: "", due: "2026-02-30" }).success).toBe(false);
    expect(eventTodoInputSchema.safeParse({ text: "x", priority: "", assignee: "not-an-id", due: "" }).success).toBe(false);
  });
});

describe("§NNN who may do what", () => {
  it("lets the Organizer and the Administrators write and every role that reads the content read; the Tehnic only reads", () => {
    const writers = STAFF_ROLES.filter((role) => canEditEventTodos(role));
    expect(writers).toEqual(["MODERATOR", "ADMIN", "SUPERADMIN"]);
    expect(canEditEventTodos("DEV")).toBe(false);
    expect(canReadEventTodos("DEV")).toBe(true);
    expect(canReadEventTodos("COPYWRITER")).toBe(true);
    // The volunteer and a member of the club's zone never open the editor.
    expect(canReadEventTodos("CONTRIBUTOR")).toBe(false);
    expect(canReadEventTodos("MEMBER")).toBe(false);
  });

  it("calls a day overdue only before today and only while open", () => {
    expect(isTodoOverdue({ dueOn: "2026-10-12", done: false }, "2026-10-13")).toBe(true);
    expect(isTodoOverdue({ dueOn: "2026-10-13", done: false }, "2026-10-13")).toBe(false);
    expect(isTodoOverdue({ dueOn: "2026-10-12", done: true }, "2026-10-13")).toBe(false);
    expect(isTodoOverdue({ dueOn: null, done: false }, "2026-10-13")).toBe(false);
  });
});

describe("§NNN the card's rows", () => {
  const ME = "00000000-0000-4000-8000-00000000aaaa";
  const page: PageTodo[] = [
    { id: "cover", rule: "cover", locale: null, priority: "NORMAL", anchor: "box-cover" },
    { id: "declaration", rule: "declaration", locale: null, priority: "URGENT", anchor: "box-declaration" },
  ];
  const item = (id: string, overrides: Partial<EventTodoItem> = {}): EventTodoItem => ({
    id,
    eventId: "e",
    text: id,
    priority: "NORMAL",
    assigneeStaffUserId: null,
    assigneeName: null,
    dueOn: null,
    doneAt: null,
    doneByName: null,
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
    ...overrides,
  });

  it("mixes the computed and the typed rows in one order (a dated urgent line before an undated urgent gap), the ticked ones apart under «Gata»", () => {
    const rows = eventTodoRows(page, [
      item("urgent-typed", { priority: "URGENT", dueOn: "2026-10-20" }),
      item("low-typed", { priority: "LOW" }),
      item("ticked", { doneAt: new Date("2026-10-10T00:00:00.000Z") }),
    ]);
    expect(rows.open.map((entry) => entry.key)).toEqual(["own:urgent-typed", "page:declaration", "page:cover", "own:low-typed"]);
    expect(rows.done.map((entry) => entry.key)).toEqual(["own:ticked"]);
  });

  it("shows the last ticked first among the done", () => {
    const rows = eventTodoRows([], [
      item("first", { doneAt: new Date("2026-10-08T00:00:00.000Z") }),
      item("second", { doneAt: new Date("2026-10-09T00:00:00.000Z") }),
    ]);
    expect(rows.done.map((entry) => entry.key)).toEqual(["own:second", "own:first"]);
  });

  it("«Ale mele» keeps only the typed rows given to the reader: a computed row has nobody", () => {
    const rows = eventTodoRows(page, [item("mine", { assigneeStaffUserId: ME }), item("theirs", { assigneeStaffUserId: "someone-else" }), item("nobody")], { mineOf: ME });
    expect(rows.open.map((entry) => entry.key)).toEqual(["own:mine"]);
  });
});
