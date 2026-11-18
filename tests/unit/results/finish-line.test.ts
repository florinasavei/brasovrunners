import { describe, expect, it } from "vitest";
import {
  betterSample,
  CLOCK_SAMPLE_KEPT_MS,
  type ClockSample,
  clockReading,
  dropKept,
  ENTRIES_KEPT,
  entryStateOf,
  FINISH_ARRIVAL_GRACE_MS,
  FINISH_CLAIM_AHEAD_MS,
  FINISH_UNDO_WINDOW_MS,
  FINISH_WINDOW_MS,
  type FinishEntry,
  finishStamp,
  finishStorageKey,
  isInstant,
  keepTime,
  keptOf,
  KEPT_TIMES_MAX,
  type LineTrailRow,
  mayUndo,
  nextToSend,
  pressEntry,
  pressMeets,
  RACE_GUN_CLAIM_TOLERANCE_MS,
  raceGunMoment,
  raceGunWindowOpen,
  readStoredClockSample,
  readStoredFinishLine,
  sampleOfPage,
  sampleOfRoundTrip,
  serverNowAt,
  settleEntry,
  stampedGunTime,
  storedClockSample,
  storedFinishLine,
  takeOldestKept,
  undoClosedBy,
  undoOpenUntil,
  undoTrailOf,
  waitingCount,
  withKept,
} from "@/modules/results/domain/finish-line";

/**
 * §NNN — «Cronometrare»'s pure parts (BR-REQ-050-02): the server's clock read through the phone's wall clock and an offset measured
 * over round trips, the best sample kept; the stamp floored to the second, the claimed time held to the server's bounds and a press
 * arriving after the day and its grace refused; what a press does to a stored row; «Start»'s window and its tap; «Anulează»'s ten
 * minutes on one's own press at the line, unchanged and not pressed again; the kept times oldest first, each account's own; the
 * queue in the order pressed, each account sending its own; and the phone's storage read back tolerantly.
 */
const GUN = Date.UTC(2026, 10, 21, 7, 0, 0);
const at = (minutes: number, seconds = 0, ms = 0) => GUN + minutes * 60_000 + seconds * 1000 + ms;

