import { describe, expect, it } from "vitest";
import { mergeImportedRows } from "@/modules/results/import-merge";
import { postedResultRows, registeredRowKey, resultBox, typedRowCountOf, typedRowKey } from "@/modules/results/rows";

/**
 * §NNN, BR-REQ-050-02 — the names the one form posts under, and what «Importă din CSV» does to the boxes: it fills them and saves nothing,
 * a number the table has a line for gets its times in that line, an unknown number becomes a new typed row with the name left to write.
 */
describe("§NNN the form's box names", () => {
  it("spells a registered runner's boxes by the race number and a typed one's by its place", () => {
    expect(resultBox(registeredRowKey(101), "time")).toBe("r[101].time");
    expect(resultBox(typedRowKey(2), "name")).toBe("n[2].name");
  });

  it("groups the posted boxes by row, in the order each row first appears, and ignores every other name", () => {
    const rows = postedResultRows([
      ["uiLocale", "ro"],
      ["r[101].time", "45:12"],
      ["r[102].time", ""],
      ["r[101].status", "FINISHED"],
      ["n[0].bib", "900"],
      ["n[0].name", "Ion"],
      ["importText", "101,45:12"],
      ["r[101].note", "x"],
    ]);
    expect(rows.map((row) => row.key)).toEqual(["r[101]", "r[102]", "n[0]"]);
    expect(rows[0]).toMatchObject({ bib: "101", time: "45:12", status: "FINISHED", note: "x" });
    expect(rows[2]).toMatchObject({ bib: "900", name: "Ion" });
  });

  it("takes a registered row's number from its key: a forged box cannot move the row to another runner", () => {
    const [row] = postedResultRows([
      ["r[101].bib", "999"],
      ["r[101].time", "45:12"],
    ]);
    expect(row.bib).toBe("101");
  });

  it("posts a typed line's agreement tick as its `agreed` box and ignores a forged one on a registered line", () => {
    const rows = postedResultRows([
      ["n[0].bib", "900"],
      ["n[0].name", "Ion"],
      ["n[0].agreed", "on"],
      ["n[1].bib", "901"],
      ["r[101].time", "45:12"],
      ["r[101].agreed", "on"],
    ]);
    expect(rows.map((row) => [row.key, row.agreed])).toEqual([["n[0]", "on"], ["n[1]", ""], ["r[101]", ""]]);
    expect(resultBox(typedRowKey(0), "agreed")).toBe("n[0].agreed");
  });

  it("counts the typed rows a form names, from 0", () => {
    expect(typedRowCountOf(["r[1].time", "uiLocale"])).toBe(0);
    expect(typedRowCountOf(["n[0].bib", "n[1].name", "n[4].time"])).toBe(5);
  });
});

