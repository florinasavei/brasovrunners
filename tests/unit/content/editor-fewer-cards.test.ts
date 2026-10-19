import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §760 — the event editor in fewer cards (the owner, 2026-10-13: «cardurile 6 și 9 se pot uni sincer,
 * sunt chestii oarecum related»; and «„evidențierea pe site” ar putea fi în același card cu „ce fel de
 * eveniment” și următoarele, practic vreau mai puține carduri și mai mult nesting, nu trebuie să fie un
 * card separat»).
 *
 * Source assertions, like the rest of this folder: the cards are Server Components rendering what they
 * are handed, and what is pinned is where each named card is drawn — the same fields, names and ids,
 * only nested differently. The rendered cards are `editor-fewer-cards-render.test.ts`.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
const BOXES = "src/modules/content/events/ui/boxes";
const KIND = read(`${BOXES}/KindBox.tsx`);
const TEXTS = read(`${BOXES}/TextBoxes.tsx`);
const REGISTRATION = read(`${BOXES}/RegistrationBox.tsx`);
const LAYOUT = read("src/modules/content/events/ui/EventEditorLayout.tsx");

const at = (source: string, needle: string, from = 0) => {
  const index = source.indexOf(needle, from);
  expect(index, `${needle} is there`).toBeGreaterThan(-1);
  return index;
};

describe("§760 «Ce fel de eveniment» holds «Evidențiere pe site»", () => {
  it("draws the promotion card itself, last, after the status and the cost, for every role", () => {
    expect(KIND).toContain("const promotion = await PromotionBox({ event, mayEditSettings });");
    const body = KIND.slice(at(KIND, "<Panel glyph=\"kind\""));
    expect(at(body, "{status}")).toBeLessThan(at(body, "{cost}"));
    expect(at(body, "{cost}")).toBeLessThan(at(body, "{promotion}"));
    // The reader's branch too: the card's heading and its line.
    expect(body.split("{promotion}").length - 1).toBe(2);
  });

  it("keeps the card's id and names, a level-3 card that is its heading alone for a reader", () => {
    const promotion = read(`${BOXES}/PromotionBox.tsx`);
    expect(promotion).toMatch(/const card = \{\s+id: "box-promotion",\s+glyph: "promotion",\s+level: 3/);
    expect(promotion).toContain('name="event.featured"');
    expect(promotion).toContain('name="event.isSpecial"');
    expect(promotion).toContain("if (!mayEditSettings) return <Panel {...card} />;");
  });

  it("names the marks on the first card's closed line only while one is on", () => {
    expect(KIND).toContain("const promotionLine = event?.featured || event?.isSpecial ? promotionSummary(words, event) : null;");
    expect(KIND).toMatch(/difficultyLine, membersLine, promotionLine\]/);
  });
});

