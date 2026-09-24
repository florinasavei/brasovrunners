import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The create page is the editor — the owner, on `/admin/events/new` with a screenshot: "this
 * event create page is a bit inconsistent with the event edit". And earlier: "«Repetă
 * evenimentul» ar trebui să apară sus de tot, la început." And of the time boxes: "timepickerul ar
 * trebui să fie tot element MUI". And of the place: "ar trebui să pot pune și denumirea locației
 * în română și în engleză." Since the editor's boxes (§350) the two are literally one page
 * (`EventEditorLayout`), minus what needs a saved event.
 *
 * Source assertions, like `editor-order.test.ts`: these are Server Components rendering what
 * they are handed, and what is pinned is which pieces the create page is built from and in what
 * order — exactly the kind of thing that drifts back the next time one page is edited and the
 * other is not.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const BOXES = ["KindBox", "WhenBox", "PlaceBox", "ProgrammeBox", "RegistrationBox", "StatusBox", "CourseBox", "LinksBox", "CoHostsBox", "PromotionBox", "TextBoxes"]
  .map((box) => read(`src/modules/content/events/ui/boxes/${box}.tsx`))
  .join("\n");
const TRANSLATION_FIELDS = read("src/modules/content/events/ui/TranslationFields.tsx");
const WALL_TIME = read("src/modules/content/events/ui/WallTimeField.tsx");
const ROWS = read("src/modules/content/events/ui/ScheduleRowsEditor.tsx");
const ACTIONS = read("src/app/[locale]/admin/actions.ts");
const SERVICE = read("src/modules/content/events/service.ts");
const TABS = read("src/shared/ui/LocaleTabPanels.tsx");
const FORM = read("src/shared/forms/ActionForm.tsx");
const MESSAGES = ["messages/ro.json", "messages/en.json"].map((file) => [file, JSON.parse(read(file))] as const);

const at = (source: string, needle: string) => {
  const index = source.indexOf(needle);
  expect(index, `${needle} is on the page`).toBeGreaterThan(-1);
  return index;
};

