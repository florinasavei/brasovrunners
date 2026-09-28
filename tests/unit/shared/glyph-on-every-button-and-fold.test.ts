import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import Panel from "@/shared/ui/Panel";
import { PANEL_GLYPHS } from "@/shared/ui/panel-glyphs";
import { WITHOUT_GLYPH } from "./glyph-allowlist";

/**
 * §521 — the owner, 2026-09-27: a glyph on every button and every fold header, on the public
 * site and in the backoffice. §498 did the public buttons and holds them with a hand-kept list
 * of public files (`tests/unit/events/conditions-fold-and-public-glyphs.test.ts`); this walks
 * **every** `.tsx` under `src/`, so a new component anywhere joins the rule without anybody
 * remembering to add it.
 *
 * Source-level, like §370's `server-element-props.test.ts` and §498's walk: the rule is about
 * what is written, and the TypeScript compiler API reads JSX without rendering it.
 *
 * - **Buttons:** every `Button`, `ButtonLink`, `SubmitButton`, `GlyphButton`, `GlyphButtonLink`,
 *   `GlyphSubmitButton`, `ConfirmSubmitButton`, `ToggleButton`, bare `<button>`, and any element
 *   drawn as one (`component="button"`, `role="button"`) draws a glyph — by prop (`startIcon`,
 *   `runner`, `glyph`, `icon`) or as a child (an `…Icon` element, a `GLYPHS.…` lookup, a bare
 *   `<svg>`). A `{children}` counts only in a wrapper named in `PASSED_ON`, whose call sites are
 *   checked in its place. The exceptions, each with its reason, are `glyph-allowlist.ts`.
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

/**
 * The button components. A wrapper that hands its caller's glyph on (see `PASSED_ON`) is listed
 * here too, so every place it is used is checked for the glyph it is handed.
 */
const BUTTONS = new Set([
  "Button",
  "ButtonLink",
  "SubmitButton",
  "GlyphButton",
  "GlyphButtonLink",
  "GlyphSubmitButton",
  "ConfirmSubmitButton",
  "ToggleButton",
  "InstagramShareButton",
  "button",
]);
const GLYPH_PROPS = new Set(["startIcon", "runner", "glyph", "icon"]);

/**
 * The wrappers whose button draws the glyph its caller hands it — `{children}` or `{icon}` — rather
 * than one of its own. Anywhere else, a bare `{children}` inside a button proves nothing and does
 * not count. Each wrapper's call sites are checked instead: a component through `BUTTONS`, the
 * share row's local `anchor(…)` helper by the test below.
 */
const PASSED_ON: ReadonlyArray<{ file: string; expression: string; wrapper: string }> = [
  { file: "src/shared/ui/ButtonLink.tsx", expression: "children", wrapper: "ButtonLink" },
  { file: "src/modules/events/ui/InstagramShareButton.tsx", expression: "children", wrapper: "InstagramShareButton" },
  { file: "src/modules/events/ui/ShareLinks.tsx", expression: "icon", wrapper: "anchor" },
];

/**
 * A fold's own arrow — or MUI's `ListItemIcon`, which is only the box a glyph sits in — ends in
 * `Icon` but says nothing about the subject (§521: "the arrow says the fold opens; the glyph says
 * what is inside"). A header that draws only one of these has no glyph. `ListItemIcon`'s children
 * are still read: the glyph inside it counts.
 */
const NOT_A_GLYPH = /^(?:ExpandMore\w*|ExpandLess\w*|Chevron\w*|ArrowDropDown\w*|ArrowDropUp\w*|KeyboardArrow\w*|ListItemIcon)$/;

/** Whether a JSX subtree draws a glyph; `passedOn` names the expressions a wrapper hands on. */
function drawsGlyph(node: ts.Node, passedOn: ReadonlySet<string>): boolean {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const tag = node.tagName.getText();
    if (NOT_A_GLYPH.test(tag)) return false;
    if (/Icon$/.test(tag) || tag === "Glyph" || tag === "svg" || /^GLYPHS\./.test(tag)) return true;
  }
  if (ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && passedOn.has(node.expression.text)) return true;
  return ts.forEachChild(node, (child) => (drawsGlyph(child, passedOn) ? true : undefined)) ?? false;
}

const passedOnIn = (file: string) => new Set(PASSED_ON.filter((entry) => entry.file === file).map((entry) => entry.expression));

const ARROW_LABEL = /\blabel="[↑↓]"/;
const ARROW = /^[↑↓]$/;