describe("§760 «Titlu și rezumat» holds the page's address and «Copertă»", () => {
  const title = TEXTS.slice(at(TEXTS, "export async function TitleSummaryBox"), at(TEXTS, "export async function DescriptionBox"));

  it("draws the address card, then the cover, after the title's own tabs", () => {
    expect(title).toContain("const address = await AddressBox({ languages, slugLocked, creating });");
    expect(title).toContain("const cover = await CoverBox({ event, mayEditSettings, picture });");
    expect(at(title, 'idPrefix="title"')).toBeLessThan(at(title, "{address}"));
    expect(at(title, "{address}")).toBeLessThan(at(title, "{cover}"));
  });

  it("answers for the address's publication gaps on its line and its chip, and opens while an address is blank", () => {
    expect(title).toContain('await requiredLine(["titleSummary", "address"], null, languages)');
    expect(title).toContain("attention: !creating && (incomplete.length > 0 || blankAddress.length > 0)");
    expect(read("src/modules/content/events/ui/page-flow.ts")).toContain('{ title: ["titleSummary", "address"], when: "place" }');
  });

  it("keeps both cards' ids, as level-3 cards", () => {
    const address = TEXTS.slice(at(TEXTS, "export async function AddressBox"));
    expect(address).toMatch(/<Panel glyph="address"\s+collapsible\s+level=\{3\}\s+id="box-address"/);
    expect(read(`${BOXES}/CoverBox.tsx`)).toMatch(/const card = \{\s+id: "box-cover",\s+glyph: "pictures",\s+level: 3/);
  });
});

describe("§760 «Participare, înscrieri și regulament»: cards 6 and 9 in one", () => {
  const body = REGISTRATION.slice(at(REGISTRATION, "  return (\n    <Panel glyph=\"registration\""));

  it("holds its named cards in the order a registration happens, the public list last", () => {
    const order = ["registrationFields", "{rules}", "{declarationCard}", "{programme}", "kitAndBibs", "{startList}"].map((needle) => at(body, needle));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The registration's life inside its fields, in time: the period, the confirmation, the reminder.
    const fields = REGISTRATION.slice(at(REGISTRATION, "const registrationFields = ("), at(REGISTRATION, "const kitAndBibs = ("));
    const life = ['id="box-registration-window"', 'id="box-confirmation"', 'id="box-reminder"'].map((needle) => at(fields, needle));
    expect([...life].sort((a, b) => a - b)).toEqual(life);
    // The kit, then the numbers, only for an event registering here.
    const day = REGISTRATION.slice(at(REGISTRATION, "const kitAndBibs = ("), at(REGISTRATION, "  return (\n    <Panel glyph=\"registration\""));
    expect(at(day, 'id="box-kit"')).toBeLessThan(at(day, 'id="box-bibs"'));
    expect(day).toContain('<OnlyForMode mode="INTERNAL" initialMode={initialMode}>');
  });

  it("has no card of its own for «Condiții de participare»: the rules card holds it (§799)", () => {
    expect(REGISTRATION).not.toContain("ConditionsBox");
    expect(existsSync(path.join(ROOT, BOXES, "ConditionsBox.tsx"))).toBe(false);
    const rules = TEXTS.slice(at(TEXTS, "export async function RulesBox"), at(TEXTS, "export async function AddressBox"));
    expect(rules).toContain("await ConditionsGroup({ event, mayEditSettings })");
    expect(rules).toContain("healthNoteSummary(words");
    // Nothing links to the old anchor any more: no source file under src/ names it as a target (the
    // comments that say it is gone write it with the hash, `#box-conditions`, and are the only mentions).
    const sources = (dir: string): string[] =>
      readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const child = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return sources(child);
        return /\.tsx?$/.test(entry.name) ? [child] : [];
      });
    for (const file of sources("src")) {
      const mentions = read(file).split("box-conditions").length - 1;
      const gone = read(file).split("`#box-conditions`").length - 1;
      expect(mentions, file).toBe(gone);
    }
  });

  it("drops the sentence that sent the reader from one card to the other", () => {
    expect(REGISTRATION).not.toContain("declaration-moved");
    expect(REGISTRATION).not.toContain("declarationUnderRules");
    for (const locale of ["ro", "en"] as const) {
      const catalogue = JSON.parse(read(`messages/${locale}.json`)).Admin.editor;
      expect(catalogue.boxes.conditions.declarationUnderRules, locale).toBeUndefined();
      expect(catalogue.boxes.programmeRules, locale).toBeUndefined();
      expect(catalogue.groups.offPage, locale).toBeUndefined();
    }
  });

  it("is the card at #box-registration, which opens itself while the declaration is missing, and wears the outline", () => {
    expect(body).toMatch(/id="box-registration"[\s\S]*openWhen=\{\{ attention: line\.missing \}\}[\s\S]*tone=\{risk \? "risk" : "default"\}/);
    // The page hands it the languages, for the programme's and the rules' texts.
    expect(EDIT).toMatch(/<RegistrationBox\s+\{\.\.\.box\}\s+heading=\{flow\.headings\.registration\}\s+risk=\{risk\}\s+languages=\{languages\}/);
    expect(CREATE).toContain("<RegistrationBox {...box} heading={flow.headings.registration} languages={languages}");
  });

  it("sends the Organizer only to what an Organizer sees: «Alocare și tipărire» is in the card itself, «Numere de concurs (BIB)» is the Administrator's", () => {
    // `canEditEventFields` is the Administrator's: for the Organizer `RegistrationBox` draws `bibPrint` straight in the card.
    expect(REGISTRATION).toMatch(/\{mayEditSettings\s*\?\s*kitAndBibs\s*:[\s\S]*?bibPrint\}/);
    for (const locale of ["ro", "en"] as const) {
      const sections = JSON.parse(read(`messages/${locale}.json`)).Admin.guide.sections;
      // The Organizer's own section (the role's code is MODERATOR).
      const organizer = sections.find((section: { roles?: string[] }) => section.roles?.length === 1 && section.roles[0] === "MODERATOR");
      expect(organizer, locale).toBeDefined();
      const steps = JSON.stringify(organizer.tasks);
      expect(steps, locale).not.toMatch(/Numere de concurs \(BIB\)|Race numbers \(bibs\)/);
      expect(steps, locale).toMatch(/«Alocare și tipărire»|«Allocate and print»/);
    }
  });

  it("calls the mode by the select's own words, and names «Regulamentul» rather than «el»", () => {
    const ro = JSON.parse(read("messages/ro.json")).Admin;
    const en = JSON.parse(read("messages/en.json")).Admin;
    expect(ro.editor.boxes.startList.onlyHere).toContain("alege «Înscrieri pe site» mai sus");
    expect(en.editor.boxes.startList.onlyHere).toContain("choose “Înscrieri pe site” higher up");
    expect(JSON.stringify(ro.guide)).not.toContain("Declarația, chiar sub el:");
    expect(JSON.stringify(en.guide)).not.toContain("The declaration, right under it:");
  });

  it("names its title in both catalogues", () => {
    expect(JSON.parse(read("messages/ro.json")).Admin.editor.boxes.registration.title).toBe("Participare, înscrieri și regulament");
    expect(JSON.parse(read("messages/en.json")).Admin.editor.boxes.registration.title).toBe("Taking part, registration and rules");
  });
});

