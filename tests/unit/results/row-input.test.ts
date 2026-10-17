import { describe, expect, it } from "vitest";
import { type ReadResult, type RowBoxes, readResultRow } from "@/modules/results/domain/row-input";

/**
 * §NNN, BR-REQ-050-02 — one row of the «Clasament» form, read: blank, a row with values, or refused naming the problem and the box. The
 * rules in the order they are asked: the number, the status, the time with the status, the note, then what is typed for a typed runner.
 */
const DAY = "2026-11-21";
const boxes = (over: Partial<RowBoxes> = {}): RowBoxes => ({ kind: "registered", bib: "101", name: "", sex: "", birthDate: "", time: "", status: "", chip: "", note: "", ...over });
const typed = (over: Partial<RowBoxes> = {}) => boxes({ kind: "typed", ...over });
const refused = (result: ReadResult) => (result.kind === "refused" ? { problem: result.problem, boxes: result.boxes } : result);
const row = (result: ReadResult) => (result.kind === "row" ? result.row : result);
const MIN = 60_000;

describe("§NNN readResultRow — blank, and what the status defaults to", () => {
  it("is blank when every box is empty: most lines stay empty until the runner finishes", () => {
    expect(readResultRow(boxes(), DAY)).toEqual({ kind: "blank" });
    expect(readResultRow(typed({ bib: "" }), DAY)).toEqual({ kind: "blank" });
  });

  it("makes a typed time a finish, and a note alone a runner who did not start", () => {
    expect(row(readResultRow(boxes({ time: "45:12" }), DAY))).toMatchObject({ bibNumber: 101, status: "FINISHED", gunTimeMs: 45 * MIN + 12_000 });
    expect(row(readResultRow(boxes({ note: "a venit pe jos" }), DAY))).toMatchObject({ status: "DNS", gunTimeMs: null, note: "a venit pe jos" });
  });

  it("takes the status in either case, and the chip's time beside a finish", () => {
    expect(row(readResultRow(boxes({ status: "dnf" }), DAY))).toMatchObject({ status: "DNF", gunTimeMs: null });
    expect(row(readResultRow(boxes({ time: "45:12", chip: "45:10", status: "finished" }), DAY))).toMatchObject({ status: "FINISHED", chipTimeMs: 45 * MIN + 10_000 });
  });
});

describe("§NNN readResultRow — the refusals, each naming its box", () => {
  it("refuses a bad race number on a typed row", () => {
    for (const bib of ["abc", "0", "-3", "1.5", "1234567"]) expect(refused(readResultRow(typed({ bib, time: "45:12" }), DAY)), bib).toEqual({ problem: "bib", boxes: ["bib"] });
    expect(refused(readResultRow(typed({ bib: "", time: "45:12" }), DAY))).toEqual({ problem: "bib", boxes: ["bib"] });
  });

  it("refuses a status nobody knows", () => {
    expect(refused(readResultRow(boxes({ status: "ALTCEVA", time: "45:12" }), DAY))).toEqual({ problem: "status", boxes: ["status"] });
  });

  it("refuses a finish with no time, or a time that cannot be read", () => {
    expect(refused(readResultRow(boxes({ status: "FINISHED" }), DAY))).toEqual({ problem: "timeMissing", boxes: ["time"] });
    expect(refused(readResultRow(boxes({ time: "45" }), DAY))).toEqual({ problem: "time", boxes: ["time"] });
    expect(refused(readResultRow(boxes({ time: "45:12", chip: "x" }), DAY))).toEqual({ problem: "chip", boxes: ["chip"] });
  });

  it("refuses a time beside a status that has none", () => {
    for (const status of ["DNF", "DNS", "DSQ"]) {
      expect(refused(readResultRow(boxes({ status, time: "45:12" }), DAY)), status).toEqual({ problem: "timeWithStatus", boxes: ["time"] });
      expect(refused(readResultRow(boxes({ status, chip: "45:12" }), DAY)), status).toEqual({ problem: "timeWithStatus", boxes: ["chip"] });
    }
  });

  it("refuses a note over 200 characters", () => {
    expect(refused(readResultRow(boxes({ time: "45:12", note: "x".repeat(201) }), DAY))).toEqual({ problem: "note", boxes: ["note"] });
    expect(readResultRow(boxes({ time: "45:12", note: "x".repeat(200) }), DAY).kind).toBe("row");
  });
});

describe("§NNN readResultRow — what is typed about a runner the club typed", () => {
  it("keeps the name, the sex and the birth date, day first", () => {
    expect(row(readResultRow(typed({ bib: "900", name: "  Ion Vasile ", sex: "male", birthDate: "05.03.1985", time: "50:00" }), DAY))).toMatchObject({
      bibNumber: 900,
      name: "Ion Vasile",
      sex: "MALE",
      birthDate: "1985-03-05",
    });
  });

  it("refuses a name over 120 characters, a sex that is not one of the two, a birth date that is no day or is after the race", () => {
    expect(refused(readResultRow(typed({ bib: "900", name: "x".repeat(121), time: "50:00" }), DAY))).toEqual({ problem: "nameLong", boxes: ["name"] });
    expect(refused(readResultRow(typed({ bib: "900", name: "Ion", sex: "UNSPECIFIED", time: "50:00" }), DAY))).toEqual({ problem: "sex", boxes: ["sex"] });
    for (const birthDate of ["31.02.1990", "ieri", "22.11.2026", "01.01.2030"]) {
      expect(refused(readResultRow(typed({ bib: "900", name: "Ion", birthDate, time: "50:00" }), DAY)), birthDate).toEqual({ problem: "birthDate", boxes: ["birthDate"] });
    }
    expect(row(readResultRow(typed({ bib: "900", name: "Ion", birthDate: "21.11.2026", time: "50:00" }), DAY))).toMatchObject({ birthDate: "2026-11-21" });
  });

  it("leaves a registered row's name, sex and birth date out: they are the registration's", () => {
    expect(row(readResultRow(boxes({ name: "Altcineva", sex: "FEMALE", birthDate: "01.01.1990", time: "45:12" }), DAY))).toMatchObject({ sex: null, birthDate: null });
  });
});
