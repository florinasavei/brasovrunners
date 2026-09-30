import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The 2026-09-24 third batch, integrated (§347): cost and donation, partners with many links,
 * "Linkuri și fișiere" (§332), the place to be announced (§328, §339) and the date pickers all
 * added boxes to the event form and lines to `admin/actions.ts#eventFieldsFrom`, on branches
 * that could not see each other — and the waiting list's length (the waiting-list cap) after them.
 * Since the editor's boxes (§350) the form is the boxes under `content/events/ui/boxes/`, which
 * the create page and the editor both render: one page, create and edit alike. The save itself is proven end to end in
 * `tests/integration/cms/event-fields-together.test.ts`; these are the seams a merge can open
 * without any single branch's test noticing — a box read twice, a box read and never rendered,
 * a feature on the editor and missing from the create page.
 *
 * Source assertions, like `create-page.test.ts`, for the same reason: what is pinned is which
 * pieces the two pages are built from.
 */
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const ACTIONS = read("src/app/[locale]/admin/actions.ts");
const READER = ACTIONS.slice(ACTIONS.indexOf("function eventFieldsFrom"), ACTIONS.indexOf("function translationInputFrom"));
const RETURNED = READER.slice(READER.indexOf("  return {"));
const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const UI_DIR = "src/modules/content/events/ui";
const BOX_DIR = `${UI_DIR}/boxes`;
const readAll = (dir: string) =>
  readdirSync(path.join(process.cwd(), dir))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => read(`${dir}/${file}`))
    .join("\n");
/** The event form: the boxes both pages render (§350), in place of the one `EventFieldsForm` before them. */
const EVENT_FORM = readAll(BOX_DIR);
const UI = `${readAll(UI_DIR)}\n${EVENT_FORM}`;
/** The field boxes, by component — the same list on both pages, the editor adding what needs a saved event. */
const FIELD_BOXES = [
  "KindBox",
  "TitleSummaryBox",
  "DescriptionBox",
  // The date and the place in one card, the programme, rules and declaration in another (§481).
  "WhenBox",
  "ProgrammeRulesBox",
  "RegistrationBox",
  "CourseBox",
  "LinksBox",
  "CoHostsBox",
  "PromotionBox",
  "AddressBox",
];

