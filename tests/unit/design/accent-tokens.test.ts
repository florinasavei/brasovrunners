import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SOURCES, type Source } from "./scan";

/**
 * BR-REQ-070-02, §NNN (amending §708 and §694) — a page never names the pink, or a preset: the
 * accent is the club's setting.
 *
 * Under «Aspectul nou» the accent is the club's choice (pink, blue, orange, or a colour it types).
 * The locale layout writes it into MUI's `--mui-palette-primary-*` variables and into one variable
 * of ours, `--br-accent-tint`, so a public page wears it by asking for `primary.main`,
 * `primary.light` or `primary.dark` in `sx`, or for `LOOK_ACCENT_TINT` (`theme/look.ts`). A page that
 * names one of the pink's tokens (`COLOR.accentInk`) or reads a preset (`LOOK_ACCENT.blue`) keeps
 * that colour whatever the club chose, and nothing on any screen says so: the accent would reach
 * everything but that page.
 *
 * What it refuses, in a file of `src/` (a comment and a string are never read: the files are parsed
 * with the TypeScript the project already has, as `scan.ts` does for every guard of §694):
 *
 * 1. A read of one of the pink's tokens — a key beginning `accent` (`accent`, `accentInk`,
 *    `accentDeep`, `accentTint`) of `COLOR` or `COLOR_DARK` — by property (`COLOR.accentInk`), by a
 *    literal key (`COLOR["accentInk"]`), by destructuring (`const { accentInk } = COLOR`, and the
 *    assignment form), through a renamed import (`import { COLOR as C }`) or through a namespace
 *    (`brand.COLOR.accent`). Anywhere but `src/theme/brand.ts`, which defines the tokens, and
 *    `src/theme/brand-pairs.ts`, which holds them to AA.
 * 2. A mention of `LOOK_ACCENT` (the presets, whatever the key: `.pink`, `["blue"]`, `[preset]`) or
 *    `LOOK_PRIMARY` (the pink's primary). Anywhere but the theme (`src/theme/`), the setting and its
 *    derivation (`src/modules/appearance/`) and the design page, which draws the presets in
 *    miniature (`src/modules/design/`).
 *
 * It is a tripwire for the shapes a person reaches for, not a proof: a key it cannot read
 * (`COLOR[key]`, as the theme's own helpers write it) and a table copied into another name are not
 * followed.
 *
 * A failure prints `file:line — what was read`. To fix one, ask the setting: `primary.main` (the
 * words), `primary.light` (the mark), `primary.dark` (a pressed button) or `LOOK_ACCENT_TINT` (the
 * pale band). The guard has no allowlist, and none to add. Each shape it refuses is planted below
 * in a source of its own, so a shape that stops being caught fails here by name.
 */
const TOKEN_TABLES = new Set(["COLOR", "COLOR_DARK"]);
const PRESET_NAMES = new Set(["LOOK_ACCENT", "LOOK_PRIMARY"]);
/** The two files that define the pink's tokens and hold them to AA. */
const TOKEN_FILES = new Set(["src/theme/brand.ts", "src/theme/brand-pairs.ts"]);
/** The three homes of the presets: the theme, the setting and its derivation, the page that draws them. */
const PRESET_HOMES = ["src/theme/", "src/modules/appearance/", "src/modules/design/"];

const HOW =
  "A page wears the club's accent through `primary.main`, `primary.light` and `primary.dark` in `sx`, or `LOOK_ACCENT_TINT` for the band — it never names the pink's tokens or a preset. Convert the read; there is no allowlist.";

type Read = { kind: "token" | "preset"; line: number; text: string };

/** A key written out, as `["accentInk"]` writes it: never a variable that happens to be named like one. */
const isLiteral = (node: ts.Node): boolean => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** Whether a property name, a binding name or a literal key begins `accent`. */
function namesAccent(name: ts.Node | undefined): boolean {
  if (!name) return false;
  return (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) && name.text.startsWith("accent");
}

/** `COLOR` and `COLOR_DARK` as this file names them: their own names and the local name of each renamed import. */
function tableNames(source: Source): Set<string> {
  const names = new Set(TOKEN_TABLES);
  for (const statement of source.tree.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) if (TOKEN_TABLES.has((element.propertyName ?? element.name).text)) names.add(element.name.text);
  }
  return names;
}

