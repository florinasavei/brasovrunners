import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * BR-REQ-054-01 criterion 12, BR-REQ-050-03 criterion 22 (`DECISIONS.md` §NNN) — the quality
 * beside the upload is remembered for the session, and a browser that refuses the store still
 * remembers it for the page.
 *
 * Found by re-review: the first version read `parseImageQuality(stored) ?? inMemory`, and
 * `parseImageQuality(null)` is the default — so in a private window, where every write throws
 * and every read answers nothing, «Înaltă» was chosen, shown for one render, and uploaded as
 * «Normală». Each case loads the module afresh, because its memory is the module's own.
 */
type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };

async function withStore(store: Store | "throws") {
  vi.resetModules();
  vi.stubGlobal("window", {
    get sessionStorage(): Store {
      if (store === "throws") throw new DOMException("blocked", "SecurityError");
      return store;
    },
  });
  return import("@/modules/media/ui/ImageQualityChoice");
}

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("§NNN the remembered quality", () => {
  it("starts on the recommendation and keeps a choice in the session's store", async () => {
    const store = memoryStore();
    const { readRemembered, rememberQuality } = await withStore(store);
    expect(readRemembered()).toBe("normal");
    rememberQuality("high");
    expect(readRemembered()).toBe("high");
    expect([...store.data.values()]).toEqual(["high"]);
  });

  it("reads a choice an earlier page of the same tab left in the store", async () => {
    const store = memoryStore();
    store.setItem("br.imageQuality", "high");
    const { readRemembered } = await withStore(store);
    expect(readRemembered()).toBe("high");
  });

  it("keeps the choice in the page's memory when every write throws and every read is empty", async () => {
    // A private window in some browsers: the store is there, reads nothing, refuses every write.
    const { readRemembered, rememberQuality } = await withStore({
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    rememberQuality("high");
    expect(readRemembered()).toBe("high");
    rememberQuality("normal");
    expect(readRemembered()).toBe("normal");
  });

  it("never reads back an older value once a write has failed", async () => {
    // The store holds «Înaltă» from before and then refuses the change to «Normală».
    const { readRemembered, rememberQuality } = await withStore({
      getItem: () => "high",
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    });
    rememberQuality("normal");
    expect(readRemembered()).toBe("normal");
  });

  it("keeps the choice in memory when the store itself cannot be reached, and ignores a value that is not a choice", async () => {
    const blocked = await withStore("throws");
    blocked.rememberQuality("high");
    expect(blocked.readRemembered()).toBe("high");

    const store = memoryStore();
    store.setItem("br.imageQuality", "ultra");
    const garbled = await withStore(store);
    expect(garbled.readRemembered()).toBe("normal");
  });
});
