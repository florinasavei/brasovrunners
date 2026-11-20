import { describe, expect, it } from "vitest";
import {
  asksBeforeAgain,
  betterSample,
  CLOCK_SAMPLE_KEPT_MS,
  type ClockSample,
  clockReading,
  dropKept,
  type EliteButtonView,
  ENTRIES_KEPT,
  entryStateOf,
  eventIdOfStorageKey,
  FINISH_ARRIVAL_GRACE_MS,
  FINISH_CLAIM_AHEAD_MS,
  FINISH_RETRY_FIRST_MS,
  FINISH_RETRY_MAX_MS,
  FINISH_UNDO_WINDOW_MS,
  FINISH_WINDOW_MS,
  type FinishEntry,
  finishRetryDelay,
  finishStamp,
  finishStorageKey,
  holdAfterFailure,
  isInstant,
  keepTime,
  keptAfterPress,
  keptAge,
  keptOf,
  KEPT_TIME_MAX_AGE_MS,
  KEPT_TIMES_MAX,
  lineGun,
  lineGunAt,
  type LineTrailRow,
  markUndone,
  mayUndo,
  nextRetryAt,
  nextToSend,
  pressEntry,
  pressMeets,
  RACE_GUN_CLAIM_TOLERANCE_MS,
  RACE_GUN_REPEAT_MS,
  raceGunMoment,
  raceGunRepeats,
  raceGunWindowOpen,
  readStoredClockSample,
  readStoredFinishLine,
  type RecentFinisherView,
  sampleOfPage,
  sampleOfRoundTrip,
  savedPressOf,
  serverNowAt,
  settleEntry,
  stampedGunTime,
  staleKept,
  storedClockSample,
  storedFinishLine,
  takeOldestKept,
  tapMoment,
  undoClosedBy,
  undoOpenUntil,
  undoTrailOf,
  waitingCount,
  withoutSettled,
  withKept,
} from "@/modules/results/domain/finish-line";

/**
 * §986 — «Cronometrare»'s pure parts (BR-REQ-050-02): the server's clock read through the phone's wall clock and an offset measured
 * over round trips, the best sample kept; the stamp floored to the second, the claimed time held to the server's bounds, a claim
 * before the gun refused as not started and a press arriving after the day and its grace refused; what a press does to a stored row,
 * and a press found in the trail by its id read back as it was answered; «Start»'s window, its tap and the organizer's own press sent
 * twice, and the gun the line counts from — the newer of the last answer and the clock's question —, the one its sentence says, and
 * whether a finisher fixed it; «Anulează»'s ten minutes on one's own press at the line, unchanged and not pressed again, the phone's
 * line of an undone press saying «anulat»; the kept times oldest first, each account's own, each with its age, none older than ten
 * minutes given to a number; the queue in the order pressed, each account sending its own, a press the server could not record held
 * for its backoff while the next ones go and never given up; and the phone's storage read back tolerantly.
 */
const GUN = Date.UTC(2026, 10, 21, 7, 0, 0);
const at = (minutes: number, seconds = 0, ms = 0) => GUN + minutes * 60_000 + seconds * 1000 + ms;