/** Every read of an accent token or a preset in one file, wherever the file is: `refused` says where it may. */
function accentReads(source: Source): Read[] {
  const tables = tableNames(source);
  // `COLOR`, a renamed `COLOR`, or the module's namespace's `.COLOR`.
  const isTable = (node: ts.Expression): boolean => (ts.isIdentifier(node) ? tables.has(node.text) : ts.isPropertyAccessExpression(node) && TOKEN_TABLES.has(node.name.text));
  const reads: Read[] = [];
  const found = (node: ts.Node, kind: Read["kind"], text: string) => {
    reads.push({ kind, line: source.tree.getLineAndCharacterOfPosition(node.getStart(source.tree)).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && isTable(node.expression) && namesAccent(node.name)) {
      found(node, "token", node.getText(source.tree));
    } else if (ts.isElementAccessExpression(node) && isTable(node.expression) && isLiteral(node.argumentExpression) && namesAccent(node.argumentExpression)) {
      found(node, "token", node.getText(source.tree));
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isTable(node.initializer)) {
      for (const element of node.name.elements) {
        if (namesAccent(element.propertyName ?? element.name)) found(element, "token", `{ ${element.getText(source.tree)} } = ${node.initializer.getText(source.tree)}`);
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(node.left) && isTable(node.right)) {
      for (const property of node.left.properties) {
        if (namesAccent(property.name)) found(property, "token", `{ ${property.getText(source.tree)} } = ${node.right.getText(source.tree)}`);
      }
    } else if (ts.isIdentifier(node) && PRESET_NAMES.has(node.text)) {
      found(node, "preset", node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return reads;
}

/** What one file may not do, as `file:line — what was read`. */
function refused(source: Source): string[] {
  return accentReads(source)
    .filter((read) => (read.kind === "token" ? !TOKEN_FILES.has(source.file) : !PRESET_HOMES.some((home) => source.file.startsWith(home))))
    .map((read) => `${source.file}:${read.line} — ${read.text}`);
}

/** A source made from text, parsed as `scan.ts` parses the real ones (the status chip's guard does the same): the probes below plant a read in it. */
const sourceOf = (file: string, text: string): Source => ({ file, text, tree: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) });

const sourceAt = (file: string): Source => {
  const source = SOURCES.find((candidate) => candidate.file === file);
  if (!source) throw new Error(`${file} is not a file of src/`);
  return source;
};

/** A file that is none of the exceptions: a component of a public page. */
const PAGE = "src/modules/events/ui/Probe.tsx";
const readsOf = (code: string): string[] => accentReads(sourceOf(PAGE, code)).map((read) => `${read.kind}: ${read.text}`);

/** Each way a page can name the pink or a preset, with exactly the reads the guard reports for it. */
const SHAPES: Record<string, { code: string; reads: string[] }> = {
  "a property of the light tokens": { code: "const tint = COLOR.accentTint;", reads: ["token: COLOR.accentTint"] },
  "a property of the dark tokens": { code: "const deep = COLOR_DARK.accentDeep;", reads: ["token: COLOR_DARK.accentDeep"] },
  "the bare accent": { code: "const mark = COLOR.accent;", reads: ["token: COLOR.accent"] },
  "a key of the family that does not exist yet": { code: "const wash = COLOR.accentWash;", reads: ["token: COLOR.accentWash"] },
  "an sx object, as a page writes one": {
    code: "const sx = { [UNDER_LOOK]: { bgcolor: COLOR.accentTint }, [UNDER_LOOK_DARK]: { bgcolor: COLOR_DARK.accentTint } };",
    reads: ["token: COLOR.accentTint", "token: COLOR_DARK.accentTint"],
  },
  "a literal key": { code: 'const ink = COLOR["accentInk"];', reads: ['token: COLOR["accentInk"]'] },
  "a template literal as the key": { code: "const ink = COLOR_DARK[`accentInk`];", reads: ["token: COLOR_DARK[`accentInk`]"] },
  "a destructuring": { code: "const { accentInk } = COLOR;", reads: ["token: { accentInk } = COLOR"] },
  "a destructuring that renames the key, among others": { code: "const { ink, accent: pink } = COLOR_DARK;", reads: ["token: { accent: pink } = COLOR_DARK"] },
  "a destructuring assignment": { code: "let tint; ({ accentTint: tint } = COLOR);", reads: ["token: { accentTint: tint } = COLOR"] },
  "a renamed import": { code: 'import { COLOR as BRAND } from "@/theme/brand";\nconst ink = BRAND.accentInk;', reads: ["token: BRAND.accentInk"] },
  "a namespace import": { code: 'import * as brand from "@/theme/brand";\nconst ink = brand.COLOR.accentInk;', reads: ["token: brand.COLOR.accentInk"] },
  "a preset by its name": { code: "const pink = LOOK_ACCENT.pink.light.accent;", reads: ["preset: LOOK_ACCENT"] },
  "a preset by a literal key": { code: 'const blue = LOOK_ACCENT["blue"];', reads: ["preset: LOOK_ACCENT"] },
  "a preset by a variable": { code: "const some = LOOK_ACCENT[preset];", reads: ["preset: LOOK_ACCENT"] },
  "the pink's primary": { code: "const main = LOOK_PRIMARY.light.main;", reads: ["preset: LOOK_PRIMARY"] },
  "an import of a preset alone": { code: 'import { LOOK_ACCENT } from "@/theme/brand";', reads: ["preset: LOOK_ACCENT"] },
  "a renamed import of the primary": { code: 'import { LOOK_PRIMARY as PRIMARY } from "@/modules/appearance/domain/site-look";\nconst main = PRIMARY.light.main;', reads: ["preset: LOOK_PRIMARY"] },
};

/** What a page may write, among all the ways it comes close. */
const FINE: Record<string, string> = {
  "a comment": '// COLOR.accentInk, COLOR["accent"] and LOOK_ACCENT.pink, in words\n/* const { accent } = COLOR; */',
  "a string": 'const words = "COLOR.accentInk and LOOK_PRIMARY";',
  "a template literal": "const words = `COLOR_DARK.accentTint`;",
  "the logo's blue and the neutrals": "const sx = { color: COLOR.blueInk, bgcolor: COLOR_DARK.blue, borderColor: COLOR.line };",
  "other keys of the table, destructured": "const { blue, ink, paper } = COLOR;",
  "what the setting writes": 'const sx = { color: "primary.main", bgcolor: LOOK_ACCENT_TINT, borderColor: "primary.light" };',
  "names that only begin like a preset": "const all = [LOOK_ACCENT_PRESETS, LOOK_ACCENT_PAIRS, LOOK_ACCENT_TINT_VARIABLE, LOOK_PRIMARY_TOKENS];",
  "an accent that is not the tokens'": "const { accent } = props;\nconst ink = style.accentInk + COLORS.accentInk;",
  "a key it cannot read": "const ink = COLOR[key] + COLOR_DARK[tone.fill];",
  "a variable named like a key": "const ink = COLOR[accentKey];",
};

describe("§NNN a page names neither the pink nor a preset", () => {
  it("reads the real tree: the tokens where they are defined, the presets where they are used", () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(accentReads(sourceAt("src/theme/brand.ts")).some((read) => read.kind === "token")).toBe(true);
    expect(accentReads(sourceAt("src/modules/appearance/domain/site-look.ts")).some((read) => read.kind === "preset")).toBe(true);
  });

  for (const [name, { code, reads }] of Object.entries(SHAPES)) {
    it(`catches ${name}`, () => {
      expect(readsOf(code)).toEqual(reads);
      expect(refused(sourceOf(PAGE, code)).length, "refused in a page").toBe(reads.length);
    });
  }

  for (const [name, code] of Object.entries(FINE)) {
    it(`lets through ${name}`, () => {
      expect(readsOf(code)).toEqual([]);
    });
  }

  it("prints where it found the read", () => {
    expect(refused(sourceOf(PAGE, "const a = 1;\nconst ink = COLOR.accentInk;"))).toEqual([`${PAGE}:2 — COLOR.accentInk`]);
  });

  it("lets the theme define the tokens and three homes use the presets, and no other file", () => {
    const token = "const ink = COLOR.accentInk;";
    const preset = "const pink = LOOK_ACCENT.pink;";
    for (const file of TOKEN_FILES) expect(refused(sourceOf(file, token)), file).toEqual([]);
    for (const file of ["src/theme/look.ts", "src/theme/surfaces.ts", "src/modules/appearance/domain/site-look.ts", "src/modules/design/ui/LookSection.tsx"]) {
      expect(refused(sourceOf(file, token)), `${file} may not read the tokens`).toHaveLength(1);
    }
    for (const file of ["src/theme/brand.ts", "src/theme/look.ts", "src/modules/appearance/ui/SiteLookPanel.tsx", "src/modules/design/ui/LookSection.tsx"]) {
      expect(refused(sourceOf(file, preset)), `${file} may use the presets`).toEqual([]);
    }
    for (const file of ["src/modules/home/ui/RunTag.tsx", "src/app/[locale]/calendar/page.tsx", "src/shared/ui/HeaderCta.tsx", "src/modules/appearance-notes/Note.tsx", "src/modules/designs/ui/X.tsx"]) {
      expect(refused(sourceOf(file, preset)), `${file} may not use the presets`).toHaveLength(1);
    }
  });

  it("finds no such read in src/ but where the tokens and the presets live", () => {
    expect(SOURCES.flatMap(refused), HOW).toEqual([]);
  });
});
