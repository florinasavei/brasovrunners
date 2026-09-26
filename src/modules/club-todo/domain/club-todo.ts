import { z } from "zod";
import { atLeast, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * «De făcut» / "To do" — the club's own checklist on `/admin/tasks` (§NNN; the owner, 2026-09-26:
 * "I need another folder — a list for Amalia (the club's to-do)", and "vreau aceste to-do-uri și
 * pe site").
 *
 * The «Club» panel beside it is read from the system and never ticked by hand (§41, §149); this
 * one is the opposite on purpose: lines people type, tick and put in order, for work no system
 * can see — "accept the invitation", "confirm the events' dates", "brief the volunteers". It is
 * one `platform_settings` row (key `clubTodo`, §100's shape) holding the whole list as JSON: a
 * club's list is a few dozen lines, read whole on one screen and written one line at a time
 * under a row lock, so a table of its own would be a migration for nothing (the owner's standing
 * "no migration when there is a way without").
 *
 * Everything here is pure — the list operations, the count, the owner filter and the role gate —
 * so the rules are unit-tested without a database; `club-todo.ts` beside it is the one writer.
 */

export const CLUB_TODO_SETTING_KEY = "clubTodo";
/**
 * One fixed id per setting for the audit row (`jobs/cadence.ts`'s convention): `…e001`–`…e009`
 * are taken on qa; `…e00a` is left for the work in flight beside this one.
 */
export const CLUB_TODO_ENTITY_ID = "00000000-0000-4000-8000-00000000e00b";

/** A line is a sentence or a short paragraph — the longest starting item is about 700 characters. */
export const CLUB_TODO_TEXT_MAX = 2000;
/** «Pentru cine»: a first name or two, never an address. */
export const CLUB_TODO_OWNER_MAX = 40;
/** A ceiling so a runaway script cannot grow one settings row without bound. */
export const CLUB_TODO_MAX_ITEMS = 300;

// ---------------------------------------------------------------------------------------------
// Who may read and who may write (BR-REQ-060-01: asserted by the service, not by a hidden button)
// ---------------------------------------------------------------------------------------------

/**
 * Reading the list: every role that reads the club's content (`canReadContent`, §208) — the
 * Redactor, the Organizer, Tehnic, the Administrator and the Superadministrator. The volunteer's
 * backoffice stays the desk and the guide (§103): they get no tab and a 404 on the route.
 */
export function canReadClubTodo(role: StaffRole): boolean {
  return atLeast(role, "COPYWRITER");
}

/**
 * Writing it — add, tick, edit, delete, reorder: the Organizer, the Administrator and the
 * Superadministrator. **A set, not a threshold**, like `canReadRegistrations` (§289), and for a
 * cousin of its reason: `DEV` outranks the Organizer only so `/devs` can be a threshold, and the
 * club's worklist is the club's, not the platform helper's. The Redactor reads it and asks.
 */
const MAY_WRITE: ReadonlySet<StaffRole> = new Set<StaffRole>(["MODERATOR", "ADMIN", "SUPERADMIN"]);

export function canEditClubTodo(role: StaffRole): boolean {
  return MAY_WRITE.has(role);
}

// ---------------------------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day that exists: "2026-10-10" yes, "2026-02-30" no. */
export function isCalendarDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const clubTodoItemSchema = z
  .object({
    id: z.string().min(1).max(64),
    text: z.string().min(1).max(CLUB_TODO_TEXT_MAX),
    /** «Pentru cine»: free text — "Amalia", "Dani", "Florin" are offered, anything else is kept. */
    owner: z.string().min(1).max(CLUB_TODO_OWNER_MAX).nullable(),
    done: z.boolean(),
    /** When it was ticked, as an ISO instant; null while open. */
    doneAt: z.string().nullable(),
    /** Who ticked it — the staff member's display name at the time; null while open. */
    by: z.string().max(200).nullable(),
    createdAt: z.string(),
    /** A calendar day with no time, "2026-10-10", or null. */
    due: z.string().refine(isCalendarDay).nullable(),
    /** The list's order, ascending; only its relative value means anything. */
    order: z.number().int(),
  })
  .strict();

export type ClubTodoItem = z.infer<typeof clubTodoItemSchema>;

/**
 * The row's value, item by item: a line this code cannot read is dropped rather than taking the
 * whole list with it — and the starting list is **never** read in its place, because a stored
 * list is one somebody has already worked on, and reviving deleted lines would undo their work.
 */
export function readClubTodoValue(value: unknown): ClubTodoItem[] {
  const raw = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? ((value as { items: unknown[] }).items)
    : [];
  const items: ClubTodoItem[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    const parsed = clubTodoItemSchema.safeParse(candidate);
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    items.push(parsed.data);
  }
  return sortClubTodo(items);
}

// ---------------------------------------------------------------------------------------------
// What a form posts
// ---------------------------------------------------------------------------------------------

/**
 * The three things a person types: the line, «pentru cine» and a due day. Blank owner and blank
 * day are "none"; the line itself is required. Field names are the form's own `name`s, so a
 * refusal's summary links straight to the box (§47).
 */
export const clubTodoInputSchema = z.object({
  text: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(CLUB_TODO_TEXT_MAX)),
  owner: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().max(CLUB_TODO_OWNER_MAX))
    .transform((value) => (value === "" ? null : value)),
  due: z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value === "" || isCalendarDay(value))
    .transform((value) => (value === "" ? null : value)),
});

