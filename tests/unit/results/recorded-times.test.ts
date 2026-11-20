import { describe, expect, it } from "vitest";
import { type FingerprintedResult, resultLineFingerprint, resultsFingerprint } from "@/modules/results/domain/fingerprint";
import {
  isRecordedTime,
  mayChooseRecordedTime,
  RECORDED_TIME_ACTIONS,
  recordedFinishTimes,
  recordedTimesOf,
  recordedTimesOffered,
  type RecordedTimeRow,
  shownFinishTime,
} from "@/modules/results/domain/recorded-times";
import { chosenTimeValue, readChosenTime } from "@/modules/results/rows";

/**
 * §1012 — «Timpi la sosire» read from the race's trail (BR-REQ-050-02): for each number, the times «Cronometrare» recorded since the last
 * «Resetează clasamentul» — the first press and every later press (`finish_duplicate`), a press undone at the line left out, each time
 * once with who pressed it first and when, in the order pressed; another number's presses, a «Clasament» save's rows and «Folosește»'s
 * own rows are no time recorded at the line. And when a line of «Clasament» draws the block: a choice — more than one time, or one that
 * is not the line's «Timp» — on any line but a «Descalificat» one. And what a «Folosește» posts: the number, the time and the line's own
 * fingerprint, so only a change of that line refuses it.
 */
const AT = Date.UTC(2026, 10, 21, 7, 45, 0);
let sequence = 0;
/** One audit row, `seconds` after 09:45:00 in Brașov (07:45 UTC), by `actorName`. */
const row = (action: string, seconds: number, metadata: unknown, actorName: string | null = "Vlad Voluntar"): RecordedTimeRow => ({
  id: `row-${String((sequence += 1)).padStart(3, "0")}`,
  action,
  at: new Date(AT + seconds * 1000),
  actorName,
  metadata,
});
const press = (bib: number, gunTimeMs: number, seconds: number, actorName?: string | null) =>
  row("event_result.created", seconds, { bibNumber: bib, status: "FINISHED", gunTimeMs, chipTimeMs: null, finishLine: true, resultId: `r-${bib}` }, actorName);
const again = (bib: number, gunTimeMs: number, storedGunTimeMs: number, seconds: number, actorName?: string | null) =>
  row("event_result.finish_duplicate", seconds, { bibNumber: bib, gunTimeMs, storedGunTimeMs, storedStatus: "FINISHED", storedResultId: `r-${bib}`, finishLine: true }, actorName);
const undo = (bib: number, gunTimeMs: number, seconds: number) => row("event_result.deleted", seconds, { bibNumber: bib, status: "FINISHED", gunTimeMs, finishLine: true, undo: true });
const reset = (seconds: number) => row("event.results_reset", seconds, { results: 3, gunCleared: true }, "Ana Admin");
const T = (minutes: number, seconds: number) => minutes * 60_000 + seconds * 1000;