describe("§NNN the server's clock: the phone's wall clock and a measured offset", () => {
  it("reads the page's own reading against the wall clock as the island woke, and the phone's own clock while nothing is known", () => {
    const page = sampleOfPage(at(10), 5_000);
    expect(page).toEqual({ offsetMs: at(10) - 5_000, rttMs: null, atServerMs: at(10) });
    expect(serverNowAt(page, 5_000)).toBe(at(10));
    // The wall clock keeps time while the screen is locked: twenty minutes asleep are twenty minutes on the server's clock.
    expect(serverNowAt(page, 5_000 + 20 * 60_000 + 250)).toBe(at(30, 0, 250));
    expect(serverNowAt(null, 1_234)).toBe(1_234);
  });

  it("measures a round trip as NTP does: the middle of the two legs, the round trip without the server's own work", () => {
    // The phone is 3 s behind the server. Sent at its 100, arrived at the server's 3_150, answered at 3_350, back at its 500.
    const phone = (serverMs: number) => serverMs - 3_000;
    const sample = sampleOfRoundTrip({ sentAtMs: 100, receivedAtMs: 3_150, answeredAtMs: 3_350, backAtMs: 500 });
    expect(sample).toEqual({ offsetMs: 2_950, rttMs: 200, atServerMs: 3_350 });
    // Symmetric legs give the offset exactly: 150 ms up, 200 ms on the server, 150 ms down.
    expect(sampleOfRoundTrip({ sentAtMs: phone(10_000), receivedAtMs: 10_150, answeredAtMs: 10_350, backAtMs: phone(10_500) })).toEqual({ offsetMs: 3_000, rttMs: 300, atServerMs: 10_350 });
    // A trip the phone's clock moved back under — a receipt before the send, a wait shorter than the server's work — is no sample.
    expect(sampleOfRoundTrip({ sentAtMs: 500, receivedAtMs: 3_150, answeredAtMs: 3_350, backAtMs: 100 })).toBeNull();
    expect(sampleOfRoundTrip({ sentAtMs: 100, receivedAtMs: 3_000, answeredAtMs: 4_000, backAtMs: 300 })).toBeNull();
    expect(sampleOfRoundTrip({ sentAtMs: Number.NaN, receivedAtMs: 3_000, answeredAtMs: 3_100, backAtMs: 300 })).toBeNull();
  });

  it("keeps a measured sample over the page's reading, the shorter round trip of two that agree, and the newer of two that disagree", () => {
    const page: ClockSample = { offsetMs: 2_000, rttMs: null, atServerMs: at(1) };
    const quick: ClockSample = { offsetMs: 3_010, rttMs: 120, atServerMs: at(2) };
    const slow: ClockSample = { offsetMs: 3_400, rttMs: 900, atServerMs: at(3) };
    expect(betterSample(null, page)).toBe(page);
    expect(betterSample(page, quick)).toBe(quick);
    // The page's reading — an old page drawn again after a back navigation — never replaces a measured one…
    expect(betterSample(quick, { ...page, atServerMs: at(9) })).toBe(quick);
    // …and of two page readings the newer counts.
    expect(betterSample(page, { ...page, offsetMs: 2_500, atServerMs: at(5) }).offsetMs).toBe(2_500);
    // A slow answer that agrees with the quick one is the worse known: the quick one stays.
    expect(betterSample(quick, slow)).toBe(quick);
    expect(betterSample(slow, quick)).toBe(quick);
    // The phone's clock moved by a minute: the samples disagree, and the newer one is the clock now.
    const moved: ClockSample = { offsetMs: 63_000, rttMs: 400, atServerMs: at(4) };
    expect(betterSample(quick, moved)).toBe(moved);
    expect(betterSample(moved, { ...quick, atServerMs: at(1) })).toBe(moved);
  });

  it("keeps a measured sample on the phone for half a day, read back tolerantly", () => {
    const sample: ClockSample = { offsetMs: 2_950, rttMs: 200, atServerMs: at(10) };
    const wall = (serverMs: number) => serverMs - 2_950;
    expect(readStoredClockSample(storedClockSample(sample), wall(at(70)))).toEqual(sample);
    expect(readStoredClockSample(storedClockSample(sample), wall(at(10) + CLOCK_SAMPLE_KEPT_MS + 1))).toBeNull();
    // A sample from the phone's future — its clock moved back by more than half a day — is none either.
    expect(readStoredClockSample(storedClockSample(sample), wall(at(10) - CLOCK_SAMPLE_KEPT_MS - 1))).toBeNull();
    for (const raw of [null, "", "{not json", "42", JSON.stringify({ offsetMs: 1, rttMs: null, atServerMs: at(1) }), JSON.stringify({ offsetMs: "1", rttMs: 3, atServerMs: at(1) })]) {
      expect(readStoredClockSample(raw, wall(at(11))), String(raw)).toBeNull();
    }
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

  it("refuses a press arriving after the day and its grace whatever it claims: a queue left for days is «Clasament»'s", () => {
    const claimed = at(12, 3);
    expect(finishStamp({ claimedAtMs: claimed, gunAtMs: GUN, nowMs: GUN + FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS })).toEqual({ kind: "stamped", gunTimeMs: at(12, 3) - GUN, claimed: true });
    const late = GUN + FINISH_WINDOW_MS + FINISH_ARRIVAL_GRACE_MS + 1000;
    expect(finishStamp({ claimedAtMs: claimed, gunAtMs: GUN, nowMs: late })).toEqual({ kind: "closed", gunTimeMs: late - GUN });
    expect(finishStamp({ claimedAtMs: claimed, gunAtMs: GUN, nowMs: GUN + 30 * 24 * 3_600_000 })).toMatchObject({ kind: "closed" });
  });
});

describe("§NNN what a press does to the stored row of its number", () => {
  const written = new Date(at(40));
  const row = (status: string, by = "vlad", gunTimeMs: number | null = at(40) - GUN) => ({ status, gunTimeMs, updatedAt: written, updatedByStaffUserId: by });
  const press = (atMs: number, actorId = "radu", gunTimeMs = atMs - GUN) => ({ actorId, gunTimeMs, atMs });

  it("is a retry for the same viewer at the same second, and a press again for anybody else or another second", () => {
    expect(pressMeets(row("FINISHED"), press(at(40), "vlad"))).toBe("retry");
    expect(pressMeets(row("FINISHED"), press(at(40, 2), "vlad"))).toBe("pressedAgain");
    expect(pressMeets(row("FINISHED"), press(at(40)))).toBe("pressedAgain");
  });

  it("leaves «Descalificat» as it is, whenever pressed, and a written-off runner decided after the moment pressed", () => {
    expect(pressMeets(row("DSQ", "oana", null), press(at(55)))).toBe("decided");
    expect(pressMeets(row("DSQ", "oana", null), press(at(39)))).toBe("decided");
    // «Abandon» saved at 40:00; a press claimed at 39:58 — queued on a phone, or a second volunteer — must not overwrite it.
    expect(pressMeets(row("DNF", "oana", null), press(at(39, 58)))).toBe("decided");
    expect(pressMeets(row("DNS", "oana", null), press(at(39, 58)))).toBe("decided");
  });

  it("turns «Abandon» or «Neprezentat» written before the moment pressed: a runner written off by mistake, crossing the line", () => {
    expect(pressMeets(row("DNF", "oana", null), press(at(40)))).toBe("turned");
    expect(pressMeets(row("DNS", "oana", null), press(at(55)))).toBe("turned");
  });
});

describe("§NNN «Start»", () => {
  it("is pressed from three hours before the planned gun to six hours after", () => {
    expect(raceGunWindowOpen(GUN, GUN - 3 * 3_600_000)).toBe(true);
    expect(raceGunWindowOpen(GUN, GUN - 3 * 3_600_000 - 1)).toBe(false);
    expect(raceGunWindowOpen(GUN, GUN + 6 * 3_600_000)).toBe(true);
    expect(raceGunWindowOpen(GUN, GUN + 6 * 3_600_000 + 1)).toBe(false);
  });

  it("is the tap the island claims when the server hears it at most ten seconds later and it is at most five seconds ahead, else the server's own", () => {
    expect(RACE_GUN_CLAIM_TOLERANCE_MS).toBe(10_000);
    expect(raceGunMoment(GUN - 2_500, GUN)).toBe(GUN - 2_500);
    expect(raceGunMoment(GUN - RACE_GUN_CLAIM_TOLERANCE_MS, GUN)).toBe(GUN - RACE_GUN_CLAIM_TOLERANCE_MS);
    expect(raceGunMoment(GUN - RACE_GUN_CLAIM_TOLERANCE_MS - 1, GUN)).toBe(GUN);
    // A page whose clock was a sleep behind — the half minute the tap could once carry — is no tap of this press.
    expect(raceGunMoment(GUN - 25_000, GUN)).toBe(GUN);
    expect(raceGunMoment(GUN + FINISH_CLAIM_AHEAD_MS, GUN)).toBe(GUN + FINISH_CLAIM_AHEAD_MS);
    expect(raceGunMoment(GUN + FINISH_CLAIM_AHEAD_MS + 1, GUN)).toBe(GUN);
    expect(raceGunMoment(null, GUN)).toBe(GUN);
    expect(raceGunMoment(-5, GUN)).toBe(GUN);
  });
});

describe("§NNN «Anulează»: one's own press at the line, written once, not pressed again, for ten minutes", () => {
  const written = new Date(at(45));
  const mine = { id: "row-1", status: "FINISHED", createdAt: written, updatedAt: written, updatedByStaffUserId: "me" };
  const created: LineTrailRow = { action: "event_result.created", actorStaffUserId: "me", metadata: { bibNumber: 101, finishLine: true, resultId: "row-1" } };
  const again = (actor: string, storedResultId = "row-1"): LineTrailRow => ({ action: "event_result.finish_duplicate", actorStaffUserId: actor, metadata: { bibNumber: 101, storedResultId, finishLine: true } });
  const atLine = undoTrailOf(mine, [created]);

  it("reads from the trail whether a press at the line wrote the row, and whether its number was pressed again — by whom", () => {
    expect(atLine).toEqual({ pressedAtLine: true, pressedAgain: null });
    // A «Clasament» save writes its row with no `finishLine`, an import too; another row's trail is not this one's.
    expect(undoTrailOf(mine, [{ ...created, metadata: { bibNumber: 101, status: "FINISHED" } }])).toEqual({ pressedAtLine: false, pressedAgain: null });
    expect(undoTrailOf(mine, [{ ...created, metadata: { bibNumber: 101, finishLine: true, resultId: "row-2" } }, again("radu", "row-2")])).toEqual({ pressedAtLine: false, pressedAgain: null });
    expect(undoTrailOf(mine, [created, again("radu")]).pressedAgain).toBe("other");
    expect(undoTrailOf(mine, [created, again("me")]).pressedAgain).toBe("self");
    expect(undoTrailOf(mine, [created, again("me"), again("radu")]).pressedAgain).toBe("other");
    expect(undoTrailOf(mine, [{ action: "event_result.created", actorStaffUserId: "me", metadata: "not an object" }]).pressedAtLine).toBe(false);
  });

  it("opens for ten minutes after the row was written, for its writer alone", () => {
    expect(undoOpenUntil(mine, "me", atLine)).toBe(at(45) + FINISH_UNDO_WINDOW_MS);
    expect(mayUndo(mine, "me", atLine, at(55))).toBe(true);
    expect(mayUndo(mine, "me", atLine, at(55, 0, 1))).toBe(false);
    expect(undoOpenUntil(mine, "someone else", atLine)).toBeNull();
  });

  it("is closed on a row changed since it was written, one that is not «Sosit», one «Clasament» wrote, and one whose number was pressed again", () => {
    expect(undoOpenUntil({ ...mine, updatedAt: new Date(at(46)) }, "me", atLine)).toBeNull();
    expect(undoOpenUntil({ ...mine, status: "DNF" }, "me", atLine)).toBeNull();
    expect(undoOpenUntil({ ...mine, updatedByStaffUserId: null }, "me", atLine)).toBeNull();
    expect(undoOpenUntil(mine, "me", { pressedAtLine: false, pressedAgain: null })).toBeNull();
    expect(undoOpenUntil(mine, "me", { pressedAtLine: true, pressedAgain: "other" })).toBeNull();
    expect(undoOpenUntil(mine, "me", { pressedAtLine: true, pressedAgain: "self" })).toBeNull();
  });

  it("says why one's own press of the last ten minutes has no «Anulează» — pressed again — and nothing for anybody else's or after ten minutes", () => {
    const pressedAgain = { pressedAtLine: true, pressedAgain: "other" as const };
    expect(undoClosedBy(mine, "me", pressedAgain, at(50))).toBe("other");
    expect(undoClosedBy(mine, "me", { pressedAtLine: true, pressedAgain: "self" }, at(50))).toBe("self");
    expect(undoClosedBy(mine, "me", atLine, at(50))).toBeNull();
    expect(undoClosedBy(mine, "radu", pressedAgain, at(50))).toBeNull();
    expect(undoClosedBy(mine, "me", pressedAgain, at(55, 0, 1))).toBeNull();
    expect(undoClosedBy(mine, "me", { pressedAtLine: false, pressedAgain: "other" }, at(50))).toBeNull();
  });
});

describe("§NNN «⏱ Prinde timpul»: kept times, oldest first, each account's own", () => {
  it("keeps the kept times of each staff account apart on the phone's line", () => {
    let line = withKept({ entries: [], kept: {} }, "vlad", [at(10), at(10, 2)]);
    line = withKept(line, "radu", [at(11)]);
    expect(keptOf(line, "vlad")).toEqual([at(10), at(10, 2)]);
    expect(keptOf(line, "radu")).toEqual([at(11)]);
    expect(keptOf(line, "oana")).toEqual([]);
    expect(withKept(line, "vlad", []).kept).toEqual({ radu: [at(11)] });
  });

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

describe("§NNN the queue: in the order pressed, answered once, the waiting ones never dropped, each account sending its own", () => {
  const entry = (id: string, bibNumber: number, pressedAtMs: number, staffId = "vlad") => ({ id, staffId, bibNumber, label: null, pressedAtMs });
  const stateOf = (one: FinishEntry) => entryStateOf(one, "vlad");

  it("sends the oldest waiting first, settles each once, and counts what waits", () => {
    let entries: FinishEntry[] = [];
    entries = pressEntry(entries, entry("a", 101, at(40)));
    entries = pressEntry(entries, entry("b", 102, at(40, 5)));
    entries = pressEntry(entries, entry("c", 103, at(40, 6)));
    expect(waitingCount(entries, "vlad")).toBe(3);
    expect(nextToSend(entries, "vlad")?.id).toBe("a");
    entries = settleEntry(entries, "a", { kind: "recorded", bibNumber: 101, name: "Ana", label: null, gunTimeMs: 2_400_000, positionOverall: 1, outOfRanking: false, again: false });
    expect(nextToSend(entries, "vlad")?.id).toBe("b");
    expect(stateOf(entries[0])).toBe("saved");
    // An answer for an entry already answered changes nothing.
    const again = settleEntry(entries, "a", { kind: "refused", code: "NOT_FOUND", bibNumber: 101, gunTimeMs: null });
    expect(stateOf(again[0])).toBe("saved");
    entries = settleEntry(entries, "b", { kind: "duplicate", bibNumber: 102, name: null, label: null, gunTimeMs: 2_405_000, storedStatus: "FINISHED", storedGunTimeMs: 2_401_000, storedBy: "Vlad" });
    entries = settleEntry(entries, "c", { kind: "refused", code: "RESULT_BIB_UNKNOWN", bibNumber: 103, gunTimeMs: 2_406_000 });
    expect(entries.map(stateOf)).toEqual(["saved", "duplicate", "refused"]);
    expect(nextToSend(entries, "vlad")).toBeUndefined();
    expect(waitingCount(entries, "vlad")).toBe(0);
  });

  it("sends only the viewer's own: another account's press left on the phone is shown unsent, never sent under this one", () => {
    let entries: FinishEntry[] = [];
    entries = pressEntry(entries, entry("vlad-1", 101, at(40), "vlad"));
    entries = pressEntry(entries, entry("radu-1", 102, at(40, 3), "radu"));
    expect(nextToSend(entries, "radu")?.id).toBe("radu-1");
    expect(waitingCount(entries, "radu")).toBe(1);
    expect(entries.map((one) => entryStateOf(one, "radu"))).toEqual(["otherAccount", "waiting"]);
    entries = settleEntry(entries, "radu-1", { kind: "recorded", bibNumber: 102, name: null, label: null, gunTimeMs: 2_403_000, positionOverall: 1, outOfRanking: false, again: false });
    expect(nextToSend(entries, "radu")).toBeUndefined();
    // Vlad signs in again on the phone: his press goes.
    expect(nextToSend(entries, "vlad")?.id).toBe("vlad-1");
  });

  it("keeps the newest answered lines past the limit and every waiting one, whoever's", () => {
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
    const entries = settleEntry(pressEntry([], { id: "a", staffId: "vlad", bibNumber: 7, label: "Andrei", pressedAtMs: at(3) }), "a", {
      kind: "duplicate",
      bibNumber: 7,
      name: "Andrei Pop",
      label: "Andrei",
      gunTimeMs: 180_000,
      storedStatus: "FINISHED",
      storedGunTimeMs: 179_000,
      storedBy: null,
    });
    const decided = settleEntry(pressEntry(entries, { id: "b", staffId: "vlad", bibNumber: 8, label: null, pressedAtMs: at(4) }), "b", {
      kind: "duplicate",
      bibNumber: 8,
      name: null,
      label: null,
      gunTimeMs: 240_000,
      storedStatus: "DSQ",
      storedGunTimeMs: null,
      storedBy: "Oana",
    });
    const line = { entries: pressEntry(decided, { id: "c", staffId: "radu", bibNumber: 9, label: null, pressedAtMs: at(5) }), kept: { vlad: [at(5)] } };
    expect(readStoredFinishLine(storedFinishLine(line))).toEqual(line);
  });

  it("reads nothing, broken JSON, another shape and every malformed entry or kept time as left out, never thrown", () => {
    const empty = { entries: [], kept: {} };
    expect(readStoredFinishLine(null)).toEqual(empty);
    expect(readStoredFinishLine("{not json")).toEqual(empty);
    expect(readStoredFinishLine("42")).toEqual(empty);
    const raw = JSON.stringify({
      entries: [
        { id: "ok", staffId: "vlad", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null },
        { id: "ok", staffId: "vlad", bibNumber: 6, label: null, pressedAtMs: at(1), outcome: null },
        { id: "nobody", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null },
        { id: "no-number", staffId: "vlad", bibNumber: 0, pressedAtMs: at(1), outcome: null },
        { id: "no-time", staffId: "vlad", bibNumber: 5, pressedAtMs: "soon", outcome: null },
        { id: "odd-outcome", staffId: "vlad", bibNumber: 5, pressedAtMs: at(1), outcome: { kind: "magic" } },
        "a string",
      ],
      kept: { vlad: [at(2), "x", -4, at(3)], radu: "soon", "": [at(4)] },
    });
    expect(readStoredFinishLine(raw)).toEqual({ entries: [{ id: "ok", staffId: "vlad", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null }], kept: { vlad: [at(2), at(3)] } });
    // Kept times stored as a bare list belong to nobody: left out.
    expect(readStoredFinishLine(JSON.stringify({ entries: [], kept: [at(2)] })).kept).toEqual({});
    expect(isInstant(at(1))).toBe(true);
    expect(isInstant(0)).toBe(false);
  });
});
