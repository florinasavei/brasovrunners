import { describe, expect, it } from "vitest";
import {
  anchorAtLoad,
  anchorFromAnswer,
  clockReading,
  dropKept,
  ENTRIES_KEPT,
  entryStateOf,
  FINISH_CLAIM_AHEAD_MS,
  FINISH_UNDO_WINDOW_MS,
  FINISH_WINDOW_MS,
  type FinishEntry,
  finishStamp,
  finishStorageKey,
  isInstant,
  keepTime,
  KEPT_TIMES_MAX,
  mayUndo,
  nextToSend,
  pressEntry,
  RACE_GUN_CLAIM_TOLERANCE_MS,
  raceGunMoment,
  raceGunWindowOpen,
  readStoredFinishLine,
  serverNowOf,
  settleEntry,
  stampedGunTime,
  storedFinishLine,
  takeOldestKept,
  undoOpenUntil,
  waitingCount,
} from "@/modules/results/domain/finish-line";

/**
 * §NNN — «Cronometrare»'s pure parts (BR-REQ-050-02): the clock anchored on the server's, the stamp floored to the second and the
 * claimed time held to the server's bounds, «Start»'s window and its tap, «Anulează»'s ten minutes on one's own unchanged row, the
 * kept times oldest first, the queue in the order pressed, and the phone's storage read back tolerantly.
 */
const GUN = Date.UTC(2026, 10, 21, 7, 0, 0);
const at = (minutes: number, seconds = 0, ms = 0) => GUN + minutes * 60_000 + seconds * 1000 + ms;

describe("§NNN the clock anchored on the server's", () => {
  it("reads the server's clock through the anchor of the page, and of an answer at the middle of its round trip", () => {
    const loaded = anchorAtLoad(at(10), 5_000);
    expect(serverNowOf(loaded, 5_000)).toBe(at(10));
    expect(serverNowOf(loaded, 8_250)).toBe(at(10, 3, 250));
    // Sent at 100 ms, answered at 500 ms, the server read 10:20:00 somewhere between: at 300 ms is the best guess.
    const answered = anchorFromAnswer(at(20), 100, 500);
    expect(serverNowOf(answered, 300)).toBe(at(20));
    expect(serverNowOf(answered, 1_300)).toBe(at(20, 1));
    // A receipt before the send (a clock that cannot go back, but a test can) never puts the middle before the send.
    expect(anchorFromAnswer(at(20), 500, 100).localMs).toBe(500);
  });

  it("floors the time since the gun to the second, at least one second, and reads the clock as null before the gun", () => {
    expect(stampedGunTime(at(45, 12, 999), GUN)).toBe(at(45, 12) - GUN);
    expect(stampedGunTime(at(0, 0, 400), GUN)).toBe(1000);
    expect(stampedGunTime(GUN - 5000, GUN)).toBe(1000);
    expect(clockReading(at(5, 7, 600), GUN)).toBe(5 * 60_000 + 7000);
    expect(clockReading(GUN - 1, GUN)).toBeNull();
    expect(clockReading(GUN, GUN)).toBe(0);
  });
});

