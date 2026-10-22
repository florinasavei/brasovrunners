import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ALLOWED, PINNED } from "./guards-allowlist";
import { attribute, byFile, holdRatchet, type Hit, inBackoffice, type Opening, type Source, SOURCES, sxKeys, tagOf } from "./scan";

/**
 * §848 (the consistency audit's fourth wave; the owner, 2026-10-21: «they look like they are from a different app, not
 * consistent at all») — the backoffice's lists keep the one shape waves two and three gave them (§842, §845, §847): a
 * list of editable things is a `<ul>` of row folds (`shared/ui/row-fold.ts`): a line in words with its chips and the
 * pencil, the boxes inside the fold, delete last. Two guards hold it, on the same ratchet as the other design guards
 * (`guards-allowlist.ts`, §694):
 *
 * 1. `rowFolds` — a backoffice list row (`li`, `ListItem`, `component="li"`) with two or more boxes standing in it, not
 *    behind a fold (`<details>`, `RecallDetails`, a collapsible `Panel`) inside the row, is a wall of inputs: put the
 *    boxes inside the row's fold. A row with one box, or with verb buttons only (forms that are a press: «Șterge»,
 *    «Mai sus»), passes — a verb is not a box. A component named like a box (`…Field`, `…Select`, `…Picker`,
 *    `…Checkbox`, `…Radio`, `…Editor`; `…Box`, `…Input`, `…Toggle` with a `name`) counts as one, a group of them
 *    (`…Fields`, `…Boxes`) as two.
 * 2. `rowBoxes` — no hand-drawn row box: a backoffice row whose `sx` sets a border and a `borderRadius` (followed
 *    through spreads and same-file constants), or an outlined `Paper`/`Card` as the row. The row fold draws the row
 *    (`ROW_SX`): a hairline between rows, no card around each.
 *
 * "The backoffice" is every file under `/admin` or `/devs`, and every module file whose importers all lead only to
 * such routes (followed through the import graph), so a public card in `modules/events/ui` is never in scope and a
 * staff-only component under `modules/` always is. A failure prints `file:line — what matched`; the remedy is the row
 * fold, never a new entry.
 */

const isRow = (opening: Opening) => ["li", "ListItem"].includes(tagOf(opening)) || attribute(opening, "component") === "li";
const isFold = (opening: Opening) =>
  ["details", "RecallDetails", "Accordion"].includes(tagOf(opening)) ||
  attribute(opening, "component") === "details" ||
  (tagOf(opening) === "Panel" && attribute(opening, "collapsible") !== undefined && attribute(opening, "static") === undefined);

const FORMS = new Set(["form", "ActionForm", "DetachedActionForm"]);
const BARE = new Set(["input", "select", "textarea", "TextField", "Select", "NativeSelect", "Checkbox", "Radio", "RadioGroup", "Switch", "Slider", "Autocomplete"]);
const NAMED_CONTROL = /^[A-Z]\w*(?:Field|Select|Picker|Checkbox|Radio|Editor)$/;
const POSTING_BOX = /^[A-Z]\w*(?:Box|Input|Toggle)$/;
const GROUP = /^[A-Z]\w*(?:Fields|Boxes)$/;
function controlOf(opening: Opening): { kind: "form" | "input"; weight: number; name: string; whole?: boolean } | undefined {
  const tag = tagOf(opening);
  const component = attribute(opening, "component");
  if (FORMS.has(tag) || component === "form") return { kind: "form", weight: 0, name: tag };
  if (tag === "input" && ["hidden", "submit", "button"].includes(String(attribute(opening, "type")))) return undefined;
  if (/Hidden/.test(tag) || tag === "DetachedFields") return undefined;
  if (tag === "RadioGroup") return { kind: "input", weight: 1, name: tag, whole: true };
  if (BARE.has(tag) || (typeof component === "string" && ["input", "select", "textarea"].includes(component))) return { kind: "input", weight: 1, name: tag };
  if (NAMED_CONTROL.test(tag) || (POSTING_BOX.test(tag) && attribute(opening, "name") !== undefined)) return { kind: "input", weight: 1, name: tag };
  if (GROUP.test(tag)) return { kind: "input", weight: 2, name: tag };
  return undefined;
}

