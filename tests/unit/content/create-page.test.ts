import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The create page is the editor — the owner, on `/admin/events/new` with a screenshot: "this
 * event create page is a bit inconsistent with the event edit: first of all, there is no rich
 * text editor?? per language content should be tabbed; link video should not be present anymore
 * since we have the rich text editor." And earlier: "«Repetă evenimentul» ar trebui să apară sus
 * de tot, la început." And of the time boxes: "timepickerul ar trebui să fie tot element MUI, nu
 * să bag eu de mână timpul." And of the place: "ar trebui să pot pune și denumirea locației în
 * română și în engleză."
 *
 * Source assertions, like `editor-order.test.ts`: these are Server Components rendering what
 * they are handed, and what is pinned is which pieces the create page is built from and in what
 * order — exactly the kind of thing that drifts back the next time one page is edited and the
 * other is not.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const EVENT_FORM = read("src/modules/content/events/ui/EventFieldsForm.tsx");
const TRANSLATION_FORM = read("src/modules/content/events/ui/TranslationFieldsForm.tsx");
const WALL_TIME = read("src/modules/content/events/ui/WallTimeField.tsx");
const ROWS = read("src/modules/content/events/ui/ScheduleRowsEditor.tsx");
const ACTIONS = read("src/app/[locale]/admin/actions.ts");
const SERVICE = read("src/modules/content/events/service.ts");
const TABS = read("src/shared/ui/LocaleTabPanels.tsx");
const MESSAGES = ["messages/ro.json", "messages/en.json"].map(
  (file) => [file, JSON.parse(read(file))] as const,
);

describe("the create page is built from the editor's own pieces", () => {
  it("renders the editor's language panel for every locale, in tabs, and nothing of its own", () => {
    expect(CREATE).toContain("<LocaleTabPanels");
    expect(CREATE).toContain("routing.locales.map(");
    expect(CREATE).toContain("<TranslationFieldsForm");
    expect(CREATE).toContain("blankTranslation(contentLocale)");
    // The two stacked "Conținut (RO)" / "Conținut (EN)" sections with a title, a slug and a
    // one-line excerpt are gone, and so is their heading from both catalogues.
    expect(CREATE).not.toContain("translations.");
    expect(CREATE).not.toContain("editor.translationSection");
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.translationSection, file).toBeUndefined();
    }
  });

  it("puts recurrence first, then the words, then the settings — the editor's own order", () => {
    const repeat = CREATE.indexOf('headingId="panel-repeat"');
    const content = CREATE.indexOf('headingId="panel-content"');
    const settings = CREATE.indexOf("<EventFieldsForm");
    expect(repeat).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(repeat);
    expect(settings).toBeGreaterThan(content);
    // "Când și unde" is the first of the settings panels, so the repeat panel precedes it.
    expect(EVENT_FORM.indexOf('headingId="panel-when"')).toBeLessThan(EVENT_FORM.indexOf('headingId="panel-registration"'));
    // The editor: the words, then the settings, the same way round.
    expect(EDIT.indexOf('headingId="panel-content"')).toBeLessThan(EDIT.indexOf("<EventFieldsForm"));
  });

  it("reads each language with the save's own reader", () => {
    const create = ACTIONS.slice(
      ACTIONS.indexOf("export async function createEventAction"),
      ACTIONS.indexOf("export async function duplicateEventAction"),
    );
    expect(create).toContain('translationInputFrom(form, "ro")');
    expect(create).toContain('translationInputFrom(form, "en")');
    expect(create).not.toContain('"translations.ro.excerpt"');
    const save = ACTIONS.slice(
      ACTIONS.indexOf("function translationFieldsFrom"),
      ACTIONS.indexOf("function selectedEventRefs"),
    );
    expect(save).toContain("translationInputFrom(form, locale)");
    // And the service writes both through one function.
    expect(SERVICE.match(/translationColumnsFrom\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("posts no row id or version for a blank language, and the reader tolerates their absence", () => {
    expect(TRANSLATION_FORM).toContain('{row && <input type="hidden" name={name("translationId")}');
    // The version is recalled after a refusal (`RecallHidden`, §315), and still only for a row.
    expect(TRANSLATION_FORM).toContain('{row && <RecallHidden name={name("expectedVersion")}');
    expect(ACTIONS).toContain('if (translationId === "") return undefined;');
  });
});

describe("no film box", () => {
  it("has no video link input on the settings panels, on either page", () => {
    expect(EVENT_FORM).not.toContain("event.videoUrl");
    expect(EVENT_FORM).not.toContain("panel-video");
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.videoUrl, file).toBeUndefined();
      expect(messages.Admin.editor.videoUrlHelp, file).toBeUndefined();
      expect(messages.Admin.editor.panels.video, file).toBeUndefined();
    }
  });

  it("keeps the column, the validation and the public embed for the links older events carry", () => {
    expect(read("src/modules/content/events/fields.ts")).toContain("videoUrl:");
    expect(read("src/db/schema/events.ts")).toContain('videoUrl: text("video_url")');
    expect(read("src/app/[locale]/events/[slug]/page.tsx")).toContain("<EventVideo videoUrl={event.videoUrl} />");
    // A save that says nothing about the film writes nothing over it.
    expect(SERVICE).toContain("fields.videoUrl === undefined ? {} : { videoUrl: fields.videoUrl }");
  });
});

describe("the time is picked, not typed", () => {
  it("makes every time box a native time input, which posts HH:MM whatever face it shows", () => {
    // The typed box is gone with its placeholder and its pattern; the comments may still say
    // "HH:MM", because that is what the input posts.
    expect(WALL_TIME).toContain('type="time"');
    expect(WALL_TIME).not.toContain('type="text"');
    expect(WALL_TIME).not.toContain('placeholder="HH:MM"');
    expect(WALL_TIME).not.toContain("pattern:");
    expect(ROWS.match(/type="time"/g)).toHaveLength(2);
    expect(ROWS).not.toContain('placeholder="HH:MM"');
    expect(ROWS).not.toContain("pattern:");
    // No picker library: the browser's clock does the job (AGENTS.md §1.5).
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["@mui/x-date-pickers"]).toBeUndefined();
  });
});

describe("the place's name in each language", () => {
  it("is asked on the language panel, after the title, with a sentence about the blank", () => {
    const title = TRANSLATION_FORM.indexOf('name={name("title")}');
    const place = TRANSLATION_FORM.indexOf('name={name("locationName")}');
    expect(place).toBeGreaterThan(title);
    expect(place).toBeLessThan(TRANSLATION_FORM.indexOf('name={name("excerptBody")}'));
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.locationNameInLanguage, file).toBeTruthy();
      expect(messages.Admin.editor.locationNameInLanguageHelp, file).toContain("{panel}");
    }
    // The meeting point itself is still one fact, asked once in "Când și unde" — in the island
    // whose `required` follows the "to be announced" switch (§NNN), rendered by the event form.
    expect(EVENT_FORM).toContain("<PlaceToBeAnnounced");
    expect(read("src/modules/content/events/ui/PlaceToBeAnnounced.tsx")).toContain('name="event.locationName"');
  });
});

describe("a required box behind a tab or a fold", () => {
  it("is brought into view when the browser refuses the submit", () => {
    expect(TABS).toContain("onInvalid={reveal(index)}");
    expect(TABS).toContain("event.currentTarget.hidden = false");
    // The address fold opens on its own while there is no address yet — the create form.
    expect(TRANSLATION_FORM).toContain('open={translation.slug.trim() === "" || undefined}');
  });
});
