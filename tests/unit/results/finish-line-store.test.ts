import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOCK_STORAGE_KEY, type FinishEntry, finishStorageKey, pressEntry, readStoredFinishLine, type StoredFinishLine, storedFinishLine } from "@/modules/results/domain/finish-line";

/**
 * §NNN — «Cronometrare»'s phone store (`results/ui/finish-line-store.ts`, BR-REQ-050-02): a second tab of the same event never writes
 * its copy over the first tab's waiting presses — every write reads the storage again first, and the browser's `storage` event brings
 * another tab's writes into this one's memory and tells its readers —; memory ahead of a storage that refused a write is not read
 * over; a page finds the viewer's presses waiting under another event, with that event's title; and without any storage the store
 * works from memory. The suite runs in Node: the window and its storage are fakes, and the module is loaded afresh for each test.
 */
const EVENT = "0b6f6c2e-5d1a-4c47-9a53-3f0d2b1c4e5f";
const OTHER = "7d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const KEY = finishStorageKey(EVENT);
const GUN = Date.UTC(2026, 10, 21, 7, 0, 0);

class FakeStorage {
  readonly map = new Map<string, string>();
  blocked = false;
  full = false;
  get length(): number {
    if (this.blocked) throw new Error("SecurityError");
    return this.map.size;
  }
  key(index: number): string | null {
    if (this.blocked) throw new Error("SecurityError");
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    if (this.blocked) throw new Error("SecurityError");
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked || this.full) throw new Error("QuotaExceededError");
    this.map.set(key, value);
  }
}

let storage: FakeStorage;
let handlers: Set<(event: { key: string | null; newValue: string | null; storageArea: unknown }) => void>;
let store: typeof import("@/modules/results/ui/finish-line-store");

beforeEach(async () => {
  storage = new FakeStorage();
  handlers = new Set();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (type: string, handler: never) => type === "storage" && handlers.add(handler),
    removeEventListener: (type: string, handler: never) => type === "storage" && handlers.delete(handler),
  });
  vi.resetModules();
  store = await import("@/modules/results/ui/finish-line-store");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (id: string, bibNumber: number, staffId = "vlad"): Omit<FinishEntry, "outcome"> => ({ id, staffId, bibNumber, label: null, pressedAtMs: GUN + bibNumber * 1000 });
const line = (entries: FinishEntry[], title: string | null = null): StoredFinishLine => ({ entries, kept: {}, title });
/** Another tab of the site writing a key: the storage changed, then the browser's `storage` event in this tab. */
function otherTabWrites(key: string, value: StoredFinishLine) {
  const raw = storedFinishLine(value);
  storage.map.set(key, raw);
  for (const handler of handlers) handler({ key, newValue: raw, storageArea: storage });
}
const ids = (value: StoredFinishLine) => value.entries.map((one) => one.id);

describe("§NNN a second tab of the same event", () => {
  it("never writes over the first tab's presses: every write changes what the storage holds now", () => {
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a1", 101)) }));
    // The second tab pressed 102 — its write reached the storage, its event not yet this tab.
    storage.map.set(KEY, storedFinishLine(line(pressEntry(readStoredFinishLine(storage.map.get(KEY)).entries, entry("b1", 102)))));
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a2", 103)) }));
    expect(ids(readStoredFinishLine(storage.map.get(KEY)))).toEqual(["a1", "b1", "a2"]);
    expect(ids(store.finishLineSnapshot(KEY))).toEqual(["a1", "b1", "a2"]);
  });

  it("brings what another tab wrote into this tab's memory and tells its readers", () => {
    const told = vi.fn();
    const unsubscribe = store.subscribeFinishLine(told);
    expect(store.finishLineSnapshot(KEY).entries).toEqual([]);
    otherTabWrites(KEY, line(pressEntry([], entry("b1", 102))));
    expect(ids(store.finishLineSnapshot(KEY))).toEqual(["b1"]);
    expect(told).toHaveBeenCalledTimes(1);
    // The clock's key, or any key that is no event's line, is nothing to tell.
    for (const handler of handlers) handler({ key: CLOCK_STORAGE_KEY, newValue: "{}", storageArea: storage });
    expect(told).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(handlers.size).toBe(0);
  });

  it("does not read the storage over memory that is ahead of it — a write it refused — and catches up once it takes one", () => {
    storage.full = true;
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a1", 101)) }));
    expect(storage.map.has(KEY)).toBe(false);
    storage.full = false;
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a2", 102)) }));
    expect(ids(readStoredFinishLine(storage.map.get(KEY)))).toEqual(["a1", "a2"]);
  });

  it("works from memory without any storage: nothing read, nothing thrown, nothing said of other events", () => {
    storage.blocked = true;
    expect(store.finishLineSnapshot(KEY)).toEqual(store.EMPTY_FINISH_LINE);
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a1", 101)) }));
    store.writeFinishLine(KEY, (current) => ({ ...current, entries: pressEntry(current.entries, entry("a2", 102)) }));
    expect(ids(store.finishLineSnapshot(KEY))).toEqual(["a1", "a2"]);
    expect(store.waitingElsewhereSnapshot(KEY, "vlad")).toEqual([]);
  });
});

describe("§NNN presses waiting under another event", () => {
  it("are the viewer's own waiting ones of every other event's line, with its title — not the clock, not this event's, not another account's", () => {
    storage.map.set(finishStorageKey(OTHER), storedFinishLine(line(pressEntry(pressEntry(pressEntry([], entry("o1", 7)), entry("o2", 8)), entry("r1", 9, "radu")), "Crosul Toamnei")));
    storage.map.set(KEY, storedFinishLine(line(pressEntry([], entry("a1", 101)))));
    storage.map.set(CLOCK_STORAGE_KEY, JSON.stringify({ offsetMs: 1, rttMs: 2, atServerMs: GUN }));
    const found = store.waitingElsewhereSnapshot(KEY, "vlad");
    expect(found).toEqual([{ eventId: OTHER, title: "Crosul Toamnei", count: 2 }]);
    // The same answer until something changes — a snapshot `useSyncExternalStore` may read on every render.
    expect(store.waitingElsewhereSnapshot(KEY, "vlad")).toBe(found);
    expect(store.waitingElsewhereSnapshot(KEY, "radu")).toEqual([{ eventId: OTHER, title: "Crosul Toamnei", count: 1 }]);
    // That event's page, in another tab, sent them: read again, nothing waits there any more.
    otherTabWrites(finishStorageKey(OTHER), line([], "Crosul Toamnei"));
    expect(store.waitingElsewhereSnapshot(KEY, "vlad")).toEqual([]);
  });
});
