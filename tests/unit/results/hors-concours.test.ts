import { describe, expect, it } from "vitest";
import { foldEliteName, type HorsConcoursRow, horsConcoursBibs, NOBODY_OUT, type OutOfRanking } from "@/modules/results/domain/hors-concours";
import { type Rankable, rankResults } from "@/modules/results/domain/ranking";

/**
 * §NNN, BR-REQ-050-02 — «Apare în clasament» unticked: an elite runs hors concours. The ranking places it nowhere and counts it in
 * nobody's position, the others ranked as if it had not run; which stored row is an elite's is the results module's own link — the
 * registration a row is filed under, the confirmed registration holding a typed row's number, an elite line's number, and for a line
 * with no number its name, matched only when exactly one typed row carries it.
 */
const MIN = 60_000;
const runner = (bibNumber: number, gunMinutes: number, sex: Rankable["sex"], age: number, outOfRanking = false): Rankable => ({
  bibNumber,
  status: "FINISHED",
  gunTimeMs: gunMinutes * MIN,
  sex,
  ageOnRaceDay: age,
  ...(outOfRanking ? { outOfRanking: true } : {}),
});

describe("§NNN rankResults — a row hors concours", () => {
  it("places the elite nowhere and ranks the others as if it had not run: overall, by sex and by category", () => {
    const ranked = rankResults([runner(7, 30, "MALE", 35, true), runner(101, 40, "MALE", 35), runner(102, 42, "FEMALE", 35), runner(103, 45, "MALE", 35)]);
    expect(ranked.get(7)).toMatchObject({ positionOverall: null, positionSex: null, positionCategory: null, outOfRanking: true });
    // The category is what the runner is, placed or not.
    expect(ranked.get(7)?.categoryKey).toBe("MALE:from30");
    expect([101, 102, 103].map((bib) => ranked.get(bib)?.positionOverall)).toEqual([1, 2, 3]);
    expect([101, 103].map((bib) => ranked.get(bib)?.positionSex)).toEqual([1, 2]);
    expect([101, 103].map((bib) => ranked.get(bib)?.positionCategory)).toEqual([1, 2]);
    // Nobody else carries the mark.
    expect([101, 102, 103].map((bib) => ranked.get(bib)?.outOfRanking)).toEqual([undefined, undefined, undefined]);
  });

  it("is the ordinary ranking when nobody is out", () => {
    const rows = [runner(7, 30, "MALE", 35), runner(101, 40, "MALE", 35)];
    expect(rankResults(rows).get(7)?.positionOverall).toBe(1);
    expect(rankResults(rows).get(101)?.positionOverall).toBe(2);
  });
});

const out = (over: Partial<OutOfRanking>): OutOfRanking => ({ ...NOBODY_OUT, ...over });
const typed = (bibNumber: number, displayName: string | null): HorsConcoursRow => ({ bibNumber, registrationId: null, displayName });
const filed = (bibNumber: number, registrationId: string): HorsConcoursRow => ({ bibNumber, registrationId, displayName: null });
const nobodyHolds = () => null;

describe("§NNN horsConcoursBibs — which row is an elite's", () => {
  it("takes nobody out while no tick is off", () => {
    expect(horsConcoursBibs([typed(7, "Eliud Kipchoge"), filed(101, "reg-a")], NOBODY_OUT, nobodyHolds)).toEqual(new Set());
  });

  it("a registered elite: the row filed under its registration, and a typed row on the number it holds as a confirmed runner", () => {
    const rows = [filed(101, "reg-a"), typed(102, "Bia Marin"), filed(103, "reg-c")];
    const holder = (bib: number) => (bib === 102 ? "reg-b" : null);
    expect(horsConcoursBibs(rows, out({ registrations: new Set(["reg-a", "reg-b"]) }), holder)).toEqual(new Set([101, 102]));
  });

  it("a separate-list elite with a number: the typed row on that number, whatever name it was typed with", () => {
    const rows = [typed(7, "E. Kipchoge"), typed(8, "Faith Kipyegon")];
    expect(horsConcoursBibs(rows, out({ bibs: new Set([7]), listedBibs: new Set([7]) }), nobodyHolds)).toEqual(new Set([7]));
  });

  it("never by a list line's number when a confirmed registration holds the typed row's number: that row is the registered runner's", () => {
    const holder = (bib: number) => (bib === 7 ? "reg-a" : null);
    expect(horsConcoursBibs([typed(7, "Eliud Kipchoge")], out({ bibs: new Set([7]), listedBibs: new Set([7]) }), holder)).toEqual(new Set());
  });

  it("a separate-list elite with no number: the one typed row with its name — folded: spaces, case and diacritics", () => {
    const rows = [typed(900, "  ELIUD   kipchoge "), typed(901, "Ștefan Ionescu"), typed(902, "Maria Pop")];
    const names = new Set([foldEliteName("Eliud Kipchoge"), foldEliteName("Stefan Ionescu")]);
    expect(horsConcoursBibs(rows, out({ names }), nobodyHolds)).toEqual(new Set([900, 901]));
  });

  it("leaves an ambiguous name ranked: two typed rows with the line's name match neither", () => {
    const rows = [typed(900, "Ana Pop"), typed(901, "Ana  Pop"), typed(902, "Maria Pop")];
    expect(horsConcoursBibs(rows, out({ names: new Set([foldEliteName("Ana Pop")]) }), nobodyHolds)).toEqual(new Set());
  });

  it("never matches by name a row that a list line holds by number, nor a row a registration holds", () => {
    // Bib 7 is a ticked line's own number: its row is that line's, never the numberless line's by name.
    const rows = [typed(7, "Ana Pop"), typed(900, "Ana Pop"), filed(101, "reg-a")];
    expect(horsConcoursBibs(rows, out({ names: new Set([foldEliteName("Ana Pop")]), listedBibs: new Set([7]) }), nobodyHolds)).toEqual(new Set([900]));
  });

  it("folds a name as the elite list stores it", () => {
    expect(foldEliteName("  Ștefan   Ionescu-Țăran ")).toBe("stefan ionescu-taran");
  });
});
