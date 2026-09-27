import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";

/**
 * §NNN — the owner, 2026-09-27: a glyph on every button and every fold header, on the public
 * site and in the backoffice. §498 did the public buttons and holds them with a hand-kept list
 * of public files (`tests/unit/events/conditions-fold-and-public-glyphs.test.ts`); this walks
 * **every** `.tsx` under `src/`, so a new component anywhere joins the rule without anybody
 * remembering to add it.
 *
 * Source-level, like §370's `server-element-props.test.ts` and §498's walk: the rule is about
 * what is written, and the TypeScript compiler API reads JSX without rendering it.
 *
 * - **Buttons:** every `Button`, `ButtonLink`, `SubmitButton`, `GlyphButton`, `GlyphButtonLink`,
 *   `GlyphSubmitButton`, `ConfirmSubmitButton` and bare `<button>` draws a glyph — by prop
 *   (`startIcon`, `runner`, `glyph`, `icon`) or as a child (an `…Icon` element, a `GLYPHS.…`
 *   lookup, a bare `<svg>`, or the `{children}` / `{icon}` a wrapper hands on).
 * - **Fold headers:** every `<summary>` — the element, or `component="summary"` — draws one of the
 *   same among its descendants, after the fold's own arrow.
 * - **Cards:** `Panel`'s type requires `glyph` on every card (the `help` line's caret is its
 *   picture), and `Panel` draws it in the heading, folded or not.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function tsxUnder(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory)).flatMap((entry) => {
    const relative = `${directory}/${entry}`;
    if (statSync(path.join(ROOT, relative)).isDirectory()) return tsxUnder(relative);
    return relative.endsWith(".tsx") ? [relative] : [];
  });
}

const FILES = tsxUnder("src");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const BUTTONS = new Set([
  "Button",
  "ButtonLink",
  "SubmitButton",
  "GlyphButton",
  "GlyphButtonLink",
  "GlyphSubmitButton",
  "ConfirmSubmitButton",
  "button",
]);
const GLYPH_PROPS = new Set(["startIcon", "runner", "glyph", "icon"]);

/** Whether a JSX subtree draws a glyph. */
function drawsGlyph(node: ts.Node): boolean {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const tag = node.tagName.getText();
    if (/Icon$/.test(tag) || tag === "Glyph" || tag === "svg" || /^GLYPHS\./.test(tag)) return true;
  }
  if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && ["children", "icon"].includes(node.expression.text)) return true;
  return ts.forEachChild(node, (child) => (drawsGlyph(child) ? true : undefined)) ?? false;
}

/**
 * The buttons that wear no separate glyph, each with its reason. A `file:words` entry matches a
 * button in that file whose source contains the words.
 *
 * - §498's two: the race's conditions row, whose required checkbox is its picture, and the
 *   header's «Meniu ▾» / ☰, which draws its glyph in text.
 * - The order arrows of the pages list, the team page and the club's checklist: the label *is*
 *   the glyph — "↑" and "↓" — and the row's name is the accessible name. Recognised by the label,
 *   so any file may use them.
 * - A bare `<button />` with no children at all: an invisible overlay over a control that draws
 *   its own picture (the telephone's flag, `PhoneField`), with nothing to put a glyph beside.
 */
const WITHOUT_GLYPH = new Set([
  "src/modules/registrations/ui/ReadAndAgree.tsx:agreed ? agreedLabel : openLabel",
  'src/shared/ui/SiteNav.tsx:id="site-nav-more"',
]);
const ARROW_LABEL = /\blabel="[↑↓]"/;

function exempt(file: string, node: ts.Node): boolean {
  const text = node.getText();
  if (ARROW_LABEL.test(text)) return true;
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "button") return true;
  return [...WITHOUT_GLYPH].some((allowed) => {
    const cut = allowed.indexOf(".tsx:") + ".tsx".length;
    return allowed.slice(0, cut) === file && text.includes(allowed.slice(cut + 1));
  });
}