type Row = { file: string; line: number; forms: string[]; inputs: string[]; weight: number };
function rowsOf(source: Source): Row[] {
  const rows: Row[] = [];
  const openingOf = (node: ts.Node): Opening | undefined => (ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : undefined);
  const visit = (node: ts.Node) => {
    const opening = openingOf(node);
    if (opening && isRow(opening)) {
      const row: Row = { file: source.file, line: source.tree.getLineAndCharacterOfPosition(node.getStart(source.tree)).line + 1, forms: [], inputs: [], weight: 0 };
      const inside = (child: ts.Node) => {
        const open = openingOf(child);
        if (open && (isFold(open) || isRow(open))) return;
        const control = open && controlOf(open);
        if (control) {
          (control.kind === "form" ? row.forms : row.inputs).push(control.name);
          row.weight += control.weight;
          if (control.whole) return;
        }
        ts.forEachChild(child, inside);
      };
      if (ts.isJsxElement(node)) node.children.forEach(inside);
      rows.push(row);
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return rows;
}


const BORDER = /^border(?:Top|Bottom|Left|Right|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?(?:Width)?$/;
const NONE = (value: ts.Expression) => (ts.isNumericLiteral(value) && Number(value.text) === 0) || ((ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && ["0", "none", "0px"].includes(value.text));
type Boxed = { file: string; line: number; text: string };
function rowBoxesOf(source: Source): Boxed[] {
  const found: Boxed[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isRow(node)) {
      const line = source.tree.getLineAndCharacterOfPosition(node.getStart(source.tree)).line + 1;
      const tag = tagOf(node);
      if (["Paper", "Card"].includes(tag) && attribute(node, "variant") === "outlined") found.push({ file: source.file, line, text: `<${tag} component="li" variant="outlined">` });
      for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property) || property.name.getText() !== "sx" || !property.initializer || !ts.isJsxExpression(property.initializer) || !property.initializer.expression) continue;
        const keys = sxKeys(source, property.initializer.expression);
        const border = [...keys].filter(([key, value]) => BORDER.test(key) && !NONE(value)).map(([key]) => key);
        const radius = keys.get("borderRadius");
        if (border.length > 0 && radius && !NONE(radius)) found.push({ file: source.file, line, text: `<${tag}> sx sets ${border.join(", ")} and borderRadius` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return found;
}

/** What the two rules find in one source file, as hits. */
const MAX_LOOSE_BOXES = 1;
function rowFoldHits(source: Source): Hit[] {
  return rowsOf(source)
    .filter((row) => row.weight > MAX_LOOSE_BOXES)
    .map((row) => ({ file: row.file, line: row.line, text: `a row with ${row.weight} boxes outside a fold: ${row.inputs.join(", ")}` }));
}
const rowBoxHits = (source: Source): Hit[] => rowBoxesOf(source);

const BACKOFFICE_SOURCES = SOURCES.filter((source) => source.file.endsWith(".tsx") && inBackoffice(source.file));
const sample = (text: string): Source => ({ file: "src/app/[locale]/admin/x.tsx", text, tree: ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });

describe("§848 a backoffice list is row folds", () => {
  it("knows the backoffice: the staff routes and the modules only they reach, never a public card", () => {
    const files = BACKOFFICE_SOURCES.map((source) => source.file);
    expect(files.length).toBeGreaterThan(150);
    expect(files).toEqual(expect.arrayContaining(["src/modules/volunteers/ui/VolunteersCard.tsx", "src/modules/content/events/ui/CheckpointsCard.tsx", "src/shared/ui/TodoLine.tsx"]));
    expect(files).not.toContain("src/modules/events/ui/EventCard.tsx");
    expect(files).not.toContain("src/app/[locale]/members-area/MembersShop.tsx");
    expect(inBackoffice("src/app/[locale]/events/[slug]/page.tsx")).toBe(false);
  });

  it("puts every row's boxes inside the row's fold", () => {
    holdRatchet("rowFolds", byFile(BACKOFFICE_SOURCES.flatMap(rowFoldHits)), ALLOWED.rowFolds, PINNED.rowFolds, "Put the boxes inside the row's fold (`shared/ui/row-fold.ts`: a line in words, the pencil, the boxes inside, §842).");
  });

  it("draws no box around a row by hand", () => {
    holdRatchet("rowBoxes", byFile(BACKOFFICE_SOURCES.flatMap(rowBoxHits)), ALLOWED.rowBoxes, PINNED.rowBoxes, "A row is the row fold's `ROW_SX` (a hairline between rows), not a bordered card (§842).");
  });

  it("the tripwire sees a wall of inputs in a row, and lets the row fold and a row of verbs through", () => {
    const wall = '<ul><li><TextField name="a" /><RecallField name="b" /></li></ul>';
    expect(rowFoldHits(sample(wall))).toHaveLength(1);
    expect(rowFoldHits(sample('<ul><Box component="li"><ActionForm action={x}><CheckboxField name="a" /><input name="b" /></ActionForm></Box></ul>'))).toHaveLength(1);
    expect(rowFoldHits(sample('<ul><ListItem><RoleFields role={r} /></ListItem></ul>'))).toHaveLength(1);
    // The row fold: the same boxes, behind the row's own <details> or a collapsible Panel.
    expect(rowFoldHits(sample('<ul><Box component="li" sx={ROW_SX}><Box component="details"><Box component="summary" sx={SUMMARY_SX}>Rol</Box><TextField name="a" /><RecallField name="b" /></Box></Box></ul>'))).toEqual([]);
    expect(rowFoldHits(sample('<ul><li><Panel collapsible title="x"><TextField name="a" /><TextField name="b" /></Panel></li></ul>'))).toEqual([]);
    // A row of verbs, and a row with one box, pass: a press is not a box.
    expect(rowFoldHits(sample('<ul><li><ActionForm action={up}><input type="hidden" name="id" /><GlyphSubmitButton icon="moveUp" /></ActionForm><ActionForm action={remove}><GlyphSubmitButton icon="delete" /></ActionForm></li></ul>'))).toEqual([]);
    expect(rowFoldHits(sample('<ul><li><TextField name="a" /></li></ul>'))).toEqual([]);
  });

  it("the tripwire sees a row drawn as a card, through a spread and a constant, and lets the hairline through", () => {
    expect(rowBoxHits(sample('<ul><Box component="li" sx={{ border: 1, borderColor: "divider", borderRadius: 2 }} /></ul>'))).toHaveLength(1);
    expect(rowBoxHits(sample('const CARD = { border: 1, borderRadius: 1 };\n<ul><Box component="li" sx={{ ...CARD, p: 2 }} /></ul>'))).toHaveLength(1);
    expect(rowBoxHits(sample('<ul><Paper component="li" variant="outlined" /></ul>'))).toHaveLength(1);
    // The row fold's own line: a border under the row, no radius; and a radius with no border.
    expect(rowBoxHits(sample('<ul><Box component="li" sx={{ borderBottom: 1, borderColor: "divider" }} /></ul>'))).toEqual([]);
    expect(rowBoxHits(sample('<ul><Box component="li" sx={{ border: 0, borderRadius: 2 }} /></ul>'))).toEqual([]);
    expect(rowBoxHits(sample('<ul><Box sx={{ border: 1, borderRadius: 2 }} /></ul>'))).toEqual([]);
  });
});
