import { z } from "zod";
import { canReadContent, type StaffRole } from "@/modules/staff-identity/domain/roles";

/**
 * «De făcut» — the club's hand-kept checklist on `/admin/tasks` (§438), unlike the system-read
 * «Club» panel (§41, §149). The whole list is JSON in one `platform_settings` row (§100): a few
 * dozen lines need no table or migration. Pure; `club-todo.ts` is the one writer.
 */

export const CLUB_TODO_SETTING_KEY = "clubTodo";
/**
 * The audit rows' fixed id, unique per setting (`tests/unit/settings/entity-ids.test.ts`). Rows
 * before §483 carry `…e00b`, shared with the budget thresholds; `action` tells them apart.
 */
export const CLUB_TODO_ENTITY_ID = "00000000-0000-4000-8000-00000000e00f";

/** A line is a sentence or a short paragraph — the longest starting item is about 700 characters. */
export const CLUB_TODO_TEXT_MAX = 2000;
/** «Pentru cine»: a first name or two, never an address. */
export const CLUB_TODO_OWNER_MAX = 40;
/** Bounds one settings row against a runaway script. */
export const CLUB_TODO_MAX_ITEMS = 300;

// ---------------------------------------------------------------------------------------------
// Who may read and who may write (BR-REQ-060-01: asserted by the service, not by a hidden button)
// ---------------------------------------------------------------------------------------------

/** Every role that reads content (§208); the volunteer gets a 404 (§103). */
export function canReadClubTodo(role: StaffRole): boolean {
  return canReadContent(role);
}

/**
 * A set, not a threshold, like `canReadRegistrations` (§289): `DEV` outranks the Organizer only
 * for `/devs`, and this list is the club's.
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
    /** «Pentru cine»: free text — the roles are offered, anything else is kept. */
    owner: z.string().min(1).max(CLUB_TODO_OWNER_MAX).nullable(),
    done: z.boolean(),
    /** ISO instant; null while open. */
    doneAt: z.string().nullable(),
    /** The ticker's display name at the time; null while open. */
    by: z.string().max(200).nullable(),
    createdAt: z.string(),
    due: z.string().refine(isCalendarDay).nullable(),
    /** Ascending; only relative values matter. */
    order: z.number().int(),
  })
  .strict();

export type ClubTodoItem = z.infer<typeof clubTodoItemSchema>;

/**
 * Drops an unreadable line rather than the list, and never falls back to the starting list —
 * that would revive lines somebody deleted.
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

/**
 * `seenDefaults` (§538): starting-line ids already given, so a deleted one never returns. Null on
 * an older row — `mergeClubTodoDefaults` reads that as §438's first nineteen.
 */
export function readClubTodoSeenDefaults(value: unknown): string[] | null {
  const raw = value && typeof value === "object" ? (value as { seenDefaults?: unknown }).seenDefaults : undefined;
  if (!Array.isArray(raw)) return null;
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64);
}

// ---------------------------------------------------------------------------------------------
// What a form posts
// ---------------------------------------------------------------------------------------------

/** Blank owner or day means none. Keys are the form's `name`s, so a refusal links to the box (§47). */
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

/** `createdAt`, then the id, break ties so the order is total. */
export function sortClubTodo(items: readonly ClubTodoItem[]): ClubTodoItem[] {
  return [...items].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** The tab label's count, over the whole list whatever the filter. */
export function openClubTodoCount(items: readonly ClubTodoItem[]): number {
  return items.filter((item) => !item.done).length;
}

/** The filter's chips: each owner once, in list order. */
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

/** `?for=` as the list spells it, or undefined ("everybody") for an unknown name (§150). */
export function resolveClubTodoOwner(items: readonly ClubTodoItem[], requested: string | undefined): string | undefined {
  if (!requested) return undefined;
  const wanted = requested.trim().toLocaleLowerCase("ro");
  return clubTodoOwners(items).find((owner) => owner.toLocaleLowerCase("ro") === wanted);
}

/** Owners compare without case. */
export function filterClubTodo(items: readonly ClubTodoItem[], owner: string | undefined): ClubTodoItem[] {
  const sorted = sortClubTodo(items);
  if (!owner) return sorted;
  const wanted = owner.toLocaleLowerCase("ro");
  return sorted.filter((item) => item.owner?.toLocaleLowerCase("ro") === wanted);
}

/** `today` is the club's calendar day. */
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
  /** After the operation (before it, for a delete). */
  item: ClubTodoItem;
  changed: boolean;
  /** Edits only, for the audit row's from/to. */
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
      // Among the visible lines only (open, same owner when filtered), so "up" passes the line the reader sees.
      const wanted = op.owner?.toLocaleLowerCase("ro");
      const visible = items.filter(
        (candidate) => !candidate.done && (wanted === undefined || candidate.owner?.toLocaleLowerCase("ro") === wanted),
      );
      const index = visible.findIndex((candidate) => candidate.id === op.id);
      const neighbour = index < 0 ? undefined : visible[op.direction === "up" ? index - 1 : index + 1];
      if (!neighbour) return { items, item, changed: false };
      const moved: ClubTodoItem = { ...item, order: neighbour.order };
      const swapped: ClubTodoItem = { ...neighbour, order: item.order };
      // Equal orders (a hand-edited row) would swap in place: renumber first.
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
