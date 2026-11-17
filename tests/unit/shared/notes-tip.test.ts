import { describe, expect, it } from "vitest";
import { notesTip, TIP_NOTE_CHARS, TIP_NOTES } from "@/shared/notes/note-text";

/**
 * BR-REQ-070-01, `DECISIONS.md` §943 — the owner, 2026-11-12, of the marker «1 notă» on the registrations list: «Ar trebui
 * să văd nota și pe tooltip, fără să deschid înscrierea». The marker's tooltip is the newest notes' own words.
 */
const when = (at: Date) => `ziua ${at.getUTCDate()}`;
const more = (left: number) => `… și încă ${left}`;
const note = (day: number, body: string) => ({ createdAt: new Date(Date.UTC(2026, 10, day, 9)), body });

describe("§943 the notes marker's tooltip", () => {
  it("is nothing without notes", () => {
    expect(notesTip(undefined, when, more)).toBe("");
    expect(notesTip([], when, more)).toBe("");
  });

  it("says each note with its day, newest first as given, a blank line between two", () => {
    expect(notesTip([note(12, "cere tricou S"), note(3, "vine cu soția")], when, more)).toBe("ziua 12: cere tricou S\n\nziua 3: vine cu soția");
  });

  it("keeps a note's own lines and trims its ends", () => {
    expect(notesTip([note(5, "  primul rând\r\nal doilea rând  ")], when, more)).toBe("ziua 5: primul rând\nal doilea rând");
  });

  it("cuts a long note at its ceiling, by characters and never inside one", () => {
    const tip = notesTip([note(1, `${"ă".repeat(TIP_NOTE_CHARS)}🏃 și restul`)], when, more);
    expect(tip).toBe(`ziua 1: ${"ă".repeat(TIP_NOTE_CHARS)}…`);
    // Exactly at the ceiling nothing is cut.
    expect(notesTip([note(1, "x".repeat(TIP_NOTE_CHARS))], when, more)).toBe(`ziua 1: ${"x".repeat(TIP_NOTE_CHARS)}`);
  });

  it("shows the newest few and counts the older ones in its last line", () => {
    const notes = Array.from({ length: TIP_NOTES + 2 }, (_, index) => note(20 - index, `nota ${index + 1}`));
    const lines = notesTip(notes, when, more).split("\n\n");
    expect(lines).toHaveLength(TIP_NOTES + 1);
    expect(lines[0]).toBe("ziua 20: nota 1");
    expect(lines.at(-1)).toBe("… și încă 2");
    // Exactly the few: no closing line.
    expect(notesTip(notes.slice(0, TIP_NOTES), when, more).split("\n\n")).toHaveLength(TIP_NOTES);
  });
});

/**
 * §NNN — the owner, 2026-11-17, of the «Voluntari» list's «Note interne»: «la nota internă nu mai afișa și data». With no clock
 * (`when` null) each shown note is its words alone; everything else is the tooltip above, unchanged.
 */
describe("§NNN the same words without the day", () => {
  it("is nothing without notes", () => {
    expect(notesTip(undefined, null, more)).toBe("");
    expect(notesTip([], null, more)).toBe("");
  });

  it("says each note's words alone, newest first as given, a blank line between two — no day, no colon before them", () => {
    expect(notesTip([note(12, "cere tricou S"), note(3, "vine cu soția")], null, more)).toBe("cere tricou S\n\nvine cu soția");
    expect(notesTip([note(12, "Fotograf")], null, more)).toBe("Fotograf");
  });

  it("keeps a note's own lines, trims its ends and cuts a long one as the dated tooltip does", () => {
    expect(notesTip([note(5, "  primul rând\r\nal doilea rând  ")], null, more)).toBe("primul rând\nal doilea rând");
    expect(notesTip([note(1, `${"ă".repeat(TIP_NOTE_CHARS)}🏃 și restul`)], null, more)).toBe(`${"ă".repeat(TIP_NOTE_CHARS)}…`);
    expect(notesTip([note(1, "x".repeat(TIP_NOTE_CHARS))], null, more)).toBe("x".repeat(TIP_NOTE_CHARS));
  });

  it("shows the newest few and counts the older ones in its last line, as today", () => {
    const notes = Array.from({ length: TIP_NOTES + 2 }, (_, index) => note(20 - index, `nota ${index + 1}`));
    expect(notesTip(notes, null, more).split("\n\n")).toEqual(["nota 1", "nota 2", "nota 3", "… și încă 2"]);
    // The dated tooltip of the same notes is the same lines with their days: only the day is left out.
    expect(notesTip(notes, when, more).split("\n\n")).toEqual(["ziua 20: nota 1", "ziua 19: nota 2", "ziua 18: nota 3", "… și încă 2"]);
  });
});