describe("§NNN the stamp: the claimed press within the server's bounds, else the server's own", () => {
  const now = at(50);

  it("keeps a claimed time from a second up to the server's own time plus five seconds, floored", () => {
    expect(finishStamp({ claimedAtMs: at(45, 12, 700), gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: at(45, 12) - GUN, claimed: true });
    expect(finishStamp({ claimedAtMs: now + FINISH_CLAIM_AHEAD_MS, gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: now + FINISH_CLAIM_AHEAD_MS - GUN, claimed: true });
    expect(finishStamp({ claimedAtMs: at(0, 1), gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: 1000, claimed: true });
  });

  it("takes its own time for a claim past now plus five seconds, under a second, before the gun, or no claim at all", () => {
    const own = { kind: "stamped", gunTimeMs: now - GUN, claimed: false };
    expect(finishStamp({ claimedAtMs: now + FINISH_CLAIM_AHEAD_MS + 1000, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: at(0, 0, 999), gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: GUN - 60_000, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: null, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: 1.5, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: Number.NaN, gunAtMs: GUN, nowMs: now })).toEqual(own);
  });

  it("refuses before the gun and past a day of it — unless the claim, taken within the day, says when the runner crossed", () => {
    expect(finishStamp({ claimedAtMs: null, gunAtMs: GUN, nowMs: GUN })).toEqual({ kind: "notStarted" });
    expect(finishStamp({ claimedAtMs: GUN - 1000, gunAtMs: GUN, nowMs: GUN - 500 })).toEqual({ kind: "notStarted" });
    const late = GUN + FINISH_WINDOW_MS + 61_000;
    expect(finishStamp({ claimedAtMs: null, gunAtMs: GUN, nowMs: late })).toEqual({ kind: "closed", gunTimeMs: FINISH_WINDOW_MS + 61_000 });
    // A press of 23:59:00 sent two minutes later is the runner's 23:59:00.
    const pressed = GUN + FINISH_WINDOW_MS - 60_000;
    expect(finishStamp({ claimedAtMs: pressed, gunAtMs: GUN, nowMs: pressed + 120_000 })).toEqual({ kind: "stamped", gunTimeMs: FINISH_WINDOW_MS - 60_000, claimed: true });
  });
});

describe("§NNN «Start»", () => {
  it("is pressed from three hours before the planned gun to six hours after", () => {
    expect(raceGunWindowOpen(GUN, GUN - 3 * 3_600_000)).toBe(true);
    expect(raceGunWindowOpen(GUN, GUN - 3 * 3_600_000 - 1)).toBe(false);
    expect(raceGunWindowOpen(GUN, GUN + 6 * 3_600_000)).toBe(true);
    expect(raceGunWindowOpen(GUN, GUN + 6 * 3_600_000 + 1)).toBe(false);
  });

  it("is the tap the island claims within thirty seconds of the server's clock, else the server's own", () => {
    expect(raceGunMoment(GUN - 2_500, GUN)).toBe(GUN - 2_500);
    expect(raceGunMoment(GUN + RACE_GUN_CLAIM_TOLERANCE_MS, GUN)).toBe(GUN + RACE_GUN_CLAIM_TOLERANCE_MS);
    expect(raceGunMoment(GUN - RACE_GUN_CLAIM_TOLERANCE_MS - 1, GUN)).toBe(GUN);
    expect(raceGunMoment(null, GUN)).toBe(GUN);
    expect(raceGunMoment(-5, GUN)).toBe(GUN);
  });
});

describe("§NNN «Anulează»: one's own row, written once, for ten minutes", () => {
  const written = new Date(at(45));
  const mine = { status: "FINISHED", createdAt: written, updatedAt: written, updatedByStaffUserId: "me" };

  it("opens for ten minutes after the row was written, for its writer alone", () => {
    expect(undoOpenUntil(mine, "me")).toBe(at(45) + FINISH_UNDO_WINDOW_MS);
    expect(mayUndo(mine, "me", at(55))).toBe(true);
    expect(mayUndo(mine, "me", at(55, 0, 1))).toBe(false);
    expect(undoOpenUntil(mine, "someone else")).toBeNull();
  });

  it("is closed on a row changed since it was written, and on one that is not «Sosit»", () => {
    expect(undoOpenUntil({ ...mine, updatedAt: new Date(at(46)) }, "me")).toBeNull();
    expect(undoOpenUntil({ ...mine, status: "DNF" }, "me")).toBeNull();
    expect(undoOpenUntil({ ...mine, updatedByStaffUserId: null }, "me")).toBeNull();
  });
});

describe("§NNN «⏱ Prinde timpul»: kept times, oldest first", () => {
  it("keeps each press, gives the oldest to the next number, drops one by its ✕, and stops at the most it holds", () => {
    let kept = keepTime([], at(10));
    kept = keepTime(kept, at(10, 2));
    kept = keepTime(kept, at(10, 3));
    expect(kept).toEqual([at(10), at(10, 2), at(10, 3)]);
    const taken = takeOldestKept(kept);
    expect(taken).toEqual({ atMs: at(10), rest: [at(10, 2), at(10, 3)] });
    expect(takeOldestKept([])).toEqual({ atMs: null, rest: [] });
    expect(dropKept(taken.rest, 0)).toEqual([at(10, 3)]);
    const full = Array.from({ length: KEPT_TIMES_MAX }, (_, index) => at(1, index));
    expect(keepTime(full, at(30))).toEqual(full);
  });
});

describe("§NNN the queue: in the order pressed, answered once, the waiting ones never dropped", () => {
  const entry = (id: string, bibNumber: number, pressedAtMs: number) => ({ id, bibNumber, label: null, pressedAtMs });

  it("sends the oldest waiting first, settles each once, and counts what waits", () => {
    let entries: FinishEntry[] = [];
    entries = pressEntry(entries, entry("a", 101, at(40)));
    entries = pressEntry(entries, entry("b", 102, at(40, 5)));
    entries = pressEntry(entries, entry("c", 103, at(40, 6)));
    expect(waitingCount(entries)).toBe(3);
    expect(nextToSend(entries)?.id).toBe("a");
    entries = settleEntry(entries, "a", { kind: "recorded", bibNumber: 101, name: "Ana", label: null, gunTimeMs: 2_400_000, positionOverall: 1, outOfRanking: false, again: false });
    expect(nextToSend(entries)?.id).toBe("b");
    expect(entryStateOf(entries[0])).toBe("saved");
    // An answer for an entry already answered changes nothing.
    const again = settleEntry(entries, "a", { kind: "refused", code: "NOT_FOUND", bibNumber: 101, gunTimeMs: null });
    expect(entryStateOf(again[0])).toBe("saved");
    entries = settleEntry(entries, "b", { kind: "duplicate", bibNumber: 102, name: null, label: null, gunTimeMs: 2_405_000, storedGunTimeMs: 2_401_000, storedBy: "Vlad" });
    entries = settleEntry(entries, "c", { kind: "refused", code: "RESULT_BIB_UNKNOWN", bibNumber: 103, gunTimeMs: 2_406_000 });
    expect(entries.map(entryStateOf)).toEqual(["saved", "duplicate", "refused"]);
    expect(nextToSend(entries)).toBeUndefined();
    expect(waitingCount(entries)).toBe(0);
  });

  it("keeps the newest answered lines past the limit and every waiting one", () => {
    let entries: FinishEntry[] = [pressEntry([], entry("waiting", 999, at(1)))[0]];
    for (let index = 0; index < ENTRIES_KEPT + 5; index += 1) {
      entries = pressEntry(entries, entry(`e${index}`, index + 1, at(2, index)));
      entries = settleEntry(entries, `e${index}`, { kind: "refused", code: "NOT_FOUND", bibNumber: index + 1, gunTimeMs: null });
    }
    expect(entries.filter((one) => one.outcome !== null)).toHaveLength(ENTRIES_KEPT);
    expect(entries[0].id).toBe("waiting");
    expect(entries.at(-1)?.id).toBe(`e${ENTRIES_KEPT + 4}`);
    expect(entries.some((one) => one.id === "e0")).toBe(false);
  });
});

describe("§NNN the phone's storage", () => {
  it("is one key per event, written and read back whole", () => {
    expect(finishStorageKey("abc")).toBe("finish-line:abc");
    const entries = settleEntry(pressEntry([], { id: "a", bibNumber: 7, label: "Andrei", pressedAtMs: at(3) }), "a", {
      kind: "duplicate",
      bibNumber: 7,
      name: "Andrei Pop",
      label: "Andrei",
      gunTimeMs: 180_000,
      storedGunTimeMs: 179_000,
      storedBy: null,
    });
    const line = { entries: pressEntry(entries, { id: "b", bibNumber: 8, label: null, pressedAtMs: at(4) }), kept: [at(5)] };
    expect(readStoredFinishLine(storedFinishLine(line))).toEqual(line);
  });

  it("reads nothing, broken JSON, another shape and every malformed entry or kept time as left out, never thrown", () => {
    const empty = { entries: [], kept: [] };
    expect(readStoredFinishLine(null)).toEqual(empty);
    expect(readStoredFinishLine("{not json")).toEqual(empty);
    expect(readStoredFinishLine("42")).toEqual(empty);
    const raw = JSON.stringify({
      entries: [
        { id: "ok", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null },
        { id: "ok", bibNumber: 6, label: null, pressedAtMs: at(1), outcome: null },
        { id: "no-number", bibNumber: 0, pressedAtMs: at(1), outcome: null },
        { id: "no-time", bibNumber: 5, pressedAtMs: "soon", outcome: null },
        { id: "odd-outcome", bibNumber: 5, pressedAtMs: at(1), outcome: { kind: "magic" } },
        "a string",
      ],
      kept: [at(2), "x", -4, at(3)],
    });
    expect(readStoredFinishLine(raw)).toEqual({ entries: [{ id: "ok", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null }], kept: [at(2), at(3)] });
    expect(isInstant(at(1))).toBe(true);
    expect(isInstant(0)).toBe(false);
  });
});