describe("§1012 «Timpi la sosire»: the times recorded at the line, by number", () => {
  it("reads a first press: its time, who pressed it and when", () => {
    expect(recordedTimesOf([press(102, T(45, 12), 15)], 102)).toEqual([{ gunTimeMs: T(45, 12), by: "Vlad Voluntar", at: new Date(AT + 15_000) }]);
  });

  it("adds every later press of the number — the duplicates the trail keeps beside the first —, in the order pressed", () => {
    const rows = [press(102, T(45, 12), 15), again(102, T(45, 17), T(45, 12), 20, "Tudor Tehnic"), again(102, T(46, 3), T(45, 12), 66, "Oana Organizator")];
    expect(recordedTimesOf(rows, 102)).toEqual([
      { gunTimeMs: T(45, 12), by: "Vlad Voluntar", at: new Date(AT + 15_000) },
      { gunTimeMs: T(45, 17), by: "Tudor Tehnic", at: new Date(AT + 20_000) },
      { gunTimeMs: T(46, 3), by: "Oana Organizator", at: new Date(AT + 66_000) },
    ]);
    // Read in any order: the rows are put back in the order they were written.
    expect(recordedTimesOf([...rows].reverse(), 102).map((time) => time.gunTimeMs)).toEqual([T(45, 12), T(45, 17), T(46, 3)]);
  });

  it("leaves out a press undone at the line — the latest press of its number standing, of its time — and keeps a press made after the undo", () => {
    const rows = [press(101, T(40, 0), 0), undo(101, T(40, 0), 30), press(101, T(40, 41), 41, "Tudor Tehnic"), again(101, T(40, 44), T(40, 41), 44)];
    expect(recordedTimesOf(rows, 101).map((time) => [time.gunTimeMs, time.by])).toEqual([
      [T(40, 41), "Tudor Tehnic"],
      [T(40, 44), "Vlad Voluntar"],
    ]);
    // Undone and pressed again at the very same time: one time, the press that stands.
    const sameAgain = [press(101, T(40, 0), 0), undo(101, T(40, 0), 30), press(101, T(40, 0), 31, "Oana Organizator")];
    expect(recordedTimesOf(sameAgain, 101)).toEqual([{ gunTimeMs: T(40, 0), by: "Oana Organizator", at: new Date(AT + 31_000) }]);
    // An undo of the only press leaves the number with no time recorded.
    expect(recordedTimesOf([press(103, T(41, 0), 0), undo(103, T(41, 0), 10)], 103)).toEqual([]);
    // A «Clasament» delete is no undo: the time recorded at the line stays one to choose from.
    expect(recordedTimesOf([press(103, T(41, 0), 0), row("event_result.deleted", 20, { bibNumber: 103, status: "FINISHED" })], 103)).toHaveLength(1);
  });

  it("forgets everything before the race's last «Resetează clasamentul»: the trial it wiped", () => {
    const rows = [press(101, T(0, 5), 0), again(101, T(0, 9), T(0, 5), 4), reset(60), press(102, T(1, 0), 50), press(101, T(42, 0), 2_600)];
    expect(recordedFinishTimes(rows)).toEqual(new Map([[101, [{ gunTimeMs: T(42, 0), by: "Vlad Voluntar", at: new Date(AT + 2_600_000) }]]]));
    // Two resets: only the last one counts.
    expect([...recordedFinishTimes([press(101, T(0, 5), 0), reset(10), press(101, T(0, 30), 30), reset(40)]).keys()]).toEqual([]);
  });

  it("keeps each number's presses to that number: another number's are ignored", () => {
    const rows = [press(101, T(40, 0), 0), press(102, T(45, 12), 10), again(102, T(45, 17), T(45, 12), 15), again(101, T(40, 2), T(40, 0), 16)];
    expect(recordedTimesOf(rows, 101).map((time) => time.gunTimeMs)).toEqual([T(40, 0), T(40, 2)]);
    expect(recordedTimesOf(rows, 102).map((time) => time.gunTimeMs)).toEqual([T(45, 12), T(45, 17)]);
    expect(recordedTimesOf(rows, 103)).toEqual([]);
  });

  it("says a time pressed twice once, with who pressed it first and when", () => {
    const rows = [press(102, T(45, 12), 15), again(102, T(45, 12), T(45, 12), 15, "Tudor Tehnic"), again(102, T(45, 17), T(45, 12), 20)];
    expect(recordedTimesOf(rows, 102)).toEqual([
      { gunTimeMs: T(45, 12), by: "Vlad Voluntar", at: new Date(AT + 15_000) },
      { gunTimeMs: T(45, 17), by: "Vlad Voluntar", at: new Date(AT + 20_000) },
    ]);
  });

  it("counts a press that turned a runner written off into «Sosit», and says nobody for an account gone", () => {
    const turned = row("event_result.updated", 5, { bibNumber: 104, status: "FINISHED", gunTimeMs: T(50, 0), chipTimeMs: null, changed: ["time", "status"], finishLine: true, resultId: "r-104" }, null);
    expect(recordedTimesOf([turned], 104)).toEqual([{ gunTimeMs: T(50, 0), by: null, at: new Date(AT + 5_000) }]);
  });

  it("takes no time from «Clasament»: a save's rows, an import's and «Folosește»'s carry no `finishLine`", () => {
    const rows = [
      row("event_result.created", 0, { bibNumber: 101, status: "FINISHED", gunTimeMs: T(40, 0), chipTimeMs: null }),
      row("event_result.updated", 10, { bibNumber: 101, status: "FINISHED", gunTimeMs: T(40, 5), chipTimeMs: null, changed: ["time"] }),
      row("event_result.updated", 20, { bibNumber: 101, status: "FINISHED", gunTimeMs: T(40, 9), chipTimeMs: null, changed: ["time"], chosenFromHistory: true }),
    ];
    expect(recordedTimesOf(rows, 101)).toEqual([]);
  });

  it("leaves out a row it cannot read, never guessing: no number, no time, an action it does not read", () => {
    const rows = [
      row("event_result.created", 0, { status: "FINISHED", gunTimeMs: T(40, 0), finishLine: true }),
      row("event_result.finish_duplicate", 1, { bibNumber: 101, gunTimeMs: "0:40:00", finishLine: true }),
      row("event_result.created", 2, null),
      row("event.race_gun_set", 3, { bibNumber: 101, gunTimeMs: T(40, 0), finishLine: true }),
    ];
    expect(recordedFinishTimes(rows).size).toBe(0);
    expect(RECORDED_TIME_ACTIONS).toEqual(["event_result.created", "event_result.updated", "event_result.finish_duplicate", "event_result.deleted", "event.results_reset"]);
  });

  it("knows a recorded time from any other, for «Folosește»", () => {
    const times = recordedTimesOf([press(102, T(45, 12), 15), again(102, T(45, 17), T(45, 12), 20)], 102);
    expect(isRecordedTime(times, T(45, 17))).toBe(true);
    expect(isRecordedTime(times, T(45, 18))).toBe(false);
    expect(isRecordedTime([], T(45, 17))).toBe(false);
  });
});

