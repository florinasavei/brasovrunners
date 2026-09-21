import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * BR-REQ-050-02 criterion 19 — the editor's panels, and the sentences inside them
 * (`DECISIONS.md` §170).
 *
 * The registration panel holds two windows: when people may sign up, and when the ones who
 * have signed up are asked to confirm they are coming (§104). Both are a pair of inputs with a
 * sentence under it, and the two sentences sat as siblings of both pairs — so the first one,
 * "leave the opening empty and registration starts at publication", stood directly above the
 * two participation-window numbers and read as a rule about them. The owner: "partea asta nu e
 * prea clară".
 *
 * A caption between two groups belongs to the group *above* it only if nothing else claims it,
 * so each sentence is now inside its group's own box and the second group carries a heading of
 * its own. This test reads the file because the failure is an ordering one: nothing type-checks
 * a sentence back above the wrong pair.
 */
const FORM = path.join(process.cwd(), "src", "modules", "content", "events", "ui", "EventFieldsForm.tsx");
const source = readFileSync(FORM, "utf8");

const at = (needle: string) => {
  const index = source.indexOf(needle);
  expect(index, `${needle} is in the editor`).toBeGreaterThan(-1);
  return index;
};

describe("BR-REQ-050-02 the registration panel's two windows read as two questions", () => {
  it("puts the registration-window sentence under the pair it describes", () => {
    expect(at("editor.registrationWindowHelp")).toBeGreaterThan(at("editor.registrationClosesAt"));
  });

  it("puts it above the participation window rather than inside it", () => {
    // The order on the screen is: the two dates, their sentence, the heading, the two numbers,
    // their sentence. Anything else is how the sentence came to describe the wrong fields.
    expect(at("editor.confirmationWindowTitle")).toBeGreaterThan(at("editor.registrationWindowHelp"));
    expect(at("editor.confirmationOpensDaysBefore")).toBeGreaterThan(at("editor.confirmationWindowTitle"));
    expect(at("editor.confirmationWindowHelp")).toBeGreaterThan(at("editor.confirmationDeadlineDaysBefore"));
  });

  it("gives the participation window a heading under the panel's own", () => {
    // The panel's title is an `h2` (`EditorPanel`), so a group inside it is an `h3` — a
    // heading level skipped inside a form is a screen reader reading a list with a hole in it.
    expect(source).toMatch(/component="h3"[\s\S]{0,120}editor\.confirmationWindowTitle/);
  });

  it("names it in both languages", () => {
    expect(ro.Admin.editor.confirmationWindowTitle).toBe("Confirmarea participării");
    expect(en.Admin.editor.confirmationWindowTitle).toBe("Participation confirmation");
  });

  it("renames no field: every input still posts the name it posted before", () => {
    // Criterion 19's own words. The regrouping is a box around inputs, nothing more — a
    // renamed input would silently start saving "not stated" (`actions.ts#eventFieldsFrom`).
    for (const name of [
      "event.registrationOpensAt",
      "event.registrationClosesAt",
      "event.confirmationOpensDaysBefore",
      "event.confirmationDeadlineDaysBefore",
    ]) {
      expect(source, name).toContain(`name="${name}"`);
    }
  });
});
