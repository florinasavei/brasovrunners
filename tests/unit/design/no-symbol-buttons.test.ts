import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * BR-REQ-041-01 (a glyph on every button); `DECISIONS.md` §710 — a button says what it does in
 * words. The owner, 2026-10-11, of the arrow on a card in «Echipa»: «Nu înțeleg ce face butonul ăsta
 * cu săgeata, are nevoie de vreun tooltip». A bare «↓» is a symbol the reader must interpret, a
 * phone has no hover to explain it, and a tooltip alone would leave the button itself mute: the
 * words are on the button, the glyph before them is the registry's, the tooltip says what changes.
 *
 * What this refuses, in every source file under `src/` (an AST walk): any `label` or `*Label`
 * attribute whose string literal has no letter or digit in it («↑», «×», «+»), and any element whose
 * tag ends in `Button` (`Button`, `Mui.Button`, a wrapper) whose only content is such a symbol. A label that is a translated key is not a literal and is the
 * catalogue's business: `tests/unit/i18n` holds every key to both languages.
 */
const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(entry) ? [full] : [];
  });
}

/** Text that says nothing in words: at least one character, none of them a letter or a digit. */
const SYMBOL_ONLY = /^[^\p{L}\p{N}]+$/u;
const isSymbol = (text: string) => SYMBOL_ONLY.test(text.trim());

/**
 * Walks the JSX, not the text: an `onClick={() => …}` carries a `>` that ends a regular expression
 * early. Flags a `label` / `pendingLabel` / `*Label` attribute whose string literal is a symbol, and
 * any element whose tag is or ends in `Button` (`Button`, `IconButton`, `GlyphButton`, a wrapper) whose
 * only non-blank child is a symbol.
 */
function symbolOnlyButtons(source: string): string[] {
  const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && /^(?:label|.*Label)$/.test(node.name.getText())) {
      const init = node.initializer;
      const literal = init && ts.isStringLiteralLike(init) ? init : init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression) ? init.expression : null;
      if (literal && isSymbol(literal.text)) found.push(`${node.name.getText()}="${literal.text}"`);
    }
    if (ts.isJsxElement(node) && /(?:^|[a-z.])Button$|^button$/.test(node.openingElement.tagName.getText())) {
      const content = node.children.filter((child) => !(ts.isJsxText(child) && child.text.trim() === ""));
      const only = content.length === 1 ? content[0] : null;
      const text = only && ts.isJsxText(only) ? only.text : only && ts.isJsxExpression(only) && only.expression && ts.isStringLiteralLike(only.expression) ? only.expression.text : null;
      if (text !== null && isSymbol(text)) found.push(`button content «${text.trim()}»`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("a button says what it does in words (§710)", () => {
  it("no source file writes a symbol-only label or a symbol-only button", () => {
    const offenders = sourceFiles(path.join(ROOT, "src")).flatMap((file) => {
      const found = symbolOnlyButtons(readFileSync(file, "utf8"));
      return found.map((what) => `${path.relative(ROOT, file).replace(/\\/g, "/")} ${what}`);
    });
    expect(offenders).toEqual([]);
  });

  it("the tripwire itself sees an arrow, a cross and a plus, and lets words through", () => {
    expect(symbolOnlyButtons('<SubmitButton label="↓" pendingLabel="↓" />')).not.toEqual([]);
    expect(symbolOnlyButtons('<SubmitButton label="×" pendingLabel="Se salvează…" />')).not.toEqual([]);
    expect(symbolOnlyButtons('<Button type="submit">\n  ↑\n</Button>')).not.toEqual([]);
    expect(symbolOnlyButtons('<Button>+</Button>')).not.toEqual([]);
    expect(symbolOnlyButtons('<Button>{`↑`}</Button>')).not.toEqual([]);
    expect(symbolOnlyButtons('<Mui.Button>↑</Mui.Button>')).not.toEqual([]);
    // The shapes a line-based pattern missed: a `=>` in a prop, a wrapper, a label under another name.
    expect(symbolOnlyButtons("<Button onClick={() => go(-1)}>↑</Button>")).not.toEqual([]);
    expect(symbolOnlyButtons('<GlyphButton icon="moveUp">↑</GlyphButton>')).not.toEqual([]);
    expect(symbolOnlyButtons('<SubmitButton confirmLabel="×" />')).not.toEqual([]);
    expect(symbolOnlyButtons('<SubmitButton label={t("team.moveUpWord")} pendingLabel="Salvează…" />')).toEqual([]);
    expect(symbolOnlyButtons("<Button>Mai sus</Button>")).toEqual([]);
  });

  it("the moves wear a glyph, words and a tooltip: the team card, the boxes, the FAQ, the codes, the shop, the list", () => {
    const sites = [
      "src/app/[locale]/admin/pages/team/page.tsx",
      "src/app/[locale]/admin/pages/team/BoxesCard.tsx",
      "src/app/[locale]/admin/pages/faq/page.tsx",
      "src/app/[locale]/admin/pages/members/CodesCard.tsx",
      "src/modules/club-todo/ui/ClubTodoPanel.tsx",
      "src/modules/content/shop/ui/ProductList.tsx",
      "src/modules/content/shop/ui/ProductPicturesCard.tsx",
    ];
    for (const site of sites) {
      const source = readFileSync(path.join(ROOT, site), "utf8");
      for (const icon of ["moveUp", "moveDown"]) {
        const tag = new RegExp(String.raw`<GlyphSubmitButton icon="${icon}"[^>]*>`).exec(source)?.[0] ?? "";
        expect(tag, `${site} ${icon}`).toContain("tooltip={t(");
        expect(tag, `${site} ${icon}`).toContain(`${icon}Word`);
      }
    }
  });
  it("the client editors' move buttons carry a tooltip, and the team card's links also the words", () => {
    const team = readFileSync(path.join(ROOT, "src/modules/content/team/ui/TeamLinkRowsEditor.tsx"), "utf8");
    expect(team).toContain("labels.moveUpWord");
    expect(team).toContain("labels.moveDownWord");
    expect(team.match(/<TipSpan /g)?.length).toBe(2);
    for (const file of ["CoHostRowsEditor", "LinkRowsEditor"]) {
      const source = readFileSync(path.join(ROOT, `src/modules/content/events/ui/${file}.tsx`), "utf8");
      const arrows = source.match(/<Arrow(?:Up|Down)wardIcon/g)?.length ?? 0;
      expect(source.match(/<TipSpan /g)?.length, file).toBe(arrows);
    }
  });
});
