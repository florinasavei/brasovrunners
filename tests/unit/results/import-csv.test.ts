import { describe, expect, it } from "vitest";
import { parseResultsCsv, RESULTS_CSV_MAX_CHARS, ResultsCsvError, resultStatusOfWord } from "@/modules/results/domain/import-csv";

/**
 * §NNN, BR-REQ-050-02 — «Importă din CSV»: `bib,time[,chip][,status]`, with a header or without, separated by a comma, a semicolon or a
 * tab; times as the boxes take them; the status as its code or its word in either language. The first bad line refuses the whole file.
 */
const sec = (n: number) => n * 1000;
const T = sec(45 * 60 + 12);

function refusal(text: string): { line: number; problem: string } {
  try {
    parseResultsCsv(text);
  } catch (error) {
    if (error instanceof ResultsCsvError) return { line: error.line, problem: error.problem };
    throw error;
  }
  throw new Error("the file was read");
}

describe("§NNN parseResultsCsv — the shape", () => {
  it("reads bib,time with no header", () => {
    expect(parseResultsCsv("101,45:12\n102,1:02:03")).toEqual([
      { line: 1, bibNumber: 101, status: "FINISHED", gunTimeMs: T, chipTimeMs: null },
      { line: 2, bibNumber: 102, status: "FINISHED", gunTimeMs: sec(3723), chipTimeMs: null },
    ]);
  });

  it("reads the chip's time as a third cell, and a status as the fourth", () => {
    expect(parseResultsCsv("101,45:12,45:10,FINISHED")[0]).toMatchObject({ gunTimeMs: T, chipTimeMs: sec(45 * 60 + 10), status: "FINISHED" });
  });

  it("takes a third cell that is a status word for the status, not the chip", () => {
    expect(parseResultsCsv("101,,,DNF")[0]).toMatchObject({ status: "DNF", gunTimeMs: null });
    expect(parseResultsCsv("102,,DNS")[0]).toMatchObject({ status: "DNS", chipTimeMs: null });
  });

  it("finds the columns by a header's names, in Romanian or English, in any order", () => {
    expect(parseResultsCsv("Timp;Nr.;Status\n45:12;101;sosit")).toEqual([{ line: 2, bibNumber: 101, status: "FINISHED", gunTimeMs: T, chipTimeMs: null }]);
    expect(parseResultsCsv("BIB,Chip time,Gun time\n7,44:00,45:12")[0]).toMatchObject({ bibNumber: 7, gunTimeMs: T, chipTimeMs: sec(44 * 60) });
    expect(parseResultsCsv("Număr de concurs,Timp cip,Timp\n7,44:00,45:12")[0]).toMatchObject({ bibNumber: 7, gunTimeMs: T, chipTimeMs: sec(44 * 60) });
  });

  it("ignores a column it does not know", () => {
    expect(parseResultsCsv("Nume,Nr,Timp\nAna,101,45:12")[0]).toMatchObject({ bibNumber: 101, gunTimeMs: T });
  });

  it("derives the status when none is given: a time finished, no time did not start", () => {
    expect(parseResultsCsv("101,45:12\n102")).toMatchObject([{ status: "FINISHED" }, { status: "DNS", gunTimeMs: null }]);
    expect(parseResultsCsv("101,\n102,-")).toMatchObject([{ status: "DNS" }, { status: "DNS" }]);
  });

  it("takes a #, a BOM, blank lines and CRLF", () => {
    expect(parseResultsCsv("﻿#101,45:12\r\n\r\n102,46:00\r\n").map((row) => row.bibNumber)).toEqual([101, 102]);
  });

  it("reads quoted cells", () => {
    expect(parseResultsCsv('"101","45:12"')[0]).toMatchObject({ bibNumber: 101, gunTimeMs: T });
    expect(parseResultsCsv('Nr,Timp,Status\n101,"45:12","sosit"')[0]).toMatchObject({ status: "FINISHED" });
  });

  it("separates by a comma, a semicolon or a tab, whichever the first line uses", () => {
    for (const separator of [",", ";", "\t"]) {
      const rows = parseResultsCsv(["101", "45:12", "45:10", "FINISHED"].join(separator));
      expect(rows[0], JSON.stringify(separator)).toMatchObject({ bibNumber: 101, gunTimeMs: T, chipTimeMs: sec(45 * 60 + 10) });
    }
  });

  it("keeps a comma decimal inside a semicolon file", () => {
    expect(parseResultsCsv("101;45:12,5")[0]).toMatchObject({ gunTimeMs: T + 500 });
  });
});

describe("§NNN parseResultsCsv — the status words", () => {
  it("knows the four codes and their words in Romanian and English", () => {
    const words: Record<string, string[]> = {
      FINISHED: ["FINISHED", "finished", "Sosit", "terminat", "fin"],
      DNF: ["DNF", "abandon", "Abandonat", "did not finish"],
      DNS: ["DNS", "neprezentat", "Absent", "did not start"],
      DSQ: ["DSQ", "DQ", "descalificat", "Disqualified"],
    };
    for (const [status, list] of Object.entries(words)) for (const word of list) expect(resultStatusOfWord(word), word).toBe(status);
    expect(resultStatusOfWord("whatever")).toBeNull();
  });
});

describe("§NNN parseResultsCsv — the first bad line refuses the whole file, naming it", () => {
  it("names the line and the problem", () => {
    expect(refusal("101,45:12\nabc,46:00")).toEqual({ line: 2, problem: "bib" });
    expect(refusal("101,45:12\n102,nope")).toEqual({ line: 2, problem: "time" });
    expect(refusal("101,45:12,nope")).toEqual({ line: 1, problem: "chip" });
    expect(refusal("101,45:12,45:10,huh")).toEqual({ line: 1, problem: "status" });
    expect(refusal("101,45:12\n101,46:00")).toEqual({ line: 2, problem: "duplicate" });
    expect(refusal("101,,,FINISHED")).toEqual({ line: 1, problem: "needsTime" });
    expect(refusal("101,45:12,,DNF")).toEqual({ line: 1, problem: "timeWithStatus" });
    expect(refusal("0,45:12")).toEqual({ line: 1, problem: "bib" });
  });

  it("counts the header and the blank lines in a line's number: the number the club sees in its editor", () => {
    expect(refusal("Nr,Timp\n\n101,45:12\n102,bad")).toEqual({ line: 4, problem: "time" });
  });

  it("refuses an empty file, a header with no bib column, a header alone, an oversized file", () => {
    expect(refusal("")).toEqual({ line: 0, problem: "empty" });
    expect(refusal("  \n\n")).toEqual({ line: 0, problem: "empty" });
    expect(refusal("Nume,Timp\nAna,45:12")).toEqual({ line: 1, problem: "headerBib" });
    expect(refusal("Nr,Timp")).toEqual({ line: 0, problem: "empty" });
    expect(refusal("1,45:12\n".repeat(RESULTS_CSV_MAX_CHARS / 8 + 10))).toEqual({ line: 0, problem: "tooLarge" });
  });

  it("is a validation error the action can name by its box", () => {
    try {
      parseResultsCsv("x");
      throw new Error("the file was read");
    } catch (error) {
      expect(error).toMatchObject({ code: "RESULTS_IMPORT_INVALID", fields: ["importText"] });
    }
  });
});
