import { describe, expect, it } from "vitest";
import { notesTip, TIP_NOTE_CHARS, TIP_NOTES } from "@/shared/notes/note-text";

/**
 * BR-REQ-070-01, `DECISIONS.md` §NNN — the owner, 2026-11-12, of the marker «1 notă» on the registrations list: «Ar trebui
 * să văd nota și pe tooltip, fără să deschid înscrierea». The marker's tooltip is the newest notes' own words.
 */
const when = (at: Date) => `ziua ${at.getUTCDate()}`;
const more = (left: number) => `… și încă ${left}`;
const note = (day: number, body: string) => ({ createdAt: new Date(Date.UTC(2026, 10, day, 9)), body });

describe("§NNN the notes marker's tooltip", () => {
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
