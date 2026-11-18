import { describe, expect, it } from "vitest";
import { FINISH_HISTORY_ACTIONS, finishHistory, finishHistoryLine, historyBibOf } from "@/modules/results/domain/finish-history";

/**
 * §NNN — «Istoricul sosirilor» read from the trail (BR-REQ-050-02): each row of the race's results as one line — a press at the line,
 * a duplicate with both times or with the decision of «Clasament» that stays, the line's undo, a «Clasament» save's rows with the boxes it changed, «Start» set, moved and taken off —
 * from where («Cronometrare» or «Clasament»), by whom (null for an account gone), newest first; metadata read field by field, an
 * action it does not read left out.
 */
const row = (id: string, action: string, minute: number, metadata: unknown, actorName: string | null = "Vlad Voluntar") => ({
  id,
  action,
  at: new Date(Date.UTC(2026, 10, 21, 8, minute)),
  actorName,
  metadata,
});

describe("§NNN «Istoricul sosirilor»", () => {
  it("reads the line's presses, duplicates and undos as «Cronometrare», a save's rows as «Clasament»", () => {
    expect(finishHistoryLine(row("1", "event_result.created", 1, { bibNumber: 101, status: "FINISHED", gunTimeMs: 2_712_000, chipTimeMs: null, finishLine: true }))).toMatchObject({
      where: "timing",
      who: "Vlad Voluntar",
      what: { kind: "finish", bibNumber: 101, gunTimeMs: 2_712_000, turned: false },
    });
    expect(finishHistoryLine(row("2", "event_result.updated", 2, { bibNumber: 101, status: "FINISHED", gunTimeMs: 2_712_000, changed: ["time", "status"], finishLine: true }))?.what).toEqual({
      kind: "finish",
      bibNumber: 101,
      gunTimeMs: 2_712_000,
      turned: true,
    });
    expect(finishHistoryLine(row("3", "event_result.finish_duplicate", 3, { bibNumber: 101, gunTimeMs: 2_720_000, storedGunTimeMs: 2_712_000, finishLine: true }))).toMatchObject({
      where: "timing",
      what: { kind: "duplicate", bibNumber: 101, gunTimeMs: 2_720_000, storedGunTimeMs: 2_712_000, storedStatus: "FINISHED" },
    });
    // A press of a runner «Clasament» disqualified: its decision, which stays, beside the press's time.
    expect(
      finishHistoryLine(row("3b", "event_result.finish_duplicate", 3, { bibNumber: 102, gunTimeMs: 2_730_000, storedGunTimeMs: null, storedStatus: "DSQ", storedResultId: "r-102", finishLine: true }))?.what,
    ).toEqual({ kind: "duplicate", bibNumber: 102, gunTimeMs: 2_730_000, storedGunTimeMs: null, storedStatus: "DSQ" });
    expect(finishHistoryLine(row("4", "event_result.deleted", 4, { bibNumber: 101, status: "FINISHED", gunTimeMs: 2_712_000, finishLine: true, undo: true }))).toMatchObject({
      where: "timing",
      what: { kind: "undo", bibNumber: 101, gunTimeMs: 2_712_000 },
    });
    expect(finishHistoryLine(row("5", "event_result.created", 5, { bibNumber: 555, status: "DNF", gunTimeMs: null, chipTimeMs: null }))).toMatchObject({
      where: "results",
      what: { kind: "created", bibNumber: 555, status: "DNF", gunTimeMs: null },
    });
    expect(finishHistoryLine(row("6", "event_result.updated", 6, { bibNumber: 555, status: "FINISHED", gunTimeMs: 3_000_000, changed: ["time", "status", "nonsense"] }))?.what).toEqual({
      kind: "updated",
      bibNumber: 555,
      status: "FINISHED",
      gunTimeMs: 3_000_000,
      boxes: ["time", "status"],
    });
    expect(finishHistoryLine(row("7", "event_result.deleted", 7, { bibNumber: 555, status: "FINISHED" }))).toMatchObject({ where: "results", what: { kind: "deleted", bibNumber: 555, status: "FINISHED" } });
  });

  it("reads «Start» set, moved and taken off, with its instants", () => {
    const set = finishHistoryLine(row("8", "event.race_gun_set", 0, { at: "2026-11-21T07:00:03.000Z", previous: null }, "Oana Organizator"));
    expect(set).toMatchObject({ where: "timing", who: "Oana Organizator", what: { kind: "gunSet", at: new Date("2026-11-21T07:00:03.000Z"), previous: null } });
    expect(finishHistoryLine(row("9", "event.race_gun_set", 0, { at: "2026-11-21T07:00:05.000Z", previous: "2026-11-21T07:00:03.000Z" }))?.what).toEqual({
      kind: "gunSet",
      at: new Date("2026-11-21T07:00:05.000Z"),
      previous: new Date("2026-11-21T07:00:03.000Z"),
    });
    expect(finishHistoryLine(row("10", "event.race_gun_cleared", 0, { previous: "2026-11-21T07:00:05.000Z" }))?.what).toEqual({ kind: "gunCleared", previous: new Date("2026-11-21T07:00:05.000Z") });
    expect(historyBibOf({ kind: "gunCleared", previous: null })).toBeNull();
  });

  it("says nothing it cannot read, names nobody for an account gone, leaves out an action it does not read, and orders newest first", () => {
    expect(finishHistoryLine(row("11", "event_result.created", 1, "not an object", null))).toMatchObject({ who: null, what: { kind: "created", bibNumber: null, status: null, gunTimeMs: null } });
    expect(finishHistoryLine(row("12", "event.race_gun_set", 1, { at: "yesterday" }))?.what).toEqual({ kind: "gunSet", at: null, previous: null });
    expect(finishHistoryLine(row("13", "event_results.published", 1, {}))).toBeNull();
    const lines = finishHistory([row("a", "event_result.created", 1, { bibNumber: 1, finishLine: true }), row("c", "event_result.created", 3, { bibNumber: 3, finishLine: true }), row("b", "event_result.created", 3, { bibNumber: 2, finishLine: true }), row("x", "event_results.exported", 9, {})]);
    expect(lines.map((line) => historyBibOf(line.what))).toEqual([3, 2, 1]);
    expect(FINISH_HISTORY_ACTIONS).toContain("event_result.finish_duplicate");
  });
});
