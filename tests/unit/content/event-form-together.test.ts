import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The 2026-09-24 third batch, integrated (§NNN): cost and donation, partners with many links,
 * "Linkuri și fișiere" (§332), the place to be announced (§328, §339) and the date pickers all
 * added boxes to `EventFieldsForm` and lines to `admin/actions.ts#eventFieldsFrom`, on branches
 * that could not see each other. The save itself is proven end to end in
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
const EVENT_FORM = read("src/modules/content/events/ui/EventFieldsForm.tsx");
const UI_DIR = "src/modules/content/events/ui";
const UI = readdirSync(path.join(process.cwd(), UI_DIR))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => read(`${UI_DIR}/${file}`))
  .join("\n");

describe("§NNN one event form for five features, on both pages", () => {
  it("both the create page and the editor render the one shared form", () => {
    expect(CREATE).toContain("<EventFieldsForm");
    expect(EDIT).toContain("<EventFieldsForm");
  });

  it("the shared form carries every feature's editor, so neither page can miss one", () => {
    for (const piece of ["<CostFields", "<CoHostRowsEditor", "<LinkRowsEditor", "<PlaceToBeAnnounced", "<WallTimeField"]) {
      expect(EVENT_FORM, piece).toContain(piece);
    }
    // Every wall-clock instant goes through the pickers' field.
    for (const instant of ["startsAt", "raceStartsAt", "registrationOpensAt", "registrationClosesAt"]) {
      expect(EVENT_FORM).toContain(`name="event.${instant}"`);
    }
  });

  it("every feature's boxes come back filled after a refusal (§315): each reads the kept form", () => {
    for (const file of [
      `${UI_DIR}/CostFields.tsx`,
      `${UI_DIR}/CoHostRowsEditor.tsx`,
      `${UI_DIR}/LinkRowsEditor.tsx`,
      `${UI_DIR}/PlaceToBeAnnounced.tsx`,
      "src/shared/forms/pickers/DateField.tsx",
      "src/shared/forms/pickers/TimeField.tsx",
    ]) {
      expect(read(file), file).toMatch(/RecallField|useRecall|recall/);
    }
    // And both actions hand the refusal back with the form, through the same name map.
    expect(ACTIONS.match(/refused\(error, form, \{ fieldNames: eventFormFieldNames \}\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
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
