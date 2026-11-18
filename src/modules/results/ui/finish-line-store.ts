import { readStoredFinishLine, type StoredFinishLine, storedFinishLine } from "../domain/finish-line";

/**
 * What «Cronometrare»'s island keeps on the phone for one event (§NNN): the presses — each with the staff account that pressed it —
 * and each account's kept times, behind one small store the island reads with `useSyncExternalStore` — the storage is an outside
 * system, read once per event on the phone and written on every change. **Every read and write of the storage is in a `try`**: a
 * private window, a full or blocked storage, and the page still works, the store holding the lines in memory and only forgetting them
 * on a reload. On the server — and in the first render after it, the hydration — the store is empty (`EMPTY_FINISH_LINE`), so the
 * page's markup is the same with storage or without.
 */
export const EMPTY_FINISH_LINE: StoredFinishLine = { entries: [], kept: {} };

const lines = new Map<string, StoredFinishLine>();
const listeners = new Set<() => void>();

export function subscribeFinishLine(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The line kept for `key`, read from the storage the first time it is asked for and from memory after. */
export function finishLineSnapshot(key: string): StoredFinishLine {
  let line = lines.get(key);
  if (!line) {
    try {
      line = readStoredFinishLine(window.localStorage.getItem(key));
    } catch {
      line = EMPTY_FINISH_LINE;
    }
    lines.set(key, line);
  }
  return line;
}

/** A change to the line kept for `key`: in memory at once, in the storage when it takes it, and every reader told. */
export function writeFinishLine(key: string, change: (line: StoredFinishLine) => StoredFinishLine): StoredFinishLine {
  const next = change(finishLineSnapshot(key));
  lines.set(key, next);
  try {
    window.localStorage.setItem(key, storedFinishLine(next));
  } catch {
    // Not kept past a reload; the page goes on from memory.
  }
  for (const listener of listeners) listener();
  return next;
}