describe("§1012 when a line of «Clasament» draws «Timpi la sosire»", () => {
  const one = recordedTimesOf([press(102, T(45, 12), 15)], 102);
  const two = recordedTimesOf([press(102, T(45, 12), 15), again(102, T(45, 17), T(45, 12), 20)], 102);
  /** A line's stored result, as the rule reads it: «Sosit» at a time, or a state with none. */
  const finished = (gunTimeMs: number) => ({ status: "FINISHED", gunTimeMs });
  const writtenOff = (status: "DNF" | "DNS" | "DSQ") => ({ status, gunTimeMs: null });

  it("draws it for a choice: two times or more, whatever the line shows", () => {
    expect(recordedTimesOffered(two, finished(T(45, 12)))).toBe(true);
    expect(recordedTimesOffered(two, finished(T(45, 17)))).toBe(true);
    expect(recordedTimesOffered(two, null)).toBe(true);
  });

  it("draws it for one time that is not the line's «Timp» — typed otherwise, a line with no result, or one written off «Abandon» or «Neprezentat»", () => {
    expect(recordedTimesOffered(one, finished(T(45, 15)))).toBe(true);
    expect(recordedTimesOffered(one, null)).toBe(true);
    // A runner written off by mistake who was pressed at the line: the block stays, «Folosește» makes them «Sosit».
    expect(recordedTimesOffered(one, writtenOff("DNF"))).toBe(true);
    expect(recordedTimesOffered(one, writtenOff("DNS"))).toBe(true);
    expect(recordedTimesOffered(two, writtenOff("DNS"))).toBe(true);
  });

  it("draws nothing for one time equal to the line's, or for none", () => {
    expect(recordedTimesOffered(one, finished(T(45, 12)))).toBe(false);
    expect(recordedTimesOffered([], finished(T(45, 12)))).toBe(false);
    expect(recordedTimesOffered([], null)).toBe(false);
  });

  it("draws nothing on a «Descalificat» line, whatever was recorded: a disqualification is changed by hand in «Stare», never by «Folosește»", () => {
    expect(recordedTimesOffered(one, writtenOff("DSQ"))).toBe(false);
    expect(recordedTimesOffered(two, writtenOff("DSQ"))).toBe(false);
    // A disqualification typed with a time still stored is no «Sosit» time either way.
    expect(recordedTimesOffered(two, { status: "DSQ", gunTimeMs: T(45, 12) })).toBe(false);
    expect(mayChooseRecordedTime(writtenOff("DSQ"))).toBe(false);
    for (const stored of [null, finished(T(45, 12)), writtenOff("DNF"), writtenOff("DNS")]) expect(mayChooseRecordedTime(stored), JSON.stringify(stored)).toBe(true);
  });

  it("marks «în clasament» only a «Sosit» line's own time", () => {
    expect(shownFinishTime(finished(T(45, 12)))).toBe(T(45, 12));
    expect(shownFinishTime(writtenOff("DNS"))).toBeNull();
    expect(shownFinishTime({ status: "DSQ", gunTimeMs: T(45, 12) })).toBeNull();
    expect(shownFinishTime(null)).toBeNull();
  });
});

