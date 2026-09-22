import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-050-02 criterion 13 — the programme reads as one thing in the editor: the timed rows
 * in "Când și unde" are the programme (§117), and the per-language rich text is the notes
 * beneath them (§96).
 *
 * The owner, in the editor: "programul evenimentului e duplicat!". Two folds far apart carried
 * the same word — a rich-text "Programul evenimentului" in each language panel and a "Program"
 * table of rows in the settings — and a reader could not tell which to fill in. They are not
 * the same feature: the rows are one list for both languages with one calendar entry each,
 * repeated in the reminder; the text is what does not fit a row. So the fold says "notes", its
 * hint says where the rows are, and a caption under the rows says where the notes are.
 *
 * Source assertions, like `editor-order.test.ts`: both panels are Server Components that
 * render what they are handed, and what is pinned is which label each one carries, in which
 * order the page renders the two, and that neither feature moved or vanished.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const TRANSLATION_FORM = read("src/modules/content/events/ui/TranslationFieldsForm.tsx");
const EVENT_FORM = read("src/modules/content/events/ui/EventFieldsForm.tsx");
const PROGRAMME = read("src/modules/events/ui/EventProgramme.tsx");
const CATALOGUES = ["messages/ro.json", "messages/en.json"].map((file) => ({
  file,
  messages: JSON.parse(read(file)) as { Admin: { editor: Record<string, unknown> & { fields: Record<string, string>; panels: Record<string, string> } }; Event: Record<string, string> },
}));

describe("BR-REQ-050-02 criterion 13 — the rows are the programme, the text is the notes under it", () => {
  it("labels the per-language rich text as notes under the programme, not as the programme", () => {
    const fold = TRANSLATION_FORM.indexOf(`name={name("schedule")}`);
    expect(fold, "the notes fold still posts `schedule`, the column it always wrote").toBeGreaterThan(-1);
    const block = TRANSLATION_FORM.slice(fold, TRANSLATION_FORM.indexOf("</OnlyForType>", fold));
    expect(block).toContain(`label={t("editor.fields.scheduleNotes")}`);
    expect(block).toContain(`summary={t("editor.fields.scheduleNotes")}`);
    expect(block).not.toContain(`t("editor.fields.schedule")`);
    // "Note" is not "Programul": the empty hint has to agree with it, so it is the neutral one.
    expect(block).toContain(`emptyHint={t("editor.bodyEmpty")}`);
    // The hint names the panel and the section where the rows live, from the catalogue, so a
    // renamed panel cannot leave the hint pointing at a name that no longer exists.
    expect(block).toContain(`t("editor.scheduleHelp", { panel: t("editor.panels.when"), section: t("editor.programmeSection") })`);
  });

  it("puts a caption under the rows that says where the notes are and that they are per language", () => {
    const rows = EVENT_FORM.indexOf("<ScheduleRowsEditor");
    expect(rows).toBeGreaterThan(-1);
    const caption = EVENT_FORM.indexOf(`t("editor.programmeNotesHint", { panel: t("editor.contentSection"), fold: t("editor.fields.scheduleNotes") })`);
    expect(caption, "the caption is missing from the rows panel").toBeGreaterThan(rows);
    // Inside the same type-gated block: a group run has neither the rows nor the notes (§111).
    expect(caption).toBeLessThan(EVENT_FORM.indexOf("</OnlyForType>", rows));
  });

  it("carries the words in both catalogues, and keeps the public heading as it was", () => {
    for (const { file, messages } of CATALOGUES) {
      const editor = messages.Admin.editor;
      expect(editor.fields.scheduleNotes, `${file}: fields.scheduleNotes`).toBeTruthy();
      expect(editor.scheduleHelp, `${file}: scheduleHelp`).toMatch(/\{panel\}.*\{section\}/);
      expect(editor.programmeNotesHint, `${file}: programmeNotesHint`).toMatch(/\{panel\}.*\{fold\}/);
      // The heading on the public page and the preview stays "the event's programme": a visitor
      // sees one programme, and the renaming is the editor's alone.
      expect(editor.fields.schedule, `${file}: fields.schedule`).toBeTruthy();
      expect(messages.Event.schedule, `${file}: Event.schedule`).toBeTruthy();
      expect(editor.fields.scheduleNotes).not.toBe(editor.fields.schedule);
    }
    const [ro, en] = CATALOGUES.map(({ messages }) => messages.Admin.editor);
    expect(ro.fields.scheduleNotes).toBe("Note sub program");
    expect(en.fields.scheduleNotes).toBe("Notes under the programme");
  });

  it("renders the rows first and the notes beneath them on the page, and both still exist", () => {
    // `EventProgramme` is what the public page and the preview share (§117): the `<dl>` of rows,
    // then the rich text. The reminder repeats the rows (`eventProgramme`) and links `#schedule`,
    // where the notes are — it carries no second copy of the text.
    const rows = PROGRAMME.indexOf('component="dl"');
    const notes = PROGRAMME.indexOf("<RichText body={scheduleJson} />");
    expect(rows).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(rows);
    // Neither feature was removed, and no field moved between the event row and the translations:
    // the notes still post `translations.<locale>.schedule` from the language panel, and the rows
    // still post `event.schedule[i].<box>` from the settings' island.
    expect(TRANSLATION_FORM).toContain(`initialBody={translation.scheduleJson}`);
    expect(EVENT_FORM).toContain("<ScheduleRowsEditor");
    expect(read("src/modules/content/events/ui/ScheduleRowsEditor.tsx")).toContain("`event.schedule[${index}].${box}`");
    expect(TRANSLATION_FORM).not.toContain("ScheduleRowsEditor");
    expect(EVENT_FORM).not.toContain(`name("schedule")`);
  });
});