describe("§760, amended by §763: «Puncte pe traseu» inside «Traseul», «Voluntari» with the registrations", () => {
  it("draws the checkpoints card inside «Traseul», in the save form, and its detached forms around and after it", () => {
    const saveStart = at(EDIT, 'id="event-save-form"');
    const saveEnd = at(EDIT, "</ActionForm>", saveStart);
    // The card is «Traseul»'s `checkpoints`, inside the one save form — in the document, not moved by CSS.
    const course = at(EDIT, "<CourseBox ", saveStart);
    const card = at(EDIT, "<CheckpointsCard", course);
    expect(card).toBeLessThan(saveEnd);
    expect(EDIT.split("<CheckpointsCard").length - 1).toBe(1);
    // Its forms' state wraps the save form, so their `<form>` elements stand after it, never in it.
    expect(at(EDIT, "<CheckpointForms ")).toBeLessThan(saveStart);
    expect(at(EDIT, "</CheckpointForms>")).toBeGreaterThan(saveEnd);
    const checkpoints = read("src/modules/content/events/ui/CheckpointsCard.tsx");
    const forms = checkpoints.slice(at(checkpoints, "export async function CheckpointForms"), at(checkpoints, "type Props = {"));
    expect(at(forms, "{children}")).toBeLessThan(at(forms, "<DetachedForm id={CHECKPOINTS_FORM}>"));
    // Every box of the card is inside the fields that name its form, and the card draws no `<form>` of its own.
    expect(checkpoints).not.toMatch(/^\s*<(form|ActionForm)\b/m);
    expect(checkpoints).toContain("<DetachedFields form={CHECKPOINTS_FORM}>");
    expect(checkpoints).toContain("<DetachedFields form={CHECKPOINTS_GPX_FORM}>");
    // «Traseul» draws it last, after the route's fields, whatever the reader's role.
    const courseBox = read(`${BOXES}/CourseBox.tsx`);
    expect(courseBox.split("{checkpoints}").length - 1).toBe(2);
    expect(at(courseBox, "{routeDescription}\n        {checkpoints}")).toBeGreaterThan(at(courseBox, 'name="event.routeStrava"'));
  });

  it("moves nothing on the screen with CSS order: what the tab and a screen reader meet is what the screen shows (WCAG 2.4.3, 1.3.2)", () => {
    const main = EDIT.slice(at(EDIT, "main={"), at(EDIT, "below={"));
    expect(main).not.toMatch(/\border\s*:/);
    expect(main).not.toContain("display: \"contents\"");
    expect(LAYOUT).not.toContain("UnderCourse");
    expect(LAYOUT).not.toContain("EDITOR_MAIN_ORDER");
    expect(LAYOUT).not.toContain("FORM_WITHOUT_BOX");
    // The cards stay in the page's order inside the one save form: «Traseul» before card 6.
    const form = EDIT.slice(at(EDIT, 'id="event-save-form"'));
    expect(at(form, "<CourseBox ")).toBeGreaterThan(at(form, "<WhenBox "));
    expect(at(form, "<RegistrationBox")).toBeGreaterThan(at(form, "<CourseBox "));
    // A named card of «Traseul»: level 3, its own cards a level below.
    const checkpoints = read("src/modules/content/events/ui/CheckpointsCard.tsx");
    expect(checkpoints).toMatch(/<Panel\s+glyph="checkpoints"\s+collapsible\s+level=\{3\}\s+id="box-checkpoints"/);
    expect(checkpoints).not.toMatch(/level=\{3\}\s+(?:id="box-checkpoints-gpx"|title=\{t\("checkpoints\.(rowTitle|add\.title)")/);
  });

  it("no longer sends the reader elsewhere for the points, and counts them on «Traseul»'s closed line", () => {
    for (const locale of ["ro", "en"] as const) {
      const words = JSON.parse(read(`messages/${locale}.json`)).Admin.checkpoints;
      expect(words.courseNote, locale).toBeUndefined();
      expect(words.courseLink, locale).toBeUndefined();
      expect(Object.keys(words.inCourse).sort(), locale).toEqual(["few", "one", "other"]);
    }
    expect(EDIT).toContain("checkpointCount={checkpoints.length}");
    const course = read(`${BOXES}/CourseBox.tsx`);
    expect(course).toContain("checkpoints: checkpointCount > 0 ? t(`checkpoints.inCourse.${countForm(checkpointCount, locale)}`, { count: checkpointCount }) : null,");
  });

  it("draws «Voluntari» under «Înscrierile primite», below the grid, outside the save form", () => {
    const below = at(EDIT, "below={");
    const volunteers = at(EDIT, "<VolunteersCard");
    expect(volunteers).toBeGreaterThan(below);
    expect(volunteers).toBeGreaterThan(at(EDIT, 'id="box-received"'));
    expect(volunteers).toBeLessThan(at(EDIT, 'id="box-copy-delete"'));
    expect(EDIT.split("<VolunteersCard").length - 1).toBe(1);
    // The heading «Acțiuni imediate» stands over it too when the registrations' card is not drawn.
    expect(EDIT).toContain('{((canReadRegistrations(staffUser.role) && internal) || volunteersCard) && <EditorGroup label={t("editor.immediateActions")} />}');
  });
});
