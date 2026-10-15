import { describe, expect, it } from "vitest";
import { countForm } from "@/i18n/count-form";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * §777 — the words of «Note interne», in both languages (the owner's own words, and the house rules for words:
 * every key in Română AND English, no ICU plural, a counted phrase as `one` / `few` / `other`, short sentences).
 */
const keysOf = (value: unknown, prefix = ""): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key))
    : [prefix];

const leavesOf = (value: unknown): string[] =>
  typeof value === "string" ? [value] : typeof value === "object" && value !== null ? Object.values(value).flatMap(leavesOf) : [];

const strings = (catalogue: typeof ro) => ({
  notes: catalogue.Admin.registrations.notes,
  audit: [catalogue.Admin.registrations.audit.registration.note_added, catalogue.Admin.registrations.audit.registration.note_deleted],
  confirm: [catalogue.Admin.confirm.noteDeleteTitle, catalogue.Admin.confirm.noteDeleteBody],
  errors: [catalogue.Admin.errors.NOTE_EMPTY, catalogue.Admin.errors.NOTE_TOO_LONG],
  person: [catalogue.Admin.person.notes, catalogue.Admin.person.noteBy, catalogue.Admin.person.noteAuthorGone],
  toast: [catalogue.Feedback.toast.noteAdded, catalogue.Feedback.toast.noteDeleted],
});

describe("§777 the words of the notes", () => {
  it("has every key in both languages", () => {
    expect(keysOf(strings(ro)).sort()).toEqual(keysOf(strings(en)).sort());
  });

  it("says what the owner asked, word for word", () => {
    expect(ro.Admin.registrations.notes).toMatchObject({
      title: "Note interne",
      add: "Adaugă o notă",
      save: "Salvează nota",
      delete: "Șterge",
      help: "Doar organizatorii și administratorii văd notele. Nu scrie date medicale sau alte date sensibile.",
    });
    expect(en.Admin.registrations.notes).toMatchObject({
      title: "Internal notes",
      add: "Add a note",
      save: "Save the note",
      delete: "Delete",
      help: "Only organizers and administrators see the notes. Do not write medical or other sensitive data.",
    });
  });

  it("counts in the closed line as three plain keys and no ICU plural", () => {
    for (const catalogue of [ro, en]) {
      const text = JSON.stringify(strings(catalogue));
      expect(text).not.toMatch(/plural|\{count,/);
      expect(Object.keys(catalogue.Admin.registrations.notes.count).sort()).toEqual(["few", "one", "other"]);
    }
    const line = (catalogue: typeof ro, count: number, locale: string) =>
      catalogue.Admin.registrations.notes.count[countForm(count, locale)].replace("{count}", String(count));
    expect([1, 3, 20].map((count) => line(ro, count, "ro"))).toEqual(["1 notă", "3 note", "20 de note"]);
    expect([1, 3].map((count) => line(en, count, "en"))).toEqual(["1 note", "3 notes"]);
    expect([ro.Admin.registrations.notes.none, en.Admin.registrations.notes.none]).toEqual(["nicio notă", "no notes"]);
  });

  it("keeps every sentence short enough to read at a glance", () => {
    for (const catalogue of [ro, en]) {
      // Each string on its own: one without a full stop must not run into the next key's words.
      const sentences = leavesOf(strings(catalogue)).flatMap((text) => text.split(/[.!?]\s/).map((sentence) => sentence.trim()));
      for (const sentence of sentences) expect(sentence.length, sentence).toBeLessThanOrEqual(200);
    }
  });

  it("names the person on the list marker's accessible name and writes the imperatives right", () => {
    expect(ro.Admin.registrations.notes.mark).toBe("Note interne la {name}: {counted}");
    expect(en.Admin.registrations.notes.mark).toBe("Internal notes on {name}: {counted}");
    expect(ro.Admin.errors.NOTE_TOO_LONG).toBe("Nota e prea lungă. Scurtează-o sau împarte-o în două note.");
    expect(ro.Admin.confirm.noteDeleteBody).not.toContain("cu tot cu cuvinte");
    expect(en.Admin.confirm.noteDeleteBody).not.toContain("words and all");
  });
});
