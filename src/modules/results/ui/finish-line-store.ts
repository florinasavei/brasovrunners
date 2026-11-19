import { eventIdOfStorageKey, readStoredFinishLine, type StoredFinishLine, storedFinishLine, waitingCount } from "../domain/finish-line";

/**
 * What «Cronometrare»'s island keeps on the phone for one event (§NNN): the presses — each with the staff account that pressed it —
 * each account's kept times and the event's title, behind one small store the island reads with `useSyncExternalStore` — the storage
 * is an outside system. **Every read and write of the storage is in a `try`**: a private window, a full or blocked storage, and the
 * page still works, the store holding the lines in memory and only forgetting them on a reload. On the server — and in the first
 * render after it, the hydration — the store is empty (`EMPTY_FINISH_LINE`), so the page's markup is the same with storage or without.
 *
 * **A second tab of the same event** (the review: it wrote its own copy over the first tab's waiting presses): every write reads the
 * storage again first and changes what it finds — another tab's presses included —, and the `storage` event, which the browser fires
 * in every other tab of the site, brings what another tab wrote into this one's memory and tells the readers. Only after the storage
 * refused this key's last write is memory written on as it is: it is then ahead of the storage, and reading the storage would lose a
 * press. **Another event's presses** waiting on the phone are found by their keys (`waitingElsewhereSnapshot`), so a page can say
 * where presses wait to be sent: only that event's page sends them.
 */
export const EMPTY_FINISH_LINE: StoredFinishLine = { entries: [], kept: {}, title: null };

/** Presses waiting under another event on this phone, the viewer's own: the event, its title as its page named it, and how many. */
export type WaitingElsewhere = { eventId: string; title: string | null; count: number };
export const NO_WAITING_ELSEWHERE: readonly WaitingElsewhere[] = [];

const lines = new Map<string, StoredFinishLine>();
/** The keys whose last write the storage refused: memory is ahead of the storage for them. */
const unsaved = new Set<string>();
const listeners = new Set<() => void>();
/** The last answer of `waitingElsewhereSnapshot`, for one page and viewer, until another tab writes. */
let elsewhere: { key: string; staffId: string; value: readonly WaitingElsewhere[] } | null = null;

function notifyReaders(): void {
  for (const listener of listeners) listener();
}

/** Another tab wrote — or cleared — this phone's storage: its lines are this tab's from now on, and every reader is told. */
function onStorage(event: StorageEvent): void {
  try {
    if (event.storageArea !== window.localStorage) return;
  } catch {
    return;
  }
  if (event.key === null) {
    // The whole storage cleared: what is not unsaved here is read again, empty.
    for (const key of [...lines.keys()]) if (!unsaved.has(key)) lines.delete(key);
  } else {
    if (eventIdOfStorageKey(event.key) === null) return;
    if (lines.has(event.key) && !unsaved.has(event.key)) lines.set(event.key, readStoredFinishLine(event.newValue));
  }
  elsewhere = null;
  notifyReaders();
}

export function subscribeFinishLine(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function readLine(key: string): StoredFinishLine {
  try {
    return readStoredFinishLine(window.localStorage.getItem(key));
  } catch {
    return lines.get(key) ?? EMPTY_FINISH_LINE;
  }
}

/** The line kept for `key`, read from the storage the first time it is asked for and from memory after — kept fresh by `storage`. */
export function finishLineSnapshot(key: string): StoredFinishLine {
  let line = lines.get(key);
  if (!line) {
    line = readLine(key);
    lines.set(key, line);
  }
  return line;
}

/**
 * A change to the line kept for `key`, made to what the storage holds now — a second tab's writes included — unless memory is ahead
 * of it; in memory at once, in the storage when it takes it, and every reader told.
 */
export function writeFinishLine(key: string, change: (line: StoredFinishLine) => StoredFinishLine): StoredFinishLine {
  const current = unsaved.has(key) ? finishLineSnapshot(key) : readLine(key);
  const next = change(current);
  lines.set(key, next);
  // Another event's line written from this tab (an island left behind by a navigation, still sending): what waits elsewhere changed.
  if (elsewhere && elsewhere.key !== key) elsewhere = null;
  try {
    window.localStorage.setItem(key, storedFinishLine(next));
    unsaved.delete(key);
  } catch {
    // Not kept past a reload; the page goes on from memory, which is now ahead of the storage.
    unsaved.add(key);
  }
  notifyReaders();
  return next;
}

/**
 * The viewer's own presses waiting under other events on this phone, by each event's key (`eventIdOfStorageKey`: the clock's key and
 * every other one left out), the line's title with each — read once for a page and viewer, and again after another tab writes.
 */
export function waitingElsewhereSnapshot(key: string, staffId: string): readonly WaitingElsewhere[] {
  if (elsewhere && elsewhere.key === key && elsewhere.staffId === staffId) return elsewhere.value;
  const found: WaitingElsewhere[] = [];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const other = storage.key(index);
      const eventId = other === null || other === key ? null : eventIdOfStorageKey(other);
      if (eventId === null || other === null) continue;
      const line = readStoredFinishLine(storage.getItem(other));
      const count = waitingCount(line.entries, staffId);
      if (count > 0) found.push({ eventId, title: line.title, count });
    }
  } catch {
    // No storage to look in: nothing is said.
  }
  found.sort((a, b) => a.eventId.localeCompare(b.eventId));
  elsewhere = { key, staffId, value: found.length === 0 ? NO_WAITING_ELSEWHERE : found };
  return elsewhere.value;
}