describe("§347 one event form for five features, on both pages", () => {
  it("both the create page and the editor render the one shared form: the same layout and the same boxes, once each", () => {
    for (const page of [CREATE, EDIT]) {
      expect(page).toContain("<EventEditorLayout");
      for (const box of FIELD_BOXES) {
        expect(page.match(new RegExp(`<${box}\\b`, "g"))?.length ?? 0, box).toBe(1);
      }
    }
  });

  it("the shared form carries every feature's editor, so neither page can miss one", () => {
    for (const piece of ["<CostFields", "<CoHostRowsEditor", "<LinkRowsEditor", "<PlaceToBeAnnounced", "<WallTimeField"]) {
      expect(EVENT_FORM, piece).toContain(piece);
    }
    // Each in the box that answers its question: the cost's boxes with the cost, the partners'
    // cards in "Parteneri", the waiting list's length beside the places.
    expect(read(`${BOX_DIR}/CostBox.tsx`)).toContain("<CostFields");
    // The cost's card is drawn by the first box since §466.
    expect(read(`${BOX_DIR}/KindBox.tsx`)).toContain("await CostBox(");
    expect(read(`${BOX_DIR}/RegistrationBox.tsx`)).not.toContain("<CostFields");
    expect(read(`${BOX_DIR}/CoHostsBox.tsx`)).toContain("<CoHostRowsEditor");
    const registration = read(`${BOX_DIR}/RegistrationBox.tsx`);
    const capacityRow = registration.slice(registration.indexOf('data-testid="capacity-row"'), registration.indexOf("</Stack>", registration.indexOf('data-testid="capacity-row"')));
    expect(capacityRow).toContain('name="event.capacity"');
    expect(capacityRow).toContain('name="event.waitlistCapacity"');
    // Every wall-clock instant goes through the pickers' field.
    for (const instant of ["startsAt", "registrationOpensAt", "registrationClosesAt"]) {
      expect(EVENT_FORM).toContain(`name="event.${instant}"`);
    }
    // The race's start through the same pickers, beside its tick «Startul cursei nu e stabilit» (§590).
    expect(EVENT_FORM).toContain("<RaceStartNotSet");
    const raceStart = read(`${UI_DIR}/RaceStartNotSet.tsx`);
    expect(raceStart).toContain('name="event.raceStartsAtDate"');
    expect(raceStart).toContain('name="event.raceStartsAtTime"');
  });

  it("every feature's boxes come back filled after a refusal (§315): each reads the kept form", () => {
    for (const file of [
      `${UI_DIR}/CostFields.tsx`,
      `${UI_DIR}/CoHostRowsEditor.tsx`,
      `${UI_DIR}/LinkRowsEditor.tsx`,
      `${UI_DIR}/PlaceToBeAnnounced.tsx`,
      `${UI_DIR}/RaceStartNotSet.tsx`,
      "src/shared/forms/pickers/DateField.tsx",
      "src/shared/forms/pickers/TimeField.tsx",
    ]) {
      expect(read(file), file).toMatch(/RecallField|useRecall|recall/);
    }
    // And both actions hand the refusal back with the form, through the same name map.
    expect(
      ACTIONS.match(/refused\(error, form, \{ fieldNames: eventFormFieldNames \}\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  /**
   * The partners' cards and "Linkuri și fișiere" landed on one form, each numbering its rows
   * "Linkul 1", "Linkul 2" and its buttons "Șterge linkul 1": two groups and two buttons with one
   * accessible name each, which a screen reader cannot tell apart and the §332 spec tripped over.
   * A partner's link now says whose it is.
   */
  it("names a partner's link rows and buttons with the partner, so no two rows share a name", () => {
    const editor = read(`${UI_DIR}/CoHostRowsEditor.tsx`);
    expect(editor).toContain('labels.ofPartner.replace("{p}", String(n))');
    for (const name of ["labels.link", "labels.moveLinkUp", "labels.moveLinkDown", "labels.removeLink"]) {
      expect(editor).toContain(`\${${name}} \${ln}`);
    }
    expect(EVENT_FORM).toContain('ofPartner: t("editor.coHostRows.ofPartner", { p: "{p}" })');
    for (const file of ["messages/ro.json", "messages/en.json"]) {
      expect(JSON.parse(read(file)).Admin.editor.coHostRows.ofPartner, file).toContain("{p}");
    }
  });

  it("reads each of the batch's fields exactly once", () => {
    for (const key of [
      "costType",
      "costAmount",
      "costUrl",
      "waitlistCapacity",
      "coHosts",
      "links",
      "locationName",
      "locationToBeAnnounced",
      "startsAtWallTime",
      "raceStartsAtWallTime",
      "registrationOpensAtWallTime",
      "registrationClosesAtWallTime",
    ]) {
      const properties = RETURNED.match(new RegExp(`^\\s+${key}:`, "gm")) ?? [];
      expect(properties, key).toHaveLength(1);
    }
  });

  it("reads no box the form does not render", () => {
    const plain = [...RETURNED.matchAll(/value\("(\w+)"\)/g)].map((match) => match[1]);
    expect(plain.length).toBeGreaterThan(20);
    for (const field of plain) {
      expect(UI, `event.${field} is read by eventFieldsFrom but no form component posts it`).toMatch(
        new RegExp(`["\`]event\\.${field}["\`]`),
      );
    }
    // And each is rendered once: a box drawn twice posts its name twice, and the save reads one.
    for (const field of plain) {
      const drawn = UI.match(new RegExp(`name="event\\.${field}"`, "g"))?.length ?? 0;
      expect(drawn, `event.${field} is rendered ${drawn} times`).toBeLessThanOrEqual(1);
    }
    const checks = [...RETURNED.matchAll(/form\.get\("event\.(\w+)"\)/g)].map((match) => match[1]);
    for (const field of checks) {
      expect(UI, `event.${field}`).toMatch(new RegExp(`["\`]event\\.${field}["\`]|"event\\.${field}\\.present"`));
    }
    // The pickers post a date box and a time box per instant, joined by `wallTime` above.
    expect(read(`${UI_DIR}/WallTimeField.tsx`)).toContain("name={`${name}Date`}");
    expect(READER).toContain("value(`${field}Date`)");
    expect(READER).toContain("value(`${field}Time`)");
  });
});

describe("§505 the minimum age is one box in «Regulamentul» for every type", () => {
  it("the reader takes `minAge` once, from `event.minAge`, whatever the type", () => {
    expect(RETURNED.match(/\bminAge:/g)?.length ?? 0).toBe(1);
    const line = RETURNED.slice(RETURNED.indexOf("minAge:"), RETURNED.indexOf("\n", RETURNED.indexOf("minAge:")));
    expect(line).toMatch(/minAge: value\("minAge"\),/);
    expect(ACTIONS).not.toContain("groupRunMinAge");
    expect(ACTIONS).not.toContain("groupRunAgeBoxAnswers");
  });

  it("a refusal of the age names «Regulamentul»'s box, and no form posts a second age box", () => {
    expect(read(`${UI_DIR}/field-labels.ts`)).toContain('"event.minAge": inProgrammeRules("rules", t("editor.minAge"))');
    expect(UI).not.toContain("groupRunMinAge");
    // Posted once, by the rules card, outside any type- or mode-only block.
    expect(EVENT_FORM.match(/name="event\.minAge"/g)?.length ?? 0).toBe(1);
    const text = read(`${BOX_DIR}/TextBoxes.tsx`);
    const rules = text.slice(text.indexOf("export async function RulesBox"));
    const body = rules.slice(0, rules.search(/\r?\n\}\r?\n/));
    expect(body).toContain('name="event.minAge"');
    const beforeBox = body.slice(0, body.indexOf('name="event.minAge"'));
    expect(beforeBox).not.toContain("<OnlyForType");
    expect(beforeBox).not.toContain("<OnlyForMode");
    // The registration card and «Traseul» carry no age box of their own any more.
    for (const file of ["RegistrationBox.tsx", "CourseBox.tsx"]) {
      expect(read(`${BOX_DIR}/${file}`), file).not.toMatch(/name="event\.(minAge|groupRunMinAge)"/);
    }
  });
});
