import type { PageTodo } from "@/modules/content/events/domain/page-todos";
import { type SortableTodo, sortTodos } from "./domain/event-todo";
import type { EventTodoItem } from "./event-todos";

/**
 * The card's one list (§NNN): what the page still lacks (computed, `page`) and the lines the club
 * typed (`own`) in a single order — priority, then the due day, then age — with the ticked lines
 * apart, under «Gata». A computed row is never done: it is gone when its field is filled.
 *
 * «Ale mele» keeps only the lines given to one staff member: a computed row has nobody, so it is
 * not in anybody's own list.
 */
export type TodoRow =
  | (SortableTodo & { kind: "page"; todo: PageTodo })
  | (SortableTodo & { kind: "own"; item: EventTodoItem });

export type TodoRows = { open: TodoRow[]; done: Extract<TodoRow, { kind: "own" }>[] };

export function eventTodoRows(page: readonly PageTodo[], own: readonly EventTodoItem[], options: { mineOf?: string } = {}): TodoRows {
  const pageRows: TodoRow[] = options.mineOf
    ? []
    : page.map((todo) => ({ kind: "page", todo, priority: todo.priority, dueOn: null, createdAt: null, key: `page:${todo.id}` }));
  const ownRows = own
    .filter((item) => !options.mineOf || item.assigneeStaffUserId === options.mineOf)
    .map((item) => ({
      kind: "own" as const,
      item,
      priority: item.priority,
      dueOn: item.dueOn,
      createdAt: item.createdAt.toISOString(),
      key: `own:${item.id}`,
    }));
  return {
    open: sortTodos([...pageRows, ...ownRows.filter((row) => row.item.doneAt === null)]),
    // The ticked lines newest-ticked first: what was finished last is what somebody looks for.
    done: ownRows
      .filter((row) => row.item.doneAt !== null)
      .sort((a, b) => (b.item.doneAt?.getTime() ?? 0) - (a.item.doneAt?.getTime() ?? 0) || a.key.localeCompare(b.key)),
  };
}