export type ClubTodoInput = z.infer<typeof clubTodoInputSchema>;

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** In the list's order; `createdAt` and then the id break a tie so the order is total. */
export function sortClubTodo(items: readonly ClubTodoItem[]): ClubTodoItem[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** How many lines are still open — the number in the tab's label, over the whole list whatever the filter. */
export function openClubTodoCount(items: readonly ClubTodoItem[]): number {
  return items.filter((item) => !item.done).length;
}

/** The owners named on the list, each once, in the list's order — the filter's chips. */
export function clubTodoOwners(items: readonly ClubTodoItem[]): string[] {
  const owners: string[] = [];
  const seen = new Set<string>();
  for (const item of sortClubTodo(items)) {
    if (item.owner === null) continue;
    const key = item.owner.toLocaleLowerCase("ro");
    if (seen.has(key)) continue;
    seen.add(key);
    owners.push(item.owner);
  }
  return owners;
}

/**
 * The owner a `?for=` names, as the list writes it — or undefined when it names nobody on the
 * list, which reads as "everybody" (the same rule as the «Club» panel's filters, §150).
 */
export function resolveClubTodoOwner(items: readonly ClubTodoItem[], requested: string | undefined): string | undefined {
  if (!requested) return undefined;
  const wanted = requested.trim().toLocaleLowerCase("ro");
  return clubTodoOwners(items).find((owner) => owner.toLocaleLowerCase("ro") === wanted);
}

/** The lines for one owner, compared without case — "dani" and "Dani" are one person. */
export function filterClubTodo(items: readonly ClubTodoItem[], owner: string | undefined): ClubTodoItem[] {
  const sorted = sortClubTodo(items);
  if (!owner) return sorted;
  const wanted = owner.toLocaleLowerCase("ro");
  return sorted.filter((item) => item.owner?.toLocaleLowerCase("ro") === wanted);
}

/** Past its day and still open, on the club's calendar ("2026-10-11" against "2026-10-10"). */
export function isClubTodoOverdue(item: ClubTodoItem, today: string): boolean {
  return !item.done && item.due !== null && item.due < today;
}

// ---------------------------------------------------------------------------------------------
// Changing — each operation returns the new list; the caller writes it and the audit row
// ---------------------------------------------------------------------------------------------

export type ClubTodoOp =
  | { kind: "add"; input: ClubTodoInput }
  | { kind: "edit"; id: string; input: ClubTodoInput }
  | { kind: "setDone"; id: string; done: boolean }
  | { kind: "move"; id: string; direction: "up" | "down"; owner?: string }
  | { kind: "delete"; id: string };

export class ClubTodoMissing extends Error {
  constructor(readonly id: string) {
    super(`no club to-do line ${id}`);
  }
}

export class ClubTodoFull extends Error {
  constructor() {
    super(`the club's list holds ${CLUB_TODO_MAX_ITEMS} lines already`);
  }
}

export type ClubTodoResult = {
  items: ClubTodoItem[];
  /** The line the operation was about, as it stands after it (as it stood, for a delete). */
  item: ClubTodoItem;
  /** False when nothing changed — a move at the end of the list, a tick on a ticked line, an edit to the same words. */
  changed: boolean;
  /** For an edit: what the line said before, so the audit row can say from what to what. */
  before?: ClubTodoItem;
};

function find(items: readonly ClubTodoItem[], id: string): ClubTodoItem {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new ClubTodoMissing(id);
  return item;
}

export function applyClubTodo(
  current: readonly ClubTodoItem[],
  op: ClubTodoOp,
  context: { now: Date; by: string; newId: () => string },
): ClubTodoResult {
  const items = sortClubTodo(current);
  switch (op.kind) {
    case "add": {
      if (items.length >= CLUB_TODO_MAX_ITEMS) throw new ClubTodoFull();
      const order = items.reduce((highest, item) => Math.max(highest, item.order), 0) + 1;
      const item: ClubTodoItem = {
        id: context.newId(),
        text: op.input.text,
        owner: op.input.owner,
        done: false,
        doneAt: null,
        by: null,
        createdAt: context.now.toISOString(),
        due: op.input.due,
        order,
      };
      return { items: [...items, item], item, changed: true };
    }
    case "edit": {
      const before = find(items, op.id);
      const item: ClubTodoItem = { ...before, text: op.input.text, owner: op.input.owner, due: op.input.due };
      const changed = item.text !== before.text || item.owner !== before.owner || item.due !== before.due;
      return { items: items.map((candidate) => (candidate.id === op.id ? item : candidate)), item, changed, before };
    }
    case "setDone": {
      const before = find(items, op.id);
      if (before.done === op.done) return { items, item: before, changed: false };
      const item: ClubTodoItem = op.done
        ? { ...before, done: true, doneAt: context.now.toISOString(), by: context.by }
        : { ...before, done: false, doneAt: null, by: null };
      return { items: items.map((candidate) => (candidate.id === op.id ? item : candidate)), item, changed: true };
    }
    case "move": {
      const item = find(items, op.id);
      /*
        Among the lines the reader is looking at: the open ones, narrowed to the same owner when
        the list is filtered — so "up" on a filtered list moves the line above the one the reader
        sees above it, not above a line of somebody else's that the filter hides.
      */
      const wanted = op.owner?.toLocaleLowerCase("ro");
      const visible = items.filter(
        (candidate) => !candidate.done && (wanted === undefined || candidate.owner?.toLocaleLowerCase("ro") === wanted),
      );
      const index = visible.findIndex((candidate) => candidate.id === op.id);
      const neighbour = index < 0 ? undefined : visible[op.direction === "up" ? index - 1 : index + 1];
      if (!neighbour) return { items, item, changed: false };
      const moved: ClubTodoItem = { ...item, order: neighbour.order };
      const swapped: ClubTodoItem = { ...neighbour, order: item.order };
      // Two lines with one order number (a hand-edited row) would swap into the same place:
      // renumber first, then swap, so a press always moves the line.
      if (moved.order === swapped.order) {
        const renumbered = items.map((candidate, position) => ({ ...candidate, order: position + 1 }));
        return applyClubTodo(renumbered, op, context);
      }
      const next = items.map((candidate) =>
        candidate.id === item.id ? moved : candidate.id === neighbour.id ? swapped : candidate,
      );
      return { items: sortClubTodo(next), item: moved, changed: true };
    }
    case "delete": {
      const item = find(items, op.id);
      return { items: items.filter((candidate) => candidate.id !== op.id), item, changed: true };
    }
  }
}
