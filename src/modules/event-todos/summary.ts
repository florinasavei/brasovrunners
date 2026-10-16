import type { PageTodo } from "@/modules/content/events/domain/page-todos";
import { type EventTodoPriority, isTodoOverdue, sortTodos } from "./domain/event-todo";
import type { EventTodoItem } from "./event-todos";

/**
 * What each closed fold of the card says on its row (§752): how many, the most pressing priority, and —
 * for the club's own tasks — how many are the signed-in person's and how many are overdue.
 *
 * Counted over **all** the data, never over «Ale mele»: the closed line must not depend on the view
 * (the rule the card's own «N de făcut» already follows, §749). A ticked task is not counted.
 */
export type TodoFoldSummary = {
  page: { count: number; top: EventTodoPriority | null };
  own: { count: number; mine: number; overdue: number; top: EventTodoPriority | null };
};

/** The most pressing priority among rows, or null for none. */
function topPriority(rows: readonly { priority: EventTodoPriority }[]): EventTodoPriority | null {
  const first = sortTodos(rows.map((row, index) => ({ priority: row.priority, dueOn: null, createdAt: null, key: String(index) })))[0];
  return first ? first.priority : null;
}

export function summariseTodoFolds(
  computed: readonly PageTodo[],
  items: readonly EventTodoItem[],
  currentStaffId: string,
  today: string,
): TodoFoldSummary {
  const open = items.filter((item) => item.doneAt === null);
  return {
    page: { count: computed.length, top: topPriority(computed) },
    own: {
      count: open.length,
      mine: open.filter((item) => item.assigneeStaffUserId === currentStaffId).length,
      overdue: open.filter((item) => isTodoOverdue({ dueOn: item.dueOn, done: false }, today)).length,
      top: topPriority(open),
    },
  };
}