/** An order arrow written as the button's only words, `<Button …>↑</Button>`: the label is the glyph. */
function isArrowButton(node: ts.Node): boolean {
  if (!ts.isJsxElement(node)) return false;
  const words = node.children.filter((child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
  return words.length === 1 && ts.isJsxText(words[0]) && ARROW.test(words[0].text.trim());
}

function attribute(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): string | undefined {
  const found = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText() === name);
  return found && ts.isJsxAttribute(found) ? found.initializer?.getText() : undefined;
}

/** A button by its tag, or any element drawn as one: `component="button"` or `role="button"`. */
function isButton(opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean {
  return BUTTONS.has(opening.tagName.getText()) || attribute(opening, "component") === '"button"' || attribute(opening, "role") === '"button"';
}

function exempt(file: string, node: ts.Node): boolean {
  const text = node.getText();
  if (ARROW_LABEL.test(text) || isArrowButton(node)) return true;
  // A button with no children at all: an invisible overlay over a control that draws its own picture.
  if (ts.isJsxSelfClosingElement(node) && (node.tagName.getText() === "button" || attribute(node, "component") === '"button"')) return true;
  return WITHOUT_GLYPH.some((allowed) => allowed.file === file && text.includes(allowed.words));
}

function where(source: ts.SourceFile, node: ts.Node) {
  return `${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

function buttonsWithoutGlyph(file: string): string[] {
  const source = parse(file);
  const passedOn = passedOnIn(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && isButton(opening)) {
      const byProp = opening.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && GLYPH_PROPS.has(attribute.name.getText()));
      const byChild = ts.isJsxElement(node) && node.children.some((child) => drawsGlyph(child, passedOn));
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

const NOTHING_PASSED_ON: ReadonlySet<string> = new Set();

function foldsWithoutGlyph(file: string): string[] {
  const source = parse(file);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const component = opening.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "component");
      const isSummary = opening.tagName.getText() === "summary" || (component !== undefined && /"summary"/.test(component.getText()));
      if (isSummary) {
        const drawn = node.children.some((child) => drawsGlyph(child, NOTHING_PASSED_ON));
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

describe("§521 a glyph on every button", () => {
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
    for (const allowed of WITHOUT_GLYPH) {
      expect(allowed.reason, allowed.file).toMatch(/\S/);
      expect(read(allowed.file), `${allowed.file}: ${allowed.words}`).toContain(allowed.words);
    }
    // The arrows still carry the row's name as their accessible name.
    for (const file of ["src/app/[locale]/admin/pages/(list)/page.tsx", "src/app/[locale]/admin/pages/team/page.tsx", "src/modules/club-todo/ui/ClubTodoPanel.tsx"]) {
      const text = read(file);
      expect(text, file).toMatch(/label="↑"[\s\S]*?ariaLabel=/);
    }
    // The FAQ cards' arrows are the page's one save, written as the button's words, named too.
    const faq = read("src/app/[locale]/admin/pages/faq/page.tsx");
    expect(faq).toMatch(/value=\{`\$\{index\}:up`\}[^>]*aria-label=\{t\("faq\.moveUpNamed"/);
    expect(faq).toMatch(/value=\{`\$\{index\}:down`\}[^>]*aria-label=\{t\("faq\.moveDownNamed"/);
  });

  it("recognises an order arrow written as the button's only words, and nothing more", () => {
    const button = (source: string) => {
      const file = ts.createSourceFile("x.tsx", `const x = ${source};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      let found: ts.Node | undefined;
      const visit = (node: ts.Node) => {
        if (!found && ts.isJsxElement(node)) found = node;
        ts.forEachChild(node, visit);
      };
      visit(file);
      return found as ts.Node;
    };
    expect(isArrowButton(button("<Button type=\"submit\">\n  ↑\n</Button>"))).toBe(true);
    expect(isArrowButton(button("<Button>↓</Button>"))).toBe(true);
    expect(isArrowButton(button("<Button>↑ Sus</Button>"))).toBe(false);
    expect(isArrowButton(button("<Button>{label}</Button>"))).toBe(false);
  });

  it("a wrapper that hands its caller's glyph on is itself checked where it is used", () => {
    for (const entry of PASSED_ON) {
      expect(read(entry.file), entry.file).toContain(`{${entry.expression}}`);
      if (entry.wrapper !== "anchor") expect(BUTTONS.has(entry.wrapper), entry.wrapper).toBe(true);
    }
    // The share row's local helper: every call hands it an icon element.
    const share = read("src/modules/events/ui/ShareLinks.tsx");
    const calls = [...share.matchAll(/\banchor\(([\s\S]*?)\)\}/g)];
    expect(calls.length).toBe(4);
    for (const call of calls) expect(call[1]).toMatch(/<\w+Icon\b/);
  });

  it("does not count a bare {children} inside a button that is not a listed wrapper", () => {
    const source = ts.createSourceFile("x.tsx", "const x = <Button>{children}{label}</Button>;", ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(drawsGlyph(source, new Set())).toBe(false);
    expect(drawsGlyph(source, new Set(["children"]))).toBe(true);
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

describe("§521 a glyph on every fold header", () => {
  it("finds no <summary> without a glyph, anywhere under src/", () => {
    expect(FILES.flatMap(foldsWithoutGlyph)).toEqual([]);
  });

  it("does not count the fold's own arrow, or an empty ListItemIcon, as its glyph", () => {
    const summary = (inner: string) =>
      ts.createSourceFile("x.tsx", `const x = <summary>${inner}</summary>;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const arrow of ["<ExpandMoreIcon />", "<ChevronRightIcon fontSize=\"small\" />", "<ArrowDropDownIcon />", "<KeyboardArrowDownIcon />", "<ListItemIcon />"]) {
      expect(drawsGlyph(summary(`${arrow}Detalii`), NOTHING_PASSED_ON), arrow).toBe(false);
    }
    // The arrow and a subject glyph: the subject counts.
    expect(drawsGlyph(summary("<ExpandMoreIcon /><RouteIcon aria-hidden />Traseul"), NOTHING_PASSED_ON)).toBe(true);
    // A glyph inside ListItemIcon still counts: the box is not the picture, what it holds is.
    expect(drawsGlyph(summary("<ListItemIcon><EventIcon /></ListItemIcon>Evenimente"), NOTHING_PASSED_ON)).toBe(true);
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

describe("§521 the cards' glyph table", () => {
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
