import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `DECISIONS.md` §350 (the editor's boxes, building on §170 and §260) — the event editor as one
 * page of boxes, in the order of the questions they answer.
 *
 * The owner asked for the editor to read "like the event's fact sheet": each box answers one
 * question and says its answer while shut. The order is pinned here because it is what drifts —
 * the next field added lands in whichever box is nearest unless something says where boxes go:
 *
 *   Evenimentul — what kind, with its three cards inside it (§NNN; the owner: "these 3 cards
 *   should be in the first one, both on edit and create mode") — the status, the course, the
 *   links and files — then title and summary, description;
 *   Ziua evenimentului și participanții — date and time, place, programme, rules, registration;
 *   Parteneri și prezentare — partners, promotion, page address;
 *   then Salvare, always open.
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
  't("editor.groups.event")',
  "<KindBox",
  "<StatusBox",
  "<CourseBox",
  "<LinksBox",
  "</KindBox>",
  "<TitleSummaryBox",
  "<DescriptionBox",
  't("editor.groups.day")',
  "<WhenBox",
  "<PlaceBox",
  "<ProgrammeBox",
  "<RulesBox",
  "<RegistrationBox",
  't("editor.groups.details")',
  "<CoHostsBox",
  "<PromotionBox",
  "<AddressBox",
  'id="box-save"',
];

/** The page's source between `<KindBox` and `</KindBox>`: what the first box is handed. */
const firstBoxOf = (source: string) => source.slice(at(source, "<KindBox"), at(source, "</KindBox>"));

describe("§350 the editor's boxes, in order", () => {
  it("renders the three groups and their boxes in the order of the design, then Salvare", () => {
    const positions = EDITOR_ORDER.map((needle) => at(EDIT, needle));
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index], `${EDITOR_ORDER[index]} after ${EDITOR_ORDER[index - 1]}`).toBeGreaterThan(positions[index - 1]);
    }
  });

  it("nests the status, the course and the links inside the first box, on both pages, each once (§NNN)", () => {
    const CREATE = read("src/app/[locale]/admin/events/new/page.tsx");
    for (const [page, source] of [
      ["edit", EDIT],
      ["create", CREATE],
    ] as const) {
      const first = firstBoxOf(source);
      for (const card of ["<StatusBox", "<CourseBox", "<LinksBox"]) {
        expect(first, `${page}: ${card} inside <KindBox>`).toContain(card);
        expect(source.split(card).length - 1, `${page}: ${card} once`).toBe(1);
      }
      expect(first.indexOf("<StatusBox")).toBeLessThan(first.indexOf("<CourseBox"));
      expect(first.indexOf("<CourseBox")).toBeLessThan(first.indexOf("<LinksBox"));
      // Nothing else went in with them.
      expect(first.match(/<[A-Z]\w*Box\b/g), page).toEqual(["<KindBox", "<StatusBox", "<CourseBox", "<LinksBox"]);
    }
    // Named level-3 cards with their own ids, so a deep link or a refusal still lands on them.
    for (const [file, id] of [
      ["StatusBox", "box-status"],
      ["CourseBox", "box-course"],
      ["LinksBox", "box-links"],
    ] as const) {
      const source = read(`src/modules/content/events/ui/boxes/${file}.tsx`);
      expect(source, file).toMatch(new RegExp(`<Panel\\s+collapsible\\s+level=\\{3\\}\\s+id="${id}"`));
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
    expect(EDIT).toMatch(/\{mayChangeSeries && \(\s*<form action=\{duplicateEventAction\}>/);
    expect(EDIT).toContain("mayChange={mayChangeSeries}");
  });

  it("marks the five boxes a change reaches — date, place, programme, registration, status — and no other", () => {
    for (const box of ["<WhenBox", "<PlaceBox", "<ProgrammeBox", "<RegistrationBox", "<StatusBox"]) {
      const start = at(EDIT, box);
      expect(EDIT.slice(start, EDIT.indexOf("/>", start) + 2), box).toContain("risk={risk}");
    }
    // The opening tag only: the first box holds the status card, which is marked on its own (§NNN).
    for (const box of ["<KindBox", "<CourseBox", "<LinksBox", "<CoHostsBox", "<PromotionBox"]) {
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
    for (const field of ["title", "excerptBody", "body", "locationName", "schedule", "checklist", "rules", "slug", "seoTitle", "seoDescription"]) {
      expect(FIELDS.match(new RegExp(`name=\\{name\\("${field}"\\)\\}`, "g"))?.length ?? 0, field).toBeGreaterThanOrEqual(1);
    }
  });

  it("mounts no rich-text editor until its fold is opened", () => {
    expect(FIELDS).not.toMatch(/<RichTextEditor\b/);
    // The summary, the description, the programme's notes and the rules: four a language.
    expect(FIELDS.match(/<LazyRichTextEditor\b/g)).toHaveLength(4);
  });

  it("renders a language the reader may not write as text, and posts nothing for it", () => {
    expect(FIELDS).toContain("if (!mayEdit) {");
    expect(FIELDS).toContain('t("editor.boxes.textsReadOnly")');
    // The hidden id and version come once per editable language, at the top of the save form.
    expect(EDIT).toContain("languages.filter((entry) => entry.mayEdit).map((entry) => (");
    expect(EDIT).toContain("<TranslationHiddenFields");
  });

  it("gives each box's tabs their own ids, so six strips share one page", () => {
    const boxes = read("src/modules/content/events/ui/boxes/TextBoxes.tsx") + read("src/modules/content/events/ui/boxes/PlaceBox.tsx") + read("src/modules/content/events/ui/boxes/ProgrammeBox.tsx");
    const prefixes = [...boxes.matchAll(/idPrefix="(\w+)"/g)].map((match) => match[1]);
    expect(prefixes.sort()).toEqual(["address", "description", "place", "programme", "rules", "title"]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
