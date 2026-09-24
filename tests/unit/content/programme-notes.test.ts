import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-050-02 criterion 13 — the programme reads as one thing in the editor: the timed rows
 * are the programme (§117), and the per-language rich text is the notes beneath them (§96).
 *
 * The owner, in the editor: "programul evenimentului e duplicat!". Two folds far apart carried
 * the same word, and two hints had to say where the other one was. Since the editor's boxes
 * (§NNN) the rows and the notes share one box, "Programul zilei și ce să aduci" — the rows first,
 * then the notes and what to bring in the box's own Română | English tabs — so the hints are gone:
 * nothing is far away any more.
 *
 * Source assertions, like `editor-order.test.ts`.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const BOX = read("src/modules/content/events/ui/boxes/ProgrammeBox.tsx");
const FIELDS = read("src/modules/content/events/ui/TranslationFields.tsx");
const PROGRAMME = read("src/modules/events/ui/EventProgramme.tsx");
const CATALOGUES = ["messages/ro.json", "messages/en.json"].map((file) => ({
  file,
  messages: JSON.parse(read(file)) as { Admin: { editor: Record<string, unknown> & { fields: Record<string, string> } }; Event: Record<string, string> },
}));

describe("BR-REQ-050-02 criterion 13 — the rows are the programme, the text is the notes under it", () => {
  it("renders the rows first and the notes after them, in one box", () => {
    expect(BOX.indexOf("<ScheduleRowsEditor")).toBeGreaterThan(-1);
    expect(BOX.indexOf("<ScheduleRowsEditor")).toBeLessThan(BOX.indexOf("<ProgrammeTextFields"));
  });

  it("labels the per-language rich text as notes under the programme, not as the programme", () => {
    const piece = FIELDS.slice(FIELDS.indexOf("export async function ProgrammeTextFields"), FIELDS.indexOf("export async function RulesFields"));
    const fold = piece.indexOf(`name={name("schedule")}`);
    expect(fold, "the notes fold still posts `schedule`, the column it always wrote").toBeGreaterThan(-1);
    expect(piece).toContain(`label={t("editor.fields.scheduleNotes")}`);
    expect(piece).toContain(`summary={t("editor.fields.scheduleNotes")}`);
    expect(piece).not.toContain(`t("editor.fields.schedule")`);
    expect(piece).toContain(`emptyHint={t("editor.bodyEmpty")}`);
    // What to bring is on every type, in the same tabs (moved out of the description, §NNN).
    expect(piece.indexOf(`name={name("checklist")}`)).toBeGreaterThan(fold);
  });

  it("hides the rows and the notes on a group run, and says why, keeping what to bring (§111)", () => {
    expect(BOX).toContain('t("editor.groupRunNoProgramme")');
    expect(FIELDS).toMatch(/<OnlyForType type=\{EVENT_TYPES\.filter\(hasProgramme\)\}[\s\S]{0,200}name=\{name\("schedule"\)\}/);
  });

  it("carries the words in both catalogues, with the bridge hints gone", () => {
    for (const { file, messages } of CATALOGUES) {
      const editor = messages.Admin.editor;
      expect(editor.fields.scheduleNotes, `${file}: fields.scheduleNotes`).toBeTruthy();
      expect(editor.scheduleHelp, `${file}: scheduleHelp is gone`).toBeUndefined();
      expect(editor.programmeNotesHint, `${file}: programmeNotesHint is gone`).toBeUndefined();
      // The heading on the public page and the preview stays "the event's programme".
      expect(editor.fields.schedule, `${file}: fields.schedule`).toBeTruthy();
      expect(messages.Event.schedule, `${file}: Event.schedule`).toBeTruthy();
    }
    const [ro, en] = CATALOGUES.map(({ messages }) => messages.Admin.editor);
    expect(ro.fields.scheduleNotes).toBe("Note sub program");
    expect(en.fields.scheduleNotes).toBe("Notes under the programme");
  });

  it("renders the rows first and the notes beneath them on the public page, and both still exist", () => {
    const rows = PROGRAMME.indexOf('component="dl"');
    const notes = PROGRAMME.indexOf("<RichText body={scheduleJson} />");
    expect(rows).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(rows);
    expect(FIELDS).toContain(`initialBody={translation.scheduleJson}`);
    expect(read("src/modules/content/events/ui/ScheduleRowsEditor.tsx")).toContain("`event.schedule[${index}].${box}`");
    expect(FIELDS).not.toContain("ScheduleRowsEditor");
  });
});