describe("§986 the server's clock: the phone's wall clock and a measured offset", () => {
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

describe("§986 the stamp: the claimed press within the server's bounds, else the server's own", () => {
  const now = at(50);

  it("keeps a claimed time from a second up to the server's own time plus five seconds, floored", () => {
    expect(finishStamp({ claimedAtMs: at(45, 12, 700), gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: at(45, 12) - GUN, claimed: true });
    expect(finishStamp({ claimedAtMs: now + FINISH_CLAIM_AHEAD_MS, gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: now + FINISH_CLAIM_AHEAD_MS - GUN, claimed: true });
    expect(finishStamp({ claimedAtMs: at(0, 1), gunAtMs: GUN, nowMs: now })).toEqual({ kind: "stamped", gunTimeMs: 1000, claimed: true });
  });

  it("takes its own time only for a claim past now plus five seconds, or no claim at all", () => {
    const own = { kind: "stamped", gunTimeMs: now - GUN, claimed: false };
    expect(finishStamp({ claimedAtMs: now + FINISH_CLAIM_AHEAD_MS + 1000, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: null, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: 1.5, gunAtMs: GUN, nowMs: now })).toEqual(own);
    expect(finishStamp({ claimedAtMs: Number.NaN, gunAtMs: GUN, nowMs: now })).toEqual(own);
  });

  it("refuses a claim before the gun — or in its first second — as not started, never stamping the arrival's time instead", () => {
    // A press queued before the gun and sent fifty minutes later would be a finisher made up at its arrival, the gun fixed by it.
    expect(finishStamp({ claimedAtMs: GUN - 60_000, gunAtMs: GUN, nowMs: now })).toEqual({ kind: "notStarted" });
    expect(finishStamp({ claimedAtMs: GUN - 1, gunAtMs: GUN, nowMs: now })).toEqual({ kind: "notStarted" });
    expect(finishStamp({ claimedAtMs: GUN, gunAtMs: GUN, nowMs: now })).toEqual({ kind: "notStarted" });
    expect(finishStamp({ claimedAtMs: at(0, 0, 999), gunAtMs: GUN, nowMs: now })).toEqual({ kind: "notStarted" });
    // A «Start» pressed late, after a press claimed before it: the same — the time is the paper's, the line says the hour to write down.
    expect(finishStamp({ claimedAtMs: at(1), gunAtMs: at(2), nowMs: at(30) })).toEqual({ kind: "notStarted" });
  });

  it("closes a claim past the day though it arrives within the grace: the runner crossed after the line closed", () => {
    const claimed = GUN + FINISH_WINDOW_MS + 2_000;
    expect(finishStamp({ claimedAtMs: claimed, gunAtMs: GUN, nowMs: claimed + 1_000 })).toEqual({ kind: "closed", gunTimeMs: FINISH_WINDOW_MS + 2_000 });
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

describe("§986 what a press does to the stored row of its number", () => {
  const written = new Date(at(40));
  const row = (status: string, by = "vlad", gunTimeMs: number | null = at(40) - GUN) => ({ status, gunTimeMs, updatedAt: written, updatedByStaffUserId: by });
  const press = (atMs: number, actorId = "radu", gunTimeMs = atMs - GUN, identified = false) => ({ actorId, gunTimeMs, atMs, identified });

  it("is a retry for the same viewer at the same second, and a press again for anybody else or another second — for a press with no id", () => {
    expect(pressMeets(row("FINISHED"), press(at(40), "vlad"))).toBe("retry");
    expect(pressMeets(row("FINISHED"), press(at(40, 2), "vlad"))).toBe("pressedAgain");
    expect(pressMeets(row("FINISHED"), press(at(40)))).toBe("pressedAgain");
  });

  it("guesses no retry for a press carrying its own id: the trail, read first, said it is another press", () => {
    expect(pressMeets(row("FINISHED"), press(at(40), "vlad", at(40) - GUN, true))).toBe("pressedAgain");
    expect(pressMeets(row("DNF", "oana", null), press(at(41), "vlad", at(41) - GUN, true))).toBe("turned");
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

describe("§986 a press found in the trail by its id, read back as it was answered", () => {
  const created = { action: "event_result.created", metadata: { bibNumber: 101, status: "FINISHED", gunTimeMs: 2_712_000, chipTimeMs: null, finishLine: true, resultId: "row-1", pressId: "p" } };

  it("reads a «Sosit» it wrote — created or turned — and a number it found stored, with both times and the state", () => {
    expect(savedPressOf(created, 101)).toEqual({ kind: "recorded", resultId: "row-1", gunTimeMs: 2_712_000 });
    expect(savedPressOf({ ...created, action: "event_result.updated" }, 101)).toEqual({ kind: "recorded", resultId: "row-1", gunTimeMs: 2_712_000 });
    const duplicate = { action: "event_result.finish_duplicate", metadata: { bibNumber: 101, gunTimeMs: 2_714_000, storedGunTimeMs: 2_712_000, storedStatus: "FINISHED", storedResultId: "row-1", finishLine: true, pressId: "q" } };
    expect(savedPressOf(duplicate, 101)).toEqual({ kind: "duplicate", storedResultId: "row-1", gunTimeMs: 2_714_000, storedGunTimeMs: 2_712_000, storedStatus: "FINISHED" });
    // A decision of «Clasament» found: no time stored.
    expect(savedPressOf({ ...duplicate, metadata: { ...duplicate.metadata, storedGunTimeMs: null, storedStatus: "DSQ" } }, 101)).toMatchObject({ storedGunTimeMs: null, storedStatus: "DSQ" });
  });

  it("is none for another number's row, a «Clasament» save's, and one that cannot be read: the press is then new", () => {
    expect(savedPressOf(created, 102)).toBeNull();
    expect(savedPressOf({ ...created, metadata: { ...created.metadata, finishLine: undefined } }, 101)).toBeNull();
    expect(savedPressOf({ ...created, metadata: { ...created.metadata, resultId: 7 } }, 101)).toBeNull();
    expect(savedPressOf({ action: "event_result.deleted", metadata: created.metadata }, 101)).toBeNull();
    expect(savedPressOf({ action: "event_result.created", metadata: "not an object" }, 101)).toBeNull();
  });
});

describe("§986 «Start»", () => {
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

  it("takes the organizer's own «Start» heard again within ten seconds for the same press sent twice — and nothing else", () => {
    const set = { action: "event.race_gun_set", actorStaffUserId: "oana", at: new Date(GUN) };
    expect(RACE_GUN_REPEAT_MS).toBe(10_000);
    expect(raceGunRepeats(set, "oana", GUN + 3_000)).toBe(true);
    expect(raceGunRepeats(set, "oana", GUN + RACE_GUN_REPEAT_MS)).toBe(true);
    expect(raceGunRepeats(set, "oana", GUN + RACE_GUN_REPEAT_MS + 1)).toBe(false);
    // Another organizer's press, a press after «Anulează startul», and the first press of all are presses of their own.
    expect(raceGunRepeats(set, "ana", GUN + 3_000)).toBe(false);
    expect(raceGunRepeats({ ...set, action: "event.race_gun_cleared" }, "oana", GUN + 3_000)).toBe(false);
    expect(raceGunRepeats(undefined, "oana", GUN + 3_000)).toBe(false);
    expect(raceGunRepeats({ ...set, actorStaffUserId: null }, "oana", GUN + 3_000)).toBe(false);
  });
});

describe("§986 the gun the line counts from: the newer of the last answer and the clock's question", () => {
  const planned = GUN;
  const pressed = GUN + 4 * 60_000;

  it("moves a page drawn before «Start» to the gun the clock's answer heard — «Start» pressed by another account on its phone", () => {
    // The page drawn at 06:58 on the planned gun; the organizer presses «Start» at 07:04 on their phone; the volunteer's clock asks at 07:04:20.
    const drawn = { serverNowMs: GUN - 2 * 60_000, gunAtMs: planned };
    expect(lineGunAt(drawn, null)).toBe(planned);
    const heard = { gunAtMs: pressed, serverMs: pressed + 20_000 };
    expect(lineGunAt(drawn, heard)).toBe(pressed);
    // «De la start» then counts from the gun as pressed, not as planned: twenty seconds, not four minutes and twenty.
    expect(clockReading(pressed + 20_000, lineGunAt(drawn, heard))).toBe(20_000);
    // A page drawn before an early gun said «Cursa nu a pornit încă»; the clock's answer starts it.
    const early = { gunAtMs: GUN - 60_000, serverMs: GUN - 30_000 };
    expect(clockReading(GUN - 30_000, lineGunAt(drawn, null))).toBeNull();
    expect(clockReading(GUN - 30_000, lineGunAt(drawn, early))).toBe(30_000);
  });

  it("keeps a press's answer newer than the clock's — the gun as it then stood — and the clock's newer than that answer", () => {
    const heard = { gunAtMs: pressed, serverMs: pressed + 20_000 };
    const answeredAfter = { serverNowMs: pressed + 25_000, gunAtMs: pressed + 1_000 };
    expect(lineGunAt(answeredAfter, heard)).toBe(pressed + 1_000);
    const answeredBefore = { serverNowMs: pressed + 10_000, gunAtMs: planned };
    expect(lineGunAt(answeredBefore, heard)).toBe(pressed);
  });

  it("says the gun it counts from — pressed and by whom, or the plan — and whether a finisher fixed it, from the same newer answer (§986)", () => {
    const drawn = { serverNowMs: GUN - 2 * 60_000, gunAtMs: planned, gunPressed: false, gunByName: null, finished: 0 };
    // Drawn before «Start»: the plan, nothing fixed — the half-minute question goes on.
    expect(lineGun(drawn, null)).toEqual({ atMs: planned, pressed: false, byName: null, fixed: false });
    // «Start» on the organizer's phone, heard by the clock: the sentence names who pressed it, never «Startul planificat … Până la «Start»».
    const heard = { gunAtMs: pressed, serverMs: pressed + 20_000, pressed: true, byName: "Oana", fixed: false };
    expect(lineGun(drawn, heard)).toEqual({ atMs: pressed, pressed: true, byName: "Oana", fixed: false });
    // Another phone's first finisher, heard by the clock: fixed — though this page's own state counts nobody.
    expect(lineGun(drawn, { ...heard, serverMs: pressed + 60_000, fixed: true }).fixed).toBe(true);
    // A press's answer newer than the clock's: its own gun and its own count.
    const answered = { serverNowMs: pressed + 90_000, gunAtMs: pressed, gunPressed: true, gunByName: "Oana", finished: 1 };
    expect(lineGun(answered, heard)).toEqual({ atMs: pressed, pressed: true, byName: "Oana", fixed: true });
    // «Anulează startul» on the organizer's phone, heard after: the plan again, its sentence with it.
    expect(lineGun(answered, { gunAtMs: planned, serverMs: pressed + 120_000, pressed: false, byName: null, fixed: false })).toEqual({ atMs: planned, pressed: false, byName: null, fixed: false });
    // The same reading `lineGunAt` gives.
    expect(lineGun(drawn, heard).atMs).toBe(lineGunAt(drawn, heard));
  });
});

describe("§986 «Anulează»: one's own press at the line, written once, not pressed again, for ten minutes", () => {
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

describe("§986 «⏱ Finish»: kept times, oldest first, each account's own", () => {
  it("keeps the kept times of each staff account apart on the phone's line", () => {
    let line = withKept({ entries: [], kept: {}, title: null }, "vlad", [at(10), at(10, 2)]);
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

  it("gives a number no kept moment older than ten minutes: dropped when the line is read or pressed, its time said for paper", () => {
    expect(KEPT_TIME_MAX_AGE_MS).toBe(10 * 60_000);
    const kept = [at(10), at(19, 59), at(20, 1)];
    // At 0:30:00 the moment of 0:10:00 is twenty minutes old and the one of 0:19:59 ten minutes and a second: both go; 0:20:01 stays.
    expect(staleKept(kept, at(30))).toEqual({ fresh: [at(20, 1)], stale: [at(10), at(19, 59)] });
    // Exactly ten minutes old is still young.
    expect(staleKept([at(20)], at(30))).toEqual({ fresh: [at(20)], stale: [] });
    // A press then takes the oldest young one, never a stale one.
    expect(takeOldestKept(staleKept(kept, at(30)).fresh)).toEqual({ atMs: at(20, 1), rest: [] });
    // A moment ahead of now — the clock measured again under it — is young; nothing kept, nothing dropped.
    expect(staleKept([at(31)], at(30))).toEqual({ fresh: [at(31)], stale: [] });
    expect(staleKept([], at(30))).toEqual({ fresh: [], stale: [] });
  });

  it("says each kept moment's age on its chip: seconds under a minute, then minutes, never below nought", () => {
    expect(keptAge(at(10), at(10, 42))).toEqual({ unit: "seconds", value: 42 });
    expect(keptAge(at(10), at(10, 59, 999))).toEqual({ unit: "seconds", value: 59 });
    expect(keptAge(at(10), at(11))).toEqual({ unit: "minutes", value: 1 });
    expect(keptAge(at(10), at(19, 59))).toEqual({ unit: "minutes", value: 9 });
    expect(keptAge(at(10, 5), at(10))).toEqual({ unit: "seconds", value: 0 });
  });
});

describe("§1010 the moment of the tap: read as «Sosit» is pressed, taken from the kept ones only by the press", () => {
  it("reads the oldest kept moment still young, else now — and takes nothing from the kept ones by reading", () => {
    const kept = [at(10), at(20, 1), at(20, 5)];
    // At 0:30:00 the moment of 0:10:00 is stale: the tap reads 0:20:01, the oldest young one.
    expect(tapMoment(kept, at(30))).toEqual({ atMs: at(20, 1), kept: at(20, 1) });
    expect(kept).toEqual([at(10), at(20, 1), at(20, 5)]);
    // Nothing kept, or nothing young: the tap is now.
    expect(tapMoment([], at(30))).toEqual({ atMs: at(30), kept: null });
    expect(tapMoment([at(10)], at(30))).toEqual({ atMs: at(30), kept: null });
  });

  it("is, for a press made at its tap, what taking the oldest young kept moment was: the same moment, the same kept left, the same said for paper", () => {
    const kept = [at(10), at(20, 1), at(20, 5)];
    const tap = tapMoment(kept, at(30));
    const { fresh, stale } = staleKept(kept, at(30));
    const taken = takeOldestKept(fresh);
    expect(tap.atMs).toBe(taken.atMs);
    expect(keptAfterPress(kept, tap.kept, at(30))).toEqual({ rest: taken.rest, stale });
    // A tap that took none: the young ones stay, the stale go for paper.
    expect(keptAfterPress([at(10), at(25)], null, at(30))).toEqual({ rest: [at(25)], stale: [at(10)] });
  });

  it("keeps the tap's moment however long a question stays open, and lets go of exactly the kept moment it read, not the oldest at the answer", () => {
    // «Sosit» at 0:30:00 with two kept moments: the tap reads 0:29:50.
    const kept = [at(29, 50), at(29, 55)];
    const tap = tapMoment(kept, at(30));
    expect(tap).toEqual({ atMs: at(29, 50), kept: at(29, 50) });
    // «Trece numărul din nou» eight seconds later: the press still stands for 0:29:50, and 0:29:55 is left for the next number.
    expect(keptAfterPress(kept, tap.kept, at(30, 8))).toEqual({ rest: [at(29, 55)], stale: [] });
    // With no kept moment, the moment is the instant «Sosit» was pressed — never the answer's.
    expect(tapMoment([], at(30)).atMs).toBe(at(30));
    // «Anulează»: nothing is pressed, so nothing is taken — the kept moments are as they were (the press alone takes one).
    expect(tapMoment(kept, at(30, 8))).toEqual({ atMs: at(29, 50), kept: at(29, 50) });
  });

  it("records the tap's kept moment though the sweep dropped it while the question was open, and drops every other stale one at the answer", () => {
    // Read at 0:39:59, 9:59 old; the answer comes at 0:40:05, after the second's sweep took it for paper.
    const tap = tapMoment([at(30), at(39, 30)], at(39, 59));
    expect(tap.kept).toBe(at(30));
    expect(keptAfterPress([at(39, 30)], tap.kept, at(40, 5))).toEqual({ rest: [at(39, 30)], stale: [] });
    // Another moment gone stale meanwhile goes for paper; the tap's, still kept, is taken whatever its age now.
    expect(keptAfterPress([at(30), at(30, 1)], at(30), at(40, 5))).toEqual({ rest: [], stale: [at(30, 1)] });
  });
});

describe("§986 the queue: in the order pressed, answered once, the waiting ones never dropped, each account sending its own", () => {
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

  it("holds a press the server could not record while the next ones go, tries it again when its turn comes, and never gives it up", () => {
    let entries: FinishEntry[] = [];
    entries = pressEntry(entries, entry("a", 101, at(40)));
    entries = pressEntry(entries, entry("b", 102, at(40, 1)));
    entries = pressEntry(entries, entry("c", 101, at(40, 2)));
    entries = pressEntry(entries, entry("d", 103, at(40, 3)));
    const held = new Map<string, { tries: number; untilMs: number }>();
    const now = at(41);
    // «a» answered `failed`: held for two seconds, and «b» goes — but «c», a later press of 101, waits behind it.
    held.set("a", holdAfterFailure(held, "a", now));
    expect(held.get("a")).toEqual({ tries: 1, untilMs: now + FINISH_RETRY_FIRST_MS });
    expect(nextToSend(entries, "vlad", held, now)?.id).toBe("b");
    entries = settleEntry(entries, "b", { kind: "recorded", bibNumber: 102, name: null, label: null, gunTimeMs: 2_401_000, positionOverall: 1, outOfRanking: false, again: false });
    expect(nextToSend(entries, "vlad", held, now)?.id).toBe("d");
    entries = settleEntry(entries, "d", { kind: "recorded", bibNumber: 103, name: null, label: null, gunTimeMs: 2_403_000, positionOverall: 2, outOfRanking: false, again: false });
    // Only the held one and the press behind it are left: nothing goes until «a»'s hold is over, and the pump knows when that is.
    expect(nextToSend(entries, "vlad", held, now)).toBeUndefined();
    expect(nextRetryAt(entries, "vlad", held)).toBe(now + FINISH_RETRY_FIRST_MS);
    // Its turn come, «a» goes first — before the later press of its number — still waiting, never settled by a failure.
    expect(nextToSend(entries, "vlad", held, now + FINISH_RETRY_FIRST_MS)?.id).toBe("a");
    expect(entries.map((one) => entryStateOf(one, "vlad"))).toEqual(["waiting", "saved", "waiting", "saved"]);
    // Failing again and again, it waits longer each time — two seconds, doubling, every thirty at most —, never a last try.
    for (let tries = 2; tries <= 8; tries += 1) held.set("a", holdAfterFailure(held, "a", now));
    expect(held.get("a")).toEqual({ tries: 8, untilMs: now + FINISH_RETRY_MAX_MS });
    expect([1, 2, 3, 4, 5, 6, 100].map(finishRetryDelay)).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    // Answered at last: settled, and the press behind it goes.
    entries = settleEntry(entries, "a", { kind: "recorded", bibNumber: 101, name: null, label: null, gunTimeMs: 2_400_000, positionOverall: 1, outOfRanking: false, again: false });
    held.delete("a");
    expect(nextToSend(entries, "vlad", held, now)?.id).toBe("c");
    expect(nextRetryAt(entries, "vlad", held)).toBeNull();
    // Another account's hold is not this viewer's to wait for.
    expect(nextRetryAt(entries, "radu", new Map([["c", { tries: 1, untilMs: now }]]))).toBeNull();
  });

  it("«Golește lista» (§1001) drops every line the server answered — saved, refused, a duplicate, undone — and keeps every press still waiting, any account's", () => {
    const recorded = (bibNumber: number) => ({ kind: "recorded" as const, bibNumber, name: null, label: null, gunTimeMs: 1_000, positionOverall: 1, outOfRanking: false, again: false });
    let entries: FinishEntry[] = [];
    entries = settleEntry(pressEntry(entries, entry("saved", 101, at(10))), "saved", recorded(101));
    entries = settleEntry(pressEntry(entries, entry("refused", 102, at(10, 1))), "refused", { kind: "refused", code: "RESULT_FINISH_NOT_STARTED", bibNumber: 102, gunTimeMs: null });
    entries = settleEntry(pressEntry(entries, entry("duplicate", 101, at(10, 2))), "duplicate", { kind: "duplicate", bibNumber: 101, name: null, label: null, gunTimeMs: 2_000, storedStatus: "FINISHED", storedGunTimeMs: 1_000, storedBy: "Vlad" });
    entries = pressEntry(entries, entry("mine-waiting", 103, at(10, 3)));
    entries = pressEntry(entries, entry("radu-waiting", 104, at(10, 4), "radu"));
    entries = markUndone(entries, "vlad", 101);
    expect(entries.map(stateOf)).toEqual(["undone", "refused", "duplicate", "waiting", "otherAccount"]);
    const cleared = withoutSettled(entries);
    expect(cleared.map((one) => one.id)).toEqual(["mine-waiting", "radu-waiting"]);
    expect(cleared.map(stateOf)).toEqual(["waiting", "otherAccount"]);
    // Nothing answered: nothing goes; an empty list stays empty.
    expect(withoutSettled(cleared)).toEqual(cleared);
    expect(withoutSettled([])).toEqual([]);
    // The list it was given is not changed.
    expect(entries).toHaveLength(5);
  });

  it("marks the viewer's latest recorded press of the number «anulat» once «Anulează» undid it — nobody else's, nothing else (§986)", () => {
    const recorded = (bibNumber: number, gunTimeMs: number) => ({ kind: "recorded" as const, bibNumber, name: null, label: null, gunTimeMs, positionOverall: 1, outOfRanking: false, again: false });
    let entries: FinishEntry[] = [];
    entries = settleEntry(pressEntry(entries, entry("first", 21, at(18, 3))), "first", recorded(21, 1_083_000));
    entries = settleEntry(pressEntry(entries, entry("other", 21, at(18, 4), "radu")), "other", recorded(21, 1_084_000));
    entries = settleEntry(pressEntry(entries, entry("again", 21, at(18, 9))), "again", { kind: "duplicate", bibNumber: 21, name: null, label: null, gunTimeMs: 1_089_000, storedStatus: "FINISHED", storedGunTimeMs: 1_083_000, storedBy: "Vlad" });
    entries = pressEntry(entries, entry("waiting", 22, at(18, 10)));
    const undone = markUndone(entries, "vlad", 21);
    // Vlad's recorded press of 21 reads «anulat»; Radu's, Vlad's duplicate and the waiting press are as they were.
    expect(undone.map(stateOf)).toEqual(["undone", "saved", "duplicate", "waiting"]);
    expect(undone.map((one) => entryStateOf(one, "radu"))).toEqual(["undone", "saved", "duplicate", "otherAccount"]);
    // The press recorded again after its undo, undone again: the newer one is marked, the older stays «anulat».
    const later = settleEntry(pressEntry(undone, entry("later", 21, at(25))), "later", recorded(21, 1_500_000));
    expect(markUndone(later, "vlad", 21).map(stateOf)).toEqual(["undone", "saved", "duplicate", "waiting", "undone"]);
    // No recorded press of the number on this phone — undone from another tab, or with scripts off —: nothing changes.
    expect(markUndone(undone, "vlad", 21)).toEqual(undone);
    expect(markUndone(entries, "vlad", 99)).toEqual(entries);
    // Kept on the phone and read back, a recorded press only.
    const stored = readStoredFinishLine(storedFinishLine({ entries: undone, kept: {}, title: null }));
    expect(stored.entries.map(stateOf)).toEqual(["undone", "saved", "duplicate", "waiting"]);
    const forged = JSON.stringify({ entries: [{ ...entries[2], undone: true }, { ...entries[3], undone: true }], kept: {} });
    expect(readStoredFinishLine(forged).entries.map(stateOf)).toEqual(["duplicate", "waiting"]);
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

describe("§986 the phone's storage", () => {
  it("is one key per event, found again by its event's id — the clock's key and any other are no event's line", () => {
    const eventId = "0b6f6c2e-5d1a-4c47-9a53-3f0d2b1c4e5f";
    expect(finishStorageKey(eventId)).toBe(`finish-line:${eventId}`);
    expect(eventIdOfStorageKey(finishStorageKey(eventId))).toBe(eventId);
    expect(eventIdOfStorageKey("finish-line:clock")).toBeNull();
    expect(eventIdOfStorageKey("finish-line:")).toBeNull();
    expect(eventIdOfStorageKey(`other:${eventId}`)).toBeNull();
  });

  it("is written and read back whole, the event's title with it", () => {
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
    const line = { entries: pressEntry(decided, { id: "c", staffId: "radu", bibNumber: 9, label: null, pressedAtMs: at(5) }), kept: { vlad: [at(5)] }, title: "Crosul Toamnei" };
    expect(readStoredFinishLine(storedFinishLine(line))).toEqual(line);
    // A line written before the title was kept, or with an empty one: none.
    expect(readStoredFinishLine(JSON.stringify({ entries: [], kept: {} })).title).toBeNull();
    expect(readStoredFinishLine(JSON.stringify({ entries: [], kept: {}, title: "  " })).title).toBeNull();
  });

  it("reads nothing, broken JSON, another shape and every malformed entry or kept time as left out, never thrown", () => {
    const empty = { entries: [], kept: {}, title: null };
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
    expect(readStoredFinishLine(raw)).toEqual({ entries: [{ id: "ok", staffId: "vlad", bibNumber: 5, label: null, pressedAtMs: at(1), outcome: null }], kept: { vlad: [at(2), at(3)] }, title: null });
    // Kept times stored as a bare list belong to nobody: left out.
    expect(readStoredFinishLine(JSON.stringify({ entries: [], kept: [at(2)] })).kept).toEqual({});
    expect(isInstant(at(1))).toBe(true);
    expect(isInstant(0)).toBe(false);
  });
});

/**
 * §1010 — a finished elite's number typed again is asked first (the owner, 2026-11-20: «this is just for elites sincer their timing is
 * more sensitive»): only a number of the page's elites — a registration marked «Elită» or a numbered line of the elite list — already
 * «Sosit», or whose press of the viewer's own waits or was saved on this phone since the gun; never another number, an elite who has not
 * crossed, a press undone, another account's, or a press before the gun.
 */
describe("§1010 a finished elite's number typed again: asked first, only for an elite", () => {
  const elite = (key: string, kind: EliteButtonView["kind"], label: string, name: string, bibNumber: number | null, finishedGunTimeMs: number | null = null): EliteButtonView => ({
    key,
    kind,
    label,
    name,
    bibNumber,
    entryId: kind === "line" ? key.slice(2) : null,
    finishedGunTimeMs,
  });
  const recentRow = (bibNumber: number, gunTimeMs: number, by: string | null, label: string | null = null): RecentFinisherView => ({
    resultId: `row-${bibNumber}`,
    bibNumber,
    label,
    name: null,
    gunTimeMs,
    positionOverall: 1,
    outOfRanking: false,
    by,
    changed: false,
    undoUntilMs: null,
    pressedAgain: null,
  });
  const press = (id: string, bibNumber: number, pressedAtMs: number, staffId = "vlad"): FinishEntry => ({ id, staffId, bibNumber, label: null, pressedAtMs, outcome: null });
  const recorded = (bibNumber: number, gunTimeMs: number) => ({ kind: "recorded" as const, bibNumber, name: null, label: null, gunTimeMs, positionOverall: 1, outOfRanking: false, again: false });
  const silviu = elite("r:silviu", "registration", "Silviu", "Silviu Dobre", 110, 31 * 60_000 + 5_000);
  const andrei = elite("l:andrei", "line", "Andrei", "Andrei Munteanu", 7, 30 * 60_000);
  const ioana = elite("l:ioana", "line", "Ioana", "Ioana Pop", 8);
  const ingrid = elite("l:ingrid", "line", "Ingrid", "Ingrid Pop", null);
  const line = { elites: [andrei, ioana, ingrid, silviu], recent: [recentRow(110, 31 * 60_000 + 5_000, "Vlad Voluntar", "Silviu"), recentRow(101, 29 * 60_000, "Radu Redactor")] };

  it("asks for an elite already «Sosit» — a registration marked «Elită» and a line of the elite list —, with the time stored and who entered it while «Ultimii sosiți» holds it", () => {
    expect(asksBeforeAgain(110, line, [], "vlad", GUN)).toEqual({ elite: silviu, gunTimeMs: 31 * 60_000 + 5_000, stored: line.recent[0] });
    // Andrei's «Sosit» is older than the twenty «Ultimii sosiți» hold: asked all the same, without who entered it.
    expect(asksBeforeAgain(7, line, [], "vlad", GUN)).toEqual({ elite: andrei, gunTimeMs: 30 * 60_000, stored: null });
  });

  it("asks for an elite whose press of the viewer's waits on this phone, or was saved there while the page's state had not heard — with that press's time", () => {
    const waiting = [press("a", 8, at(32, 7, 450))];
    expect(asksBeforeAgain(8, line, waiting, "vlad", GUN)).toEqual({ elite: ioana, gunTimeMs: 32 * 60_000 + 7_000, stored: null });
    const saved = settleEntry(waiting, "a", recorded(8, 32 * 60_000 + 7_000));
    expect(asksBeforeAgain(8, line, saved, "vlad", GUN)).toEqual({ elite: ioana, gunTimeMs: 32 * 60_000 + 7_000, stored: null });
  });

  it("asks nothing for an elite who has not crossed: no stored «Sosit», no press of theirs on this phone", () => {
    expect(asksBeforeAgain(8, line, [], "vlad", GUN)).toBeNull();
    // A press of another number, a press of theirs refused or answered a duplicate of nobody's «Sosit»: not crossed, as far as the phone knows.
    expect(asksBeforeAgain(8, line, [press("b", 9, at(33))], "vlad", GUN)).toBeNull();
    expect(asksBeforeAgain(8, line, settleEntry([press("c", 8, at(33))], "c", { kind: "refused", code: "RESULT_FINISH_CLOSED", bibNumber: 8, gunTimeMs: null }), "vlad", GUN)).toBeNull();
  });

  it("asks about an elite pressed on another phone only once this page has heard of it — at a reload, or in the answer to any press of its own", () => {
    // Ioana pressed on another phone: this page's state still draws her not crossed, so her number goes at once — the server keeps the
    // first time and writes this press to «Istoricul sosirilor»; nothing is asked of the server at a number typed.
    expect(asksBeforeAgain(8, line, [], "vlad", GUN)).toBeNull();
    // The answer to this page's next press, or a reload, brings her «Sosit»: asked from then on, with who entered it.
    const heardIoana = { ...ioana, finishedGunTimeMs: 33 * 60_000 };
    const heard = { elites: line.elites.map((one) => (one === ioana ? heardIoana : one)), recent: [recentRow(8, 33 * 60_000, "Radu Redactor", "Ioana"), ...line.recent] };
    expect(asksBeforeAgain(8, heard, [], "vlad", GUN)).toEqual({ elite: heardIoana, gunTimeMs: 33 * 60_000, stored: heard.recent[0] });
  });

  it("asks nothing for a press undone since, another account's press left on the phone, or a press before the gun — the trial before «Resetează clasamentul»", () => {
    const undone = markUndone(settleEntry([press("d", 8, at(33))], "d", recorded(8, 33 * 60_000)), "vlad", 8);
    expect(asksBeforeAgain(8, line, undone, "vlad", GUN)).toBeNull();
    expect(asksBeforeAgain(8, line, [press("e", 8, at(33), "radu")], "vlad", GUN)).toBeNull();
    const trial = settleEntry([press("f", 8, at(-50))], "f", recorded(8, 4_000));
    expect(asksBeforeAgain(8, line, trial, "vlad", GUN)).toBeNull();
    expect(asksBeforeAgain(8, line, [press("g", 8, at(0, 0, -1))], "vlad", GUN)).toBeNull();
  });

  it("asks nothing for a number that is no elite's, finished and saved on this phone or not", () => {
    // 101 is «Sosit», in «Ultimii sosiți», and saved on this phone: any other number typed again goes at once, as before.
    const saved = settleEntry([press("h", 101, at(29))], "h", recorded(101, 29 * 60_000));
    expect(asksBeforeAgain(101, line, saved, "vlad", GUN)).toBeNull();
    expect(asksBeforeAgain(555, line, [], "vlad", GUN)).toBeNull();
  });
});