describe("§NNN mergeImportedRows", () => {
  const posted = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, [value]]));
  const row = (bibNumber: number, over: Partial<Parameters<typeof mergeImportedRows>[1][number]> = {}) => ({
    bibNumber,
    status: "FINISHED" as const,
    gunTimeMs: 45 * 60_000 + 12_000,
    chipTimeMs: null,
    matched: true,
    name: "Ana",
    ...over,
  });

  it("fills the time, the chip and the status of a number the table has a line for, and leaves its note", () => {
    const merged = mergeImportedRows(posted({ "r[101].time": "", "r[101].status": "", "r[101].chip": "", "r[101].note": "a venit pe jos", uiLocale: "ro" }), [row(101, { chipTimeMs: 45 * 60_000 + 10_000 })]);
    expect(merged.values["r[101].time"]).toEqual(["0:45:12"]);
    expect(merged.values["r[101].chip"]).toEqual(["0:45:10"]);
    expect(merged.values["r[101].status"]).toEqual(["FINISHED"]);
    expect(merged.values["r[101].note"]).toEqual(["a venit pe jos"]);
    expect(merged.values.uiLocale).toEqual(["ro"]);
    expect(merged).toMatchObject({ placed: 1, added: 0 });
  });

  it("writes a status with no time as the status alone", () => {
    const merged = mergeImportedRows(posted({ "r[101].time": "0:30:00", "r[101].status": "", "r[101].chip": "" }), [row(101, { status: "DNF", gunTimeMs: null })]);
    expect(merged.values["r[101].time"]).toEqual([""]);
    expect(merged.values["r[101].status"]).toEqual(["DNF"]);
  });

  it("puts a number with no line into the blank typed line the page drew, with its times and the name left empty", () => {
    const merged = mergeImportedRows(posted({ "r[101].time": "", "n[0].bib": "", "n[0].name": "" }), [row(555, { matched: false, name: null })]);
    expect(merged.values["n[0].bib"]).toEqual(["555"]);
    expect(merged.values["n[0].time"]).toEqual(["0:45:12"]);
    expect(merged.values["n[0].status"]).toEqual(["FINISHED"]);
    expect(merged.values["n[0].name"]).toEqual([""]);
    expect(Object.keys(merged.values).some((name) => name.startsWith("n[1]"))).toBe(false);
    expect(merged).toMatchObject({ placed: 0, added: 1 });
  });

  it("adds a new typed row at the end when every line already holds something", () => {
    const merged = mergeImportedRows(posted({ "n[0].bib": "900", "n[0].name": "Ion" }), [row(555, { matched: false, name: null })]);
    expect(merged.values["n[1].bib"]).toEqual(["555"]);
    expect(merged.values["n[0].bib"]).toEqual(["900"]);
  });

  it("fills a typed row that already holds the number instead of adding another", () => {
    const merged = mergeImportedRows(posted({ "n[0].bib": "555", "n[0].name": "Ion", "n[0].time": "" }), [row(555, { matched: false, name: null })]);
    expect(merged.values["n[0].time"]).toEqual(["0:45:12"]);
    expect(merged.values["n[0].name"]).toEqual(["Ion"]);
    expect(Object.keys(merged.values).some((name) => name.startsWith("n[1]"))).toBe(false);
    expect(merged).toMatchObject({ placed: 1, added: 0 });
  });

  it("numbers the new rows one after the other, and counts both kinds", () => {
    const merged = mergeImportedRows(posted({ "r[101].time": "" }), [row(101), row(700, { matched: false }), row(701, { matched: false })]);
    expect(merged.values["n[0].bib"]).toEqual(["700"]);
    expect(merged.values["n[1].bib"]).toEqual(["701"]);
    expect(merged).toMatchObject({ placed: 1, added: 2 });
  });

  it("never mutates what it was given", () => {
    const given = posted({ "r[101].time": "" });
    mergeImportedRows(given, [row(101)]);
    expect(given["r[101].time"]).toEqual([""]);
  });
});

describe("§NNN mergeImportedRows and the agreement tick", () => {
  const posted = (entries: Record<string, string>) => Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, [value]]));
  const imported = (bibNumber: number) => ({ bibNumber, status: "FINISHED" as const, gunTimeMs: 45 * 60_000, chipTimeMs: null, matched: false, name: null });

  it("never gives an imported number a tick: a new line starts unticked, and a line already ticked keeps its tick for its own number only", () => {
    const merged = mergeImportedRows(posted({ "n[0].bib": "900", "n[0].name": "Ion", "n[0].agreed": "on" }), [imported(900), imported(555)]);
    expect(merged.values["n[0].agreed"]).toEqual(["on"]);
    expect(merged.values["n[1].bib"]).toEqual(["555"]);
    expect("n[1].agreed" in merged.values).toBe(false);
  });

  it("does not hand a ticked, otherwise empty line to an imported number: the tick would be another person's", () => {
    const merged = mergeImportedRows(posted({ "n[0].bib": "", "n[0].name": "", "n[0].agreed": "on" }), [imported(555)]);
    expect(merged.values["n[0].agreed"]).toEqual(["on"]);
    expect(merged.values["n[0].bib"]).toEqual([""]);
    expect(merged.values["n[1].bib"]).toEqual(["555"]);
    expect("n[1].agreed" in merged.values).toBe(false);
  });
});