describe("§1012 what «Folosește» posts: the number, the time and the line's own fingerprint", () => {
  const stored = (over: Partial<FingerprintedResult> = {}): FingerprintedResult => ({
    bibNumber: 102,
    registrationId: "registration-102",
    displayName: null,
    sex: null,
    birthDate: null,
    status: "FINISHED",
    gunTimeMs: T(45, 12),
    chipTimeMs: null,
    note: null,
    ...over,
  });

  it("fingerprints one line by its one row's own columns, or by none — the whole list's rule, on that line alone", () => {
    expect(resultLineFingerprint(stored())).toBe(resultsFingerprint([stored()]));
    expect(resultLineFingerprint(null)).toBe(resultsFingerprint([]));
    expect(resultLineFingerprint(undefined)).toBe(resultLineFingerprint(null));
    expect(resultLineFingerprint(stored())).toMatch(/^[0-9a-f]{16}$/);
    // The line's own write moves it; nothing about another line can, since only this row is in it.
    for (const change of [{ gunTimeMs: T(45, 17) }, { status: "DNS", gunTimeMs: null }, { note: "corectat" }, { chipTimeMs: T(45, 10) }, { registrationId: null }]) {
      expect(resultLineFingerprint(stored(change)), JSON.stringify(change)).not.toBe(resultLineFingerprint(stored()));
    }
    expect(resultLineFingerprint(stored())).not.toBe(resultLineFingerprint(null));
  });

  it("posts `<number>:<milliseconds>:<fingerprint>` and reads back exactly that, nothing the page never draws", () => {
    const line = resultLineFingerprint(stored());
    const value = chosenTimeValue(102, T(45, 17), line);
    expect(value).toBe(`102:${T(45, 17)}:${line}`);
    expect(readChosenTime(value)).toEqual({ bibNumber: 102, gunTimeMs: T(45, 17), lineFingerprint: line });
    expect(readChosenTime(` ${value} `)).toEqual({ bibNumber: 102, gunTimeMs: T(45, 17), lineFingerprint: line });
    // A line with no result posts the fingerprint of none.
    expect(readChosenTime(chosenTimeValue(103, T(52, 0), resultLineFingerprint(null)))?.lineFingerprint).toBe(resultsFingerprint([]));
    for (const forged of [`102:${T(45, 17)}`, `102:${T(45, 17)}:`, `102:${T(45, 17)}:ABCDEF0123456789`, `102:${T(45, 17)}:${line}0`, `102:repede:${line}`, `x:${T(45, 17)}:${line}`, ""]) {
      expect(readChosenTime(forged), forged).toBeNull();
    }
  });
});
