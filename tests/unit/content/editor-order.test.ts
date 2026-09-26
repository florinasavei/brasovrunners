import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §350 (the editor's boxes, building on §170 and §260), as amended by §406 — the
 * event editor as one page of boxes, **in the order of the public page** (the owner, 2026-09-25:
 * "am nevoie de mai multe căsuțe la editor ca să văd exact ce flow am în pagină").
 *
 * Each box answers one question and says its answer while shut. The order is pinned because it is
 * what drifts — the next field added lands in whichever box is nearest unless something says where
 * boxes go:
 *
 *   Pagina evenimentului, de sus în jos — the type, title and summary, description, date and time,
 *   place, the course, the cost, registration, partners, (the share links, automatic), links and files,
 *   programme, rules, the film, the public list: the page's sections in `PAGE_SECTIONS`' order,
 *   which `events/page-sections.test.ts` holds both the page and these pages to;
 *   Nu apar pe pagină — the status, promotion, page address;
 *   then Salvare, always open.
 *
 * §358 nested the status, the course and the links inside the first box; §406 took them out again,
 * each to where the page draws it.
 *
 * Source assertions, like the rest of this folder: these are Server Components rendering what
 * they are handed, and the thing pinned is the order and the shape.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const EDIT = read("src/app/[locale]/admin/events/[id]/page.tsx");
const FIELDS = read("src/modules/content/events/ui/TranslationFields.tsx");

const at = (source: string, needle: string) => {
  const index = source.indexOf(needle);
  expect(index, `${needle} is on the page`).toBeGreaterThan(-1);
  return index;
};

const EDITOR_ORDER = [
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
  "<AutomaticSection",
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

describe("§350 the editor's boxes, in order (§406: the page's)", () => {
  it("renders the page's cards in the page's order, then the ones not on the page, then Salvare", () => {
    const positions = EDITOR_ORDER.map((needle) => at(EDIT, needle));
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index], `${EDITOR_ORDER[index]} after ${EDITOR_ORDER[index - 1]}`).toBeGreaterThan(positions[index - 1]);
    }
  });

  it("gives the course and the links a box each, out of the first box, and the status a card inside it, on both pages (§406, §448)", () => {
    const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
    for (const [page, source] of [
      ["edit", EDIT],
      ["create", CREATE],
    ] as const) {
      // The first box closes on itself: the status card is drawn by the box, not nested by the page.
      expect(source, page).toMatch(/<KindBox \{\.\.\.box\}[^>]*\/>/);
      expect(source, page).not.toContain("</KindBox>");
      expect(source, page).not.toContain("<StatusBox");
      for (const card of ["<CourseBox", "<CostBox", "<LinksBox", "<StartListBox", "<VideoBox"]) {
        expect(source.split(card).length - 1, `${page}: ${card} once`).toBe(1);
      }
    }
    // The status: a level-3 card inside the first box, with the id it always had (§448).
    const status = read("src/modules/content/events/ui/boxes/StatusBox.tsx");
    expect(status).toMatch(/const card = \{\s+id: "box-status",\s+level: 3/);
    expect(read("src/modules/content/events/ui/boxes/KindBox.tsx")).toContain("await StatusCard({ event, risk, notice })");
    // Boxes of their own, with the ids they always had, so a deep link or a refusal still lands on
    // them — a fold for whoever may change it, the same heading and id without the fold for a reader.
    for (const [file, id] of [
      ["CourseBox", "box-course"],
      ["LinksBox", "box-links"],
    ] as const) {
      const source = read(`src/modules/content/events/ui/boxes/${file}.tsx`);
      expect(source, file).toMatch(new RegExp(`const card = \\{\\s+id: "${id}"`));
      expect(source, file).not.toContain("level: 3");
      expect(source, file).toContain("<Panel collapsible {...card}>");
      // The course card keeps its fold for a reader who may write a language's route description
      // (§387), and is its heading alone for one who may write neither the settings nor the texts.
      expect(source, file).toContain(
        file === "CourseBox" ? "if (!languages.some((entry) => entry.mayEdit)) return <Panel {...card} />;" : "if (!mayEditSettings) return <Panel {...card} />;",
      );
    }
  });

  it("puts the side column — Publicare, then Recurență — first in the document, as on a phone", () => {
    expect(at(EDIT, 'id="box-publication"')).toBeLessThan(at(EDIT, "<RecurrenceSeriesPanel"));
    expect(at(EDIT, "<RecurrenceSeriesPanel")).toBeLessThan(at(EDIT, "<KindBox"));
    const layout = read("src/modules/content/events/ui/EventEditorLayout.tsx");
    expect(layout.indexOf("{side}")).toBeLessThan(layout.indexOf("{main}"));
    expect(layout).toContain("order: { xs: 1, md: 2 }");
  });

  it("keeps the save form and the side column's forms siblings, never nested", () => {
    // The publication moves and the recurrence actions are forms of their own; the save form
    // opens after the side column has closed.
    expect(at(EDIT, 'action={transitionEventAction}')).toBeLessThan(at(EDIT, 'id="event-save-form"'));
    expect(at(EDIT, "action={repeatEventAction}")).toBeLessThan(at(EDIT, 'id="event-save-form"'));
    // The bib card's immediate actions post small forms drawn after the save form closes.
    const saveEnd = EDIT.indexOf("</ActionForm>", at(EDIT, 'id="event-save-form"'));
    expect(saveEnd).toBeGreaterThan(-1);
    expect(saveEnd).toBeLessThan(at(EDIT, "<BibPrintForms"));
  });

  it("puts the registrations received and duplicate or delete below the grid, outside the save", () => {
    expect(at(EDIT, "below={")).toBeGreaterThan(at(EDIT, 'id="box-save"'));
    expect(at(EDIT, 'id="box-received"')).toBeGreaterThan(at(EDIT, "below={"));
    expect(at(EDIT, 'id="box-copy-delete"')).toBeGreaterThan(at(EDIT, 'id="box-received"'));
  });

  it("sends a role that may not read the club's content back to the list", () => {
    expect(EDIT).toMatch(/if \(!canReadContent\(staffUser\.role\)\) redirect\(/);
  });

  it("offers repeat, stop and duplicate only to the role the service allows", () => {
    expect(EDIT).toContain("const mayChangeSeries = canCreateEvent(staffUser.role);");
    expect(EDIT).toMatch(/\{mayChangeSeries \? \(\s*\/\* A refused rule/);
    // An `ActionForm` that asks first since §384 — the duplicate makes a whole event.
    expect(EDIT).toMatch(/\{mayChangeSeries && \(\s*<ActionForm\s*action=\{duplicateEventAction\}/);
    expect(EDIT).toContain("mayChange={mayChangeSeries}");
  });

  it("marks the five boxes a change reaches — date, place, programme, registration, status — and no other", () => {
    for (const box of ["<WhenBox", "<PlaceBox", "<ProgrammeBox", "<RegistrationBox", "<KindBox"]) {
      const start = at(EDIT, box);
      expect(EDIT.slice(start, EDIT.indexOf("/>", start) + 2), box).toContain("risk={risk}");
    }
    // The first box holds the status again (§448) and wears the mark for it; the course, the
    // links, the partners, the promotion, the film and the list reach nobody.
    for (const box of ["<CourseBox", "<CostBox", "<LinksBox", "<CoHostsBox", "<PromotionBox", "<VideoBox", "<StartListBox"]) {
      const start = at(EDIT, box);
      expect(EDIT.slice(start, EDIT.indexOf(">", start) + 1), box).not.toContain("risk=");
    }
    // Real registrations only: a test row is counted nowhere the club looks (§12.6).
    expect(EDIT).toContain("const realCount = registered.total - registered.test;");
  });
});

describe("§260 the language pieces, each in its box", () => {
  it("asks for the title, then the summary — the visitor's order — in the Titlu și rezumat box", () => {
    const piece = FIELDS.slice(at(FIELDS, "export async function TitleSummaryFields"), at(FIELDS, "export async function DescriptionFields"));
    expect(piece.indexOf('name={name("title")}')).toBeLessThan(piece.indexOf('name={name("excerptBody")}'));
    // The fold says on its face that the summary is required before publication (§170).
    expect(piece).toContain('emptyHint={t("editor.excerptEmpty")}');
  });

  it("gives every per-language field exactly one piece", () => {
    // Not the place's name: it is asked once per language in the Locul box, with the event's fields (§362).
    for (const field of ["title", "excerptBody", "body", "schedule", "checklist", "rules", "slug", "seoTitle", "seoDescription"]) {
      expect(FIELDS.match(new RegExp(`name=\\{name\\("${field}"\\)\\}`, "g"))?.length ?? 0, field).toBeGreaterThanOrEqual(1);
    }
  });

  it("mounts no rich-text editor until its fold is opened", () => {
    expect(FIELDS).not.toMatch(/<RichTextEditor\b/);
    // The summary, the description, the programme's notes, the rules and the route description
    // (§387): five a language.
    expect(FIELDS.match(/<LazyRichTextEditor\b/g)).toHaveLength(5);
  });

  it("renders a language the reader may not write as text, and posts nothing for it", () => {
    expect(FIELDS).toContain("if (!mayEdit) {");
    expect(FIELDS).toContain('t("editor.boxes.textsReadOnly")');
    // The hidden id and version come once per editable language, at the top of the save form.
    expect(EDIT).toContain("languages.filter((entry) => entry.mayEdit).map((entry) => (");
    expect(EDIT).toContain("<TranslationHiddenFields");
  });

  it("gives each box's tabs their own ids, so six strips share one page", () => {
    // The Locul box has no strip since §362: its two names stand side by side. The course card has
    // one since §387, for the route description.
    const boxes = ["TextBoxes", "PlaceBox", "ProgrammeBox", "CourseBox"].map((file) => read(`src/modules/content/events/ui/boxes/${file}.tsx`)).join("");
    const prefixes = [...boxes.matchAll(/idPrefix="(\w+)"/g)].map((match) => match[1]);
    expect(prefixes.sort()).toEqual(["address", "course", "description", "programme", "rules", "title"]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