function where(source: ts.SourceFile, node: ts.Node) {
  return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function buttonsWithoutGlyph(file: string): string[] {
  const source = parse(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && BUTTONS.has(opening.tagName.getText())) {
      const byProp = opening.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && GLYPH_PROPS.has(attribute.name.getText()));
      const byChild = ts.isJsxElement(node) && node.children.some((child) => drawsGlyph(child));
      if (!byProp && !byChild && !exempt(file, node)) found.push(where(source, opening));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * `Panel`'s own card summary draws `{heading}`, which holds the glyph — asserted below, where the
 * heading is built, rather than recognised here by a name.
 */
const SUMMARY_DRAWN_ELSEWHERE = new Set(["src/shared/ui/Panel.tsx:{heading}"]);

function foldsWithoutGlyph(file: string): string[] {
  const source = parse(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const component = opening.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "component");
      const isSummary = opening.tagName.getText() === "summary" || (component !== undefined && /"summary"/.test(component.getText()));
      if (isSummary) {
        const drawn = node.children.some((child) => drawsGlyph(child));
        const elsewhere = [...SUMMARY_DRAWN_ELSEWHERE].some((entry) => {
          const cut = entry.indexOf(".tsx:") + ".tsx".length;
          return entry.slice(0, cut) === file && node.getText().includes(entry.slice(cut + 1));
        });
        if (!drawn && !elsewhere) found.push(where(source, opening));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("§NNN a glyph on every button", () => {
  it("walks the whole tree, the public pages and the backoffice alike", () => {
    expect(FILES).toContain("src/app/[locale]/events/[slug]/page.tsx");
    expect(FILES).toContain("src/app/[locale]/admin/registrations/(list)/page.tsx");
    expect(FILES).toContain("src/modules/content/rich-text/ui/RichTextEditor.tsx");
    expect(FILES).toContain("src/shared/feedback/ConfirmDialog.tsx");
  });

  it("finds no button without a glyph, anywhere under src/", () => {
    expect(FILES.flatMap(buttonsWithoutGlyph)).toEqual([]);
  });

  it("the exceptions are still there and still what they say", () => {
    expect(read("src/modules/registrations/ui/ReadAndAgree.tsx")).toContain("{agreed ? agreedLabel : openLabel}");
    expect(read("src/shared/ui/SiteNav.tsx")).toContain('id="site-nav-more"');
    // The arrows still carry the row's name as their accessible name.
    for (const file of ["src/app/[locale]/admin/pages/(list)/page.tsx", "src/app/[locale]/admin/pages/team/page.tsx", "src/modules/club-todo/ui/ClubTodoPanel.tsx"]) {
      const text = read(file);
      expect(text, file).toMatch(/label="↑"[\s\S]*?ariaLabel=/);
    }
  });

  it("makes the confirming button's glyph required: a verb with several questions still wears its picture", () => {
    expect(read("src/shared/ui/ConfirmSubmitButton.tsx")).toMatch(/\n {2}icon: ActionIconName;/);
  });

  it("gives the confirmation dialog's three answers a glyph each", () => {
    const dialog = read("src/shared/feedback/ConfirmDialog.tsx");
    expect(dialog).toContain('startIcon={<CloseIcon fontSize="small" />}');
    expect(dialog).toContain('startIcon={<AltRouteIcon fontSize="small" />}');
    expect(dialog).toContain('startIcon={<CheckIcon fontSize="small" />}');
  });
});

describe("§NNN a glyph on every fold header", () => {
  it("finds no <summary> without a glyph, anywhere under src/", () => {
    expect(FILES.flatMap(foldsWithoutGlyph)).toEqual([]);
  });

  it("requires a glyph on every Panel card, by the type, and draws it inside the heading", () => {
    const panel = read("src/shared/ui/Panel.tsx");
    expect(panel).toMatch(/variant\?: "card";[\s\S]*?glyph: PanelGlyphName;/);
    expect(panel).toMatch(/variant: "help";\s*glyph\?: undefined;/);
    expect(panel).toMatch(/const heading = \(\s*<>\s*\{Glyph && <Glyph aria-hidden sx=\{FOLD_GLYPH_INLINE_SX\} \/>\}\s*\{title\}/);
  });

  it("draws the glyph, aria-hidden, before the words of a folded card and of a static one", () => {
    const folded = renderToStaticMarkup(createElement(Panel, { glyph: "course", collapsible: true, title: "Traseul" }, "x"));
    expect(folded).toMatch(/<summary[^>]*>[\s\S]*?<svg[^>]*aria-hidden="true"[^>]*data-testid="RouteIcon"[\s\S]*?Traseul/);
    const fixed = renderToStaticMarkup(createElement(Panel, { glyph: "costs", title: "Costuri" }, "x"));
    expect(fixed).toMatch(/<h2[^>]*>[\s\S]*?data-testid="PaidIcon"[\s\S]*?Costuri<\/h2>/);
  });

  it("keeps the help line's caret as its picture, with no second glyph", () => {
    const help = renderToStaticMarkup(createElement(Panel, { variant: "help", collapsible: true, title: "Ce înseamnă?" }, "x"));
    expect(help).toContain('data-testid="ExpandMoreIcon"');
    expect(help.match(/<svg/g)?.length).toBe(1);
  });
});

describe("§NNN the cards' glyph table", () => {
  const table = read("src/shared/ui/panel-glyphs.ts");
  const names = Object.keys(PANEL_GLYPHS);
  const sources = FILES.map((file) => read(file)).join("\n");

  it("names no glyph nobody draws", () => {
    for (const name of names) {
      expect(sources, name).toMatch(new RegExp(`glyph(?:="|: ")${name}"`));
    }
  });

  it("imports one file per glyph, never the barrel", () => {
    expect(table).not.toMatch(/from "@mui\/icons-material"/);
    const imports = [...table.matchAll(/^import \w+ from "@mui\/icons-material\/\w+";/gm)];
    expect(imports.length).toBe(new Set(Object.values(PANEL_GLYPHS)).size);
  });

  it("is looked up on the server only: no client file imports Panel or the table", () => {
    for (const file of FILES) {
      const text = read(file);
      if (!/^\s*"use client";/.test(text)) continue;
      expect(text, file).not.toMatch(/from "[^"]*(?:shared\/ui\/Panel|\.\/Panel|panel-glyphs)"/);
    }
  });
});