describe("the create page is the editor's page", () => {
  it("renders the editor's layout and boxes, with blank languages, and nothing of its own", () => {
    for (const page of [CREATE, EDIT]) expect(page).toContain("<EventEditorLayout");
    expect(CREATE).toContain("blankTranslation(contentLocale)");
    // No language inputs of its own: every `translations.*` box is a piece of the editor's.
    expect(CREATE).not.toContain('name="translations.');
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.translationSection, file).toBeUndefined();
      expect(messages.Admin.editor.newHelp, file).toBeUndefined();
    }
  });

  it("puts Recurență first, then the boxes in the editor's own order, then Salvare", () => {
    const order = [
      'id="box-recurrence"',
      "<KindBox",
      "<TitleSummaryBox",
      "<DescriptionBox",
      "<WhenBox",
      "<PlaceBox",
      "<ProgrammeBox",
      "<RulesBox",
      "<RegistrationBox",
      "<CourseBox",
      "<LinksBox",
      "<CoHostsBox",
      "<PromotionBox",
      "<AddressBox",
      'id="box-save"',
    ];
    const positions = order.map((needle) => at(CREATE, needle));
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index], `${order[index]} after ${order[index - 1]}`).toBeGreaterThan(positions[index - 1]);
    }
    // The editor has the same order, with the status box between registration and course.
    expect(at(EDIT, "<RegistrationBox")).toBeLessThan(at(EDIT, "<StatusBox"));
    expect(at(EDIT, "<StatusBox")).toBeLessThan(at(EDIT, "<CourseBox"));
  });

  it("offers no status on create: a hidden SCHEDULED, and never Anulat for an event that does not exist", () => {
    expect(CREATE).toContain('<input type="hidden" name="event.eventStatus" value="SCHEDULED" />');
    expect(CREATE).not.toContain("<StatusBox");
    // And none of what needs a saved event.
    for (const edited of ["<BibPrintCard", "<RecurrenceSeriesPanel", 'id="box-received"', 'id="box-copy-delete"']) {
      expect(CREATE, edited).not.toContain(edited);
    }
  });

  it("posts the recurrence's publish choice as repeat.publish, and the action reads it", () => {
    expect(CREATE).toContain('<RepeatFields prefix="repeat." draftSource />');
    expect(read("src/modules/content/events/ui/RepeatFields.tsx")).toContain('name={name("publish")}');
    const create = ACTIONS.slice(ACTIONS.indexOf("export async function createEventAction"), ACTIONS.indexOf("export async function duplicateEventAction"));
    expect(create).toContain('publish: form.get("repeat.publish") === "on"');
    // The rule stores what was asked; the dates go live only while the event is live too.
    expect(SERVICE).toContain("publish: input.repeat.publish ?? published");
  });

  it("fills the page address from the title until it is typed", () => {
    expect(BOXES).toContain("{creating && <SlugFromTitle");
    expect(read("src/modules/content/events/ui/SlugFromTitle.tsx")).toContain("if (event.isTrusted) owned = true;");
  });

  it("reads each language with the save's own reader", () => {
    const create = ACTIONS.slice(ACTIONS.indexOf("export async function createEventAction"), ACTIONS.indexOf("export async function duplicateEventAction"));
    expect(create).toContain('translationInputFrom(form, "ro")');
    expect(create).toContain('translationInputFrom(form, "en")');
    expect(create).not.toContain('"translations.ro.excerpt"');
    const save = ACTIONS.slice(ACTIONS.indexOf("function translationFieldsFrom"), ACTIONS.indexOf("function selectedEventRefs"));
    expect(save).toContain("translationInputFrom(form, locale)");
    // And the service writes both through one function.
    expect(SERVICE.match(/translationColumnsFrom\(/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("posts no row id or version for a blank language, and the reader tolerates their absence", () => {
    expect(TRANSLATION_FIELDS).toContain('{row && <input type="hidden" name={name("translationId")}');
    // The version is recalled after a refusal (`RecallHidden`, §315), and still only for a row.
    expect(TRANSLATION_FIELDS).toContain('{row && <RecallHidden name={name("expectedVersion")}');
    expect(ACTIONS).toContain('if (translationId === "") return undefined;');
  });
});

describe("no film box", () => {
  it("has no video link input on the boxes, on either page", () => {
    expect(BOXES).not.toContain("event.videoUrl");
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.videoUrl, file).toBeUndefined();
      expect(messages.Admin.editor.videoUrlHelp, file).toBeUndefined();
      expect(messages.Admin.editor.panels?.video, file).toBeUndefined();
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

describe("the time is picked, always on the 24-hour clock", () => {
  const TIME_FIELD = read("src/shared/forms/pickers/TimeField.tsx");
  const WALL_VALUES = read("src/shared/forms/pickers/wall-values.ts");

  it("makes every time box MUI's picker, never a native input the browser's own locale could show as AM/PM", () => {
    // §303's native `<input type="time">` still showed the OS's own clock face — "07:00 PM" on
    // an English-language Chrome — which is the defect the picker replaced it for
    // (`DECISIONS.md` §345, the owner: "vreau ca timpul să fie mereu în format de 24H"). The
    // file's own doc comment still names the old markup as history, so the check is for what is
    // actually rendered rather than for the substring's total absence from the file.
    const rendered = WALL_TIME.slice(WALL_TIME.indexOf("export default function WallTimeField"));
    expect(rendered).not.toContain('type="time"');
    expect(rendered).not.toContain('type="date"');
    expect(WALL_TIME).toContain("<DateField");
    expect(WALL_TIME).toContain("<TimeField");
    expect(ROWS).not.toContain('type="time"');
    expect(ROWS).toContain("<DateField");
    expect(ROWS.match(/<TimeField/g)).toHaveLength(2);
    // Pinned to 24 hours in the picker itself, not left to the browser or the OS.
    expect(TIME_FIELD).toContain("ampm={false}");
    expect(WALL_VALUES).toContain('TIME_DISPLAY_FORMAT = "HH:mm"');
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["@mui/x-date-pickers"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies.dayjs).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the place's name in each language (§NNN)", () => {
  it("is asked once per language in the Locul box, beside each other — hidden with the map link while to be announced", () => {
    const place = read("src/modules/content/events/ui/boxes/PlaceBox.tsx");
    const island = read("src/modules/content/events/ui/PlaceToBeAnnounced.tsx");
    // No tabs and no second, shared box: the island holds the two names and the map link.
    expect(place).not.toContain("<LanguageTabs");
    expect(place).not.toContain("PlaceNameField");
    expect(TRANSLATION_FIELDS).not.toContain('name={name("locationName")}');
    expect(island).toContain('const RO_NAME = "event.locationName"');
    expect(island).toContain('const EN_NAME = "event.locationNameEn"');
    // Side by side from `sm`, stacked on a phone.
    expect(island).toContain('direction={{ xs: "column", sm: "row" }}');
    // Both inside the block the switch hides, with the map link after them.
    expect(island.indexOf("<ShownWhen")).toBeLessThan(island.indexOf("nameBox(RO_NAME"));
    expect(island.indexOf("nameBox(EN_NAME")).toBeLessThan(island.indexOf("{children}"));
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.locationCopyToEnglish, file).toBeTruthy();
      expect(messages.Admin.editor.locationNameInLanguage, file).toBeUndefined();
    }
    // The action reads the English box by the name the island posts, and only when it was posted.
    expect(ACTIONS).toContain('locationNameEn: form.has("event.locationNameEn") ? value("locationNameEn") : undefined');
  });
});

describe("a required box behind a tab or a fold", () => {
  it("is brought into view when the browser refuses the submit", () => {
    expect(TABS).toContain("onInvalid={reveal(index)}");
    expect(TABS).toContain("if (element) element.hidden = false;");
    // Any fold around it, and any strip's tab, from the form itself (§350).
    expect(FORM).toContain("onInvalidCapture={onInvalidCapture}");
    expect(FORM).toMatch(/openFoldsAround\(element\);\s*element\.dispatchEvent\(new CustomEvent\(REVEAL_EVENT/);
    // The address box opens on its own while an address is missing — so on the create page.
    expect(BOXES).toContain("openWhen={{ attention: blank.length > 0 }}");
  });
});
