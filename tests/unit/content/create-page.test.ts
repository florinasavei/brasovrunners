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
const BOXES = ["KindBox", "WhenBox", "PlaceBox", "ProgrammeBox", "RegistrationBox", "StatusBox", "DeclarationCard", "CourseBox", "LinksBox", "CoHostsBox", "PromotionBox", "TextBoxes"]
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

  it("puts Recurență first, then the boxes in the page's own order, then the ones not on the page, then Salvare", () => {
    // The page's order itself is `events/page-sections.test.ts`'s to hold (§406); this is the frame.
    const order = [
      'id="box-recurrence"',
      'id="box-map"',
      't("editor.groups.page")',
      "<KindBox",
      "<TitleSummaryBox",
      "<DescriptionBox",
      "<WhenBox",
      "<PlaceBox",
      "<CourseBox",
      "<CostBox",
      "<RegistrationBox",
      "<CoHostsBox",
      "<LinksBox",
      "<ProgrammeBox",
      "<RulesBox",
      "<VideoBox",
      "<StartListBox",
      't("editor.groups.offPage")',
      "<PromotionBox",
      "<AddressBox",
      'id="box-save"',
    ];
    for (const page of [CREATE, EDIT]) {
      const positions = order.map((needle) => at(page, needle));
      for (let index = 1; index < positions.length; index += 1) {
        expect(positions[index], `${order[index]} after ${order[index - 1]}`).toBeGreaterThan(positions[index - 1]);
      }
      // No box holds another any more: the first box is the type alone (§406, undoing §358's nesting).
      expect(page).not.toContain("</KindBox>");
    }
  });

  it("offers the status on create as the editor does — Programat by default, Anulat with its reason, Încheiat (§NNN)", () => {
    // The owner, 2026-09-26: "ar trebui să pot crea un eveniment deja anulat din start". No hidden
    // SCHEDULED any more: the card's own select posts.
    expect(CREATE).not.toContain('name="event.eventStatus"');
    // The card is there, inside the first box (§NNN), so the two pages look the same (§358).
    expect(CREATE).toContain("<KindBox {...box} heading={flow.headings.kind} />");
    expect(read("src/modules/content/events/ui/boxes/KindBox.tsx")).toContain("await StatusCard({ event: null })");
    const status = read("src/modules/content/events/ui/boxes/StatusBox.tsx");
    // Keyed on the create page alone: a saved event always comes with its notice, by type, so it
    // can never fall into the create page's card, which has nobody to tell.
    expect(status).toContain("{ event: null; notice?: never } | { event: EditableEvent; notice: StatusNotice }");
    expect(status).not.toContain("!notice");
    const createBranch = status.slice(at(status, "if (event === null) {"), at(status, "{risk && <RiskLine>"));
    expect(createBranch).toContain('data-testid="status-on-create"');
    expect(createBranch).toContain('{select("SCHEDULED")}');
    expect(createBranch).not.toContain("disabled");
    expect(createBranch).toContain("offerNotice={false}");
    expect(createBranch).toContain('t("editor.boxes.status.createNote")');
    for (const [file, messages] of MESSAGES) {
      expect(messages.Admin.editor.boxes.status.createNote, file).toBeTruthy();
      expect(messages.Admin.editor.boxes.status.completedRefused, file).toBeTruthy();
      for (const key of ["cancelTitleCreate", "cancelIntroCreate", "cancelReasonHelpCreate"]) expect(messages.Admin.editor.notice[key], file + " " + key).toBeTruthy();
    }
    // The action reads the reason on a create too; the service requires it for CANCELLED and tells nobody.
    const create = ACTIONS.slice(at(ACTIONS, "export async function createEventAction"), at(ACTIONS, "export async function duplicateEventAction"));
    expect(create).toContain('form.has("cancel.reasonRo") || form.has("cancel.reasonEn")');
    expect(create).toContain("notify: false");
    expect(SERVICE).toContain("function readCreateStatus(");
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
    expect(read("src/app/[locale]/events/[slug]/page.tsx")).toContain(
      "<EventVideo videoUrl={event.videoUrl} posterUrl={event.videoPosterUrl} eventTitle={event.title} />",
    );
    // A save that says nothing about the film writes nothing over it.
    expect(SERVICE).toContain("fields.videoUrl === undefined ? {} : { videoUrl: fields.videoUrl }");
  });
});

describe("the time is the platform's own native input, always on the 24-hour clock", () => {
  const TIME_FIELD = read("src/shared/forms/pickers/TimeField.tsx");

  it("makes every time box a native <input type=\"time\">, which reads HH:MM and never AM/PM (§345, amended)", () => {
    // §345's own MUI wheel picker was replaced 2026-09-25 — the owner: "I simply hate this time
    // picker" — by `type="time"`, which every browser already renders as a 24-hour or 12-hour
    // control that always *posts* `HH:mm`; §345's date half is untouched, still MUI's picker.
    expect(WALL_TIME).toContain("<DateField");
    expect(WALL_TIME).toContain("<TimeField");
    expect(WALL_TIME).not.toContain("TimePicker");
    expect(ROWS).toContain("<DateField");
    expect(ROWS.match(/<TimeField/g)).toHaveLength(2);
    expect(TIME_FIELD).toContain('type="time"');
    expect(TIME_FIELD).toContain("step: 60");
    expect(TIME_FIELD).not.toContain("@mui/x-date-pickers");
    const pkg = JSON.parse(read("package.json"));
    // The date half still needs the library; the time half no longer does.
    expect(pkg.dependencies["@mui/x-date-pickers"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies.dayjs).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("the place's name in each language (§362)", () => {
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
    // The panel shown and its siblings hidden on the DOM itself, inside the event (§371).
    expect(TABS).toContain("showOnly(panelRefs.current, index);");
    expect(TABS).toContain("if (panel) panel.hidden = other !== index;");
    // Any fold around it, and any strip's tab, from the form itself (§350).
    expect(FORM).toContain("onInvalidCapture={onInvalidCapture}");
    expect(FORM).toMatch(/openFoldsAround\(element\);\s*element\.dispatchEvent\(new CustomEvent\(REVEAL_EVENT/);
    // The address box opens on its own while an address is missing — so on the create page.
    expect(BOXES).toContain("openWhen={{ attention: blank.length > 0 }}");
  });
});
