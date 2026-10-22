import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ALLOWED, PINNED } from "./guards-allowlist";
import { attribute, byFile, holdRatchet, type Hit, inBackoffice, type Opening, type Source, SOURCES, sxKeys, tagOf } from "./scan";

/**
 * §NNN (the consistency audit's fourth wave; §844 removed the two stray `h1`s it found) — one heading scale in the
 * backoffice. Two guards, on the design ratchet (`guards-allowlist.ts`, §694):
 *
 * 1. `pageHeadings` — no `h1` in a backoffice page or component: the shell (`BackofficeShell`) draws the page's one
 *    `h1`, and a screen's own title is the next level. Counted: `<h1>`, `component="h1"`, `variant="h1"` unless a
 *    `component` names another element, and `Panel level={1}`. The two files that render instead of the shell (the
 *    shell itself, the resting notice the layout returns while the database is away) are the shell's own, never listed.
 * 2. `headingSizes` — no hand-sized heading: a heading (`variant` or `component` `h2`–`h6`) whose `sx` writes its own
 *    `fontSize` or `fontWeight`, followed through spreads and same-file constants. The size is the level's, from the
 *    one scale (`shared/ui/heading-scale.ts`'s `HEADING_SX`, which `Panel` wears); a bold line that is not a heading is
 *    `subtitle1`/`body1` with no heading element. Today's hand-sized headings — the screens' titles at 1.25rem, their
 *    parts at 1rem, from before the scale had a name — are pinned, to move onto it as each file is next touched.
 *
 * "The backoffice" is `scan.ts`'s `inBackoffice`: the staff routes and the modules only they reach.
 */
const SHELL = new Set(["src/modules/staff-identity/ui/BackofficeShell.tsx", "src/modules/resilience/ui/AdminRestingNotice.tsx"]);
const HEADING = /^h[2-6]$/;

function walk(source: Source, visit: (opening: Opening, line: number) => void) {
  const step = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) visit(node, source.tree.getLineAndCharacterOfPosition(node.getStart(source.tree)).line + 1);
    ts.forEachChild(node, step);
  };
  step(source.tree);
}

function pageHeadingHits(source: Source): Hit[] {
  const found: Hit[] = [];
  walk(source, (opening, line) => {
    const tag = tagOf(opening);
    const component = attribute(opening, "component");
    const variant = attribute(opening, "variant");
    const isH1 =
      tag === "h1" ||
      component === "h1" ||
      (variant === "h1" && (component === undefined || component === "h1")) ||
      (tag === "Panel" && opening.attributes.properties.some((property) => ts.isJsxAttribute(property) && property.name.getText() === "level" && property.initializer?.getText() === "{1}"));
    if (isH1) found.push({ file: source.file, line, text: `an h1 under the shell's own: <${tag}${component ? ` component="${component}"` : ""}${variant ? ` variant="${variant}"` : ""}>` });
  });
  return found;
}

function headingSizeHits(source: Source): Hit[] {
  const found: Hit[] = [];
  walk(source, (opening, line) => {
    const component = attribute(opening, "component");
    const variant = attribute(opening, "variant");
    const element = typeof component === "string" ? component : typeof variant === "string" ? variant : tagOf(opening);
    if (!HEADING.test(element)) return;
    for (const property of opening.attributes.properties) {
      if (!ts.isJsxAttribute(property) || property.name.getText() !== "sx" || !property.initializer || !ts.isJsxExpression(property.initializer) || !property.initializer.expression) continue;
      const keys = [...sxKeys(source, property.initializer.expression).keys()].filter((key) => key === "fontSize" || key === "fontWeight");
      if (keys.length > 0) found.push({ file: source.file, line, text: `an ${element} sized by hand: ${keys.join(", ")}` });
    }
  });
  return found;
}

const BACKOFFICE_SOURCES = SOURCES.filter((source) => source.file.endsWith(".tsx") && inBackoffice(source.file) && !SHELL.has(source.file));
const sample = (text: string): Source => ({ file: "src/app/[locale]/admin/x.tsx", text, tree: ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX) });

describe("§NNN one heading scale in the backoffice", () => {
  it("knows the shell draws the one h1", () => {
    for (const file of SHELL) expect(SOURCES.find((source) => source.file === file)?.text, file).toMatch(/variant="h1"/);
    expect(BACKOFFICE_SOURCES.length).toBeGreaterThan(150);
  });

  it("draws no h1 under the shell's", () => {
    holdRatchet("pageHeadings", byFile(BACKOFFICE_SOURCES.flatMap(pageHeadingHits)), ALLOWED.pageHeadings, PINNED.pageHeadings, "The shell draws the page's h1; a screen's title is h2 (`Panel level={2}`, `variant=\"h2\"`).");
  });

  it("sizes no heading by hand", () => {
    holdRatchet("headingSizes", byFile(BACKOFFICE_SOURCES.flatMap(headingSizeHits)), ALLOWED.headingSizes, PINNED.headingSizes, "Size a heading by its level from `HEADING_SX` (`shared/ui/heading-scale.ts`) or use `Panel`; a bold line that is not a heading is `subtitle1` with no heading element.");
  });

  it("the tripwires see each way of writing them, and let the house's headings through", () => {
    expect(pageHeadingHits(sample('<><h1>x</h1><Typography variant="h1">x</Typography><Typography component="h1" variant="h4">x</Typography><Panel level={1} title="x" /></>'))).toHaveLength(4);
    expect(pageHeadingHits(sample('<><Typography variant="h1" component="h2">x</Typography><Typography variant="h2">x</Typography><Panel level={2} title="x" /></>'))).toEqual([]);
    expect(headingSizeHits(sample('<Typography variant="h3" sx={{ fontSize: "1rem" }}>x</Typography>'))).toHaveLength(1);
    expect(headingSizeHits(sample('const BIG = { fontWeight: 800 };\n<Typography component="h2" variant="body1" sx={{ ...BIG, mb: 1 }}>x</Typography>'))).toHaveLength(1);
    expect(headingSizeHits(sample('<Typography variant="h3" sx={{ mb: 1 }}>x</Typography>'))).toEqual([]);
    expect(headingSizeHits(sample('<Typography component="h3" variant="h2" sx={{ ...HEADING_SX[3], mb: 1 }}>x</Typography>'))).toEqual([]);
    expect(headingSizeHits(sample('<Typography variant="subtitle1" sx={{ fontWeight: 700 }}>x</Typography>'))).toEqual([]);
  });
});
