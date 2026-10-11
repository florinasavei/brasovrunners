import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FILTER_FLAGS } from "@/modules/events/domain/listing-filter";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { STATUS_GLYPHS } from "@/shared/ui/status-glyphs";
import { isBackoffice } from "./guards-allowlist";
import { importFacts, SOURCES, type Source } from "./scan";

/**
 * §NNN, amending §694 and §521 — the backoffice's status chip and its own registry. The public table
 * (`modules/events/ui/glyphs.ts`, drawn by `GlyphChip`) keeps only the names public pages draw, so a
 * visitor never downloads a backoffice icon; `status-glyphs.ts` (drawn by `StatusChip`) holds the rest.
 * A tripwire, source-level like the other design tests: each table is held to its own surface, and a
 * name counts as drawn only where a file really draws it — a chip's `glyph` attribute, a `glyph`
 * property of an object typed by the registry's names, or the registry read by name — never because
 * the word appears in a comment or an unrelated string.
 */

/**
 * The names the public table still holds although only the backoffice's shop draws them, through
 * `GlyphChip`: the orders card and the product list (`src/modules/content/shop/ui/OrdersCard.tsx`,
 * `ProductList.tsx`, rendered by `/admin/shop` alone), which another change owns. They leave this list,
 * and the public table, when those two move to `StatusChip` (`orders` and `club` join `status-glyphs.ts`
 * then) — the test below fails the day the shop stops drawing one, so the list cannot rot.
 */
const PENDING_SHOP = ["visible", "hidden", "language", "orders", "club"];

/**
 * The names in both tables for good: the members' zone's order chip (`members-area/MembersShop.tsx`,
 * public) draws them through `GlyphChip`, and the backoffice's states draw them through `StatusChip`.
 * Each table imports its own icon file, so a visitor still downloads only the public table.
 */
const BOTH_SURFACES = ["done", "cancelled", "planned"];

/**
 * Public files under a backoffice prefix of the house's classifier (`isBackoffice`): the team page's
 * components a visitor renders (`/[locale]/team`). The rest of `content/team/` — the editors of the
 * team's page — stays backoffice, and so does `content/events/`, the event editor.
 */
const PUBLIC_UNDER_CONTENT: ReadonlySet<string> = new Set(
  ["TeamCanvas", "TeamCanvasBox", "TeamCanvasCard", "TeamMemberLinks", "TeamPhotoImage", "TeamLinkGlyph"].map((name) => `src/modules/content/team/ui/${name}.tsx`),
);

/** The registries themselves, which hold every name and draw none. */
const REGISTRY_FILES: Record<string, string> = { GLYPHS: "src/modules/events/ui/glyphs", STATUS_GLYPHS: "src/shared/ui/status-glyphs" };

/** The status chip itself, which reads its own registry: a backoffice primitive although it sits in `shared/ui/`. */
const STATUS_CHIP_FILE = "src/shared/ui/StatusChip";

/** The files a visitor's pages are made of: what the house classifier does not call backoffice, and neither a registry nor the status chip. */
const isPublicFile = (file: string): boolean =>
  (!isBackoffice(file) || PUBLIC_UNDER_CONTENT.has(file)) && ![...Object.values(REGISTRY_FILES), STATUS_CHIP_FILE].includes(file.replace(/\.tsx?$/, ""));

/** The elements whose `glyph` is a chip's name: not a Panel's or a button's, which have their own tables. */
const CHIP_ELEMENTS = new Set(["GlyphChip", "ChipLink", "StatusChip"]);
const REGISTRY_TYPE = /^(Status)?GlyphName$/;

/** An import's specifier as a repo-relative path without extension (`@/x` and `./x` both resolve). */
const resolveSpecifier = (file: string, specifier: string): string =>
  specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(file), specifier) : specifier;

/** `GLYPHS` / `STATUS_GLYPHS` as this file means them: imported from the registry, or the registry itself — never a local table of the same name. */
function registryTables(source: Source): Set<string> {
  const tables = new Set<string>();
  const facts = importFacts(source);
  for (const [name, module] of Object.entries(REGISTRY_FILES)) {
    if (source.file.replace(/\.tsx?$/, "") === module) tables.add(name);
    if (facts.some((fact) => !fact.typeOnly && fact.names.includes(name) && resolveSpecifier(source.file, fact.specifier) === module)) tables.add(name);
  }
  return tables;
}

/** The identifiers a type node names (`Pill | null` names `Pill`), read from the tree, so a comment never counts. */
function typeNames(type: ts.TypeNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isTypeReferenceNode(node)) names.add(ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text);
    ts.forEachChild(node, visit);
  };
  visit(type);
  return names;
}

/** The file's own types with a `glyph` member typed exactly by the registry's names (`type Pill = { glyph: GlyphName }`). */
function registryTypedAliases(source: Source): Set<string> {
  const aliases = new Set<string>();
  const hasRegistryGlyph = (members: ts.NodeArray<ts.TypeElement>) =>
    members.some(
      (member) => ts.isPropertySignature(member) && member.name.getText(source.tree) === "glyph" && member.type !== undefined && [...typeNames(member.type)].some((name) => REGISTRY_TYPE.test(name)),
    );
  const visit = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) && hasRegistryGlyph(node.type.members)) aliases.add(node.name.text);
    if (ts.isInterfaceDeclaration(node) && hasRegistryGlyph(node.members)) aliases.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return aliases;
}

/**
 * The type an object literal is declared with: a variable's annotation, a `satisfies` / `as`, or the
 * return type of the function it is returned from, through arrays, parentheses and a ternary's branches.
 */
function declaredType(node: ts.Node): ts.TypeNode | undefined {
  let current: ts.Node = node;
  for (let parent = node.parent; parent; current = parent, parent = parent.parent) {
    if (ts.isArrayLiteralExpression(parent) || ts.isParenthesizedExpression(parent)) continue;
    if (ts.isConditionalExpression(parent) && parent.condition !== current) continue;
    if (ts.isSatisfiesExpression(parent) || ts.isAsExpression(parent)) return parent.type;
    if (ts.isVariableDeclaration(parent)) return parent.initializer === current ? parent.type : undefined;
    if (ts.isArrowFunction(parent)) return parent.body === current ? parent.type : undefined;
    if (ts.isReturnStatement(parent)) return ts.findAncestor(parent, ts.isFunctionLike)?.type;
    return undefined;
  }
  return undefined;
}

/** The names a file really draws: `glyph="x"` on a chip, `GLYPHS.x` / `STATUS_GLYPHS["x"]`, a table or object typed by the registry's names. */
function drawn(source: Source): Set<string> {
  const names = new Set<string>();
  const tables = registryTables(source);
  const aliases = registryTypedAliases(source);
  const typedByRegistry = (type: ts.TypeNode | undefined) => type !== undefined && [...typeNames(type)].some((name) => REGISTRY_TYPE.test(name) || aliases.has(name));
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    // A table typed by the registry's names (`Record<…, StatusGlyphName>`): its values are names drawn by whoever reads it.
    if (ts.isVariableDeclaration(node) && node.initializer && node.type && [...typeNames(node.type)].some((name) => REGISTRY_TYPE.test(name))) collect(node.initializer);
    // `{ glyph: "x" }` counts only in an object declared with the registry's type (`const pill: Pill = …`, `): Pill {… return { glyph } }`).
    if (ts.isPropertyAssignment(node) && node.name.getText(source.tree) === "glyph" && typedByRegistry(declaredType(node.parent))) collect(node.initializer);
    // `<GlyphChip glyph={a ? "x" : "y"} />`: every literal inside the attribute is a name drawn, on a chip only.
    if (ts.isJsxAttribute(node) && node.name.getText(source.tree) === "glyph" && node.initializer) {
      const element = node.parent.parent;
      const tag = ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(source.tree) : "";
      if (CHIP_ELEMENTS.has(tag)) collect(node.initializer);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && tables.has(node.expression.text)) names.add(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && tables.has(node.expression.text) && ts.isStringLiteralLike(node.argumentExpression)) names.add(node.argumentExpression.text);
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return names;
}

/** The listing's switches reach the chip by a computed name (`glyph(group, value)` in `ListingFilterPanel`). */
const DYNAMIC_PUBLIC: readonly string[] = FILTER_FLAGS;

const usesStatusChip = (source: Source) => importFacts(source).some((fact) => resolveSpecifier(source.file, fact.specifier) === STATUS_CHIP_FILE);
const importsStatusRegistry = (source: Source) => importFacts(source).some((fact) => resolveSpecifier(source.file, fact.specifier) === REGISTRY_FILES.STATUS_GLYPHS);

/** Public files that draw the status chip or import its registry. */
const statusOffenders = (sources: Source[]): string[] =>
  sources
    .filter((source) => usesStatusChip(source) || importsStatusRegistry(source))
    .map((source) => source.file)
    .filter(isPublicFile);

/** Every name a public file draws. */
const publicNames = (sources: Source[]): Set<string> => new Set(sources.filter((source) => isPublicFile(source.file)).flatMap((source) => [...drawn(source)]));

/** A source made from text, parsed as `scan.ts` parses the real ones: the probes below plant regressions in it. */
const sourceOf = (file: string, text: string): Source => ({ file, text, tree: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) });

describe("§694 the status chip keeps the public glyph table public", () => {
  it("the two tables share no name, but the members' zone's and the shop's pending ones", () => {
    const shared = Object.keys(STATUS_GLYPHS).filter((name) => name in GLYPHS && !PENDING_SHOP.includes(name) && !BOTH_SURFACES.includes(name));
    expect(shared).toEqual([]);
    for (const name of BOTH_SURFACES) expect(name in GLYPHS && name in STATUS_GLYPHS, `${name} is listed in both surfaces but is not in both tables`).toBe(true);
  });

  it("no public file draws a status chip or imports its registry", () => {
    expect(statusOffenders(SOURCES)).toEqual([]);
  });

  it("every status name is drawn by a file that imports StatusChip", () => {
    const users = SOURCES.filter(usesStatusChip);
    const names = new Set(users.flatMap((source) => [...drawn(source)]));
    for (const name of Object.keys(STATUS_GLYPHS)) expect(names.has(name), `status glyph ${name} is drawn nowhere`).toBe(true);
  });

  it("every plain public name is drawn by a public file, bar the shop's pending ones", () => {
    const names = new Set([...publicNames(SOURCES), ...DYNAMIC_PUBLIC]);
    const plain = Object.keys(GLYPHS).filter((name) => !name.includes(":") && !PENDING_SHOP.includes(name));
    for (const name of plain) expect(names.has(name), `public glyph ${name} is drawn by no public file`).toBe(true);
  });

  it("the shop's pending names are still drawn by the backoffice's shop through GlyphChip, so the list is true", () => {
    const shop = SOURCES.filter((source) => source.file.startsWith("src/modules/content/shop/") && !usesStatusChip(source));
    const names = new Set(shop.flatMap((source) => [...drawn(source)]));
    for (const name of PENDING_SHOP) expect(names.has(name), `${name} is no longer drawn by the shop: drop it from PENDING_SHOP and the public table`).toBe(true);
  });

  it("today, a backoffice-only name (`series`) is in no public file and not in the public table", () => {
    expect(publicNames(SOURCES).has("series")).toBe(false);
    expect("series" in GLYPHS).toBe(false);
  });

  describe("the probes: a planted regression is caught", () => {
    it("a public file that draws a backoffice name through GlyphChip counts it as public", () => {
      const planted = sourceOf("src/modules/events/ui/X.tsx", `import GlyphChip from "@/modules/events/ui/GlyphChip";\nexport const X = () => <GlyphChip glyph="series" label="x" />;\n`);
      expect(isPublicFile(planted.file)).toBe(true);
      expect([...drawn(planted)]).toEqual(["series"]);
      expect(publicNames([planted]).has("series")).toBe(true);
    });

    it("a Panel's glyph, a comment and an untyped object are not draws", () => {
      const quiet = sourceOf(
        "src/modules/events/ui/X.tsx",
        [
          `import Panel from "@/shared/ui/Panel";`,
          `import { GLYPHS } from "@/modules/events/ui/glyphs";`,
          `// GLYPHS.series is the repeated event's count; a GlyphName: "series"`,
          `const config = { glyph: "series" };`,
          `export const X = () => <Panel glyph="series" title={config.glyph} />;`,
          ``,
        ].join("\n"),
      );
      expect([...drawn(quiet)]).toEqual([]);
    });

    it("a local table named GLYPHS is not the registry; the imported one is", () => {
      const local = sourceOf("src/modules/registrations/ui/X.tsx", `const GLYPHS = { series: null };\nexport const icon = GLYPHS.series;\n`);
      expect([...drawn(local)]).toEqual([]);
      const imported = sourceOf("src/modules/registrations/ui/X.tsx", `import { GLYPHS } from "@/modules/events/ui/glyphs";\nexport const icon = GLYPHS.series;\n`);
      expect([...drawn(imported)]).toEqual(["series"]);
    });

    it("an object typed by the registry's names counts, through the file's own alias", () => {
      const typed = sourceOf(
        "src/modules/events/ui/x.ts",
        [
          `import type { GlyphName } from "./glyphs";`,
          `type Pill = { glyph: GlyphName; label: string };`,
          `export function pill(on: boolean): Pill | null {`,
          `  return on ? { glyph: "night", label: "x" } : null;`,
          `}`,
          `export const other = { glyph: "series", label: "y" } satisfies { glyph: GlyphName; label: string };`,
          ``,
        ].join("\n"),
      );
      expect([...drawn(typed)].sort()).toEqual(["night", "series"]);
    });

    it("a members' zone file that imports StatusChip is an offender", () => {
      const planted = sourceOf("src/app/[locale]/members-area/X.tsx", `import StatusChip from "@/shared/ui/StatusChip";\nexport const X = () => <StatusChip glyph="done" label="x" />;\n`);
      expect(statusOffenders([planted])).toEqual(["src/app/[locale]/members-area/X.tsx"]);
    });

    it("the event editor and the team's editors are backoffice, the team's card is public", () => {
      expect(isPublicFile("src/modules/content/events/ui/boxes/StatusBox.tsx")).toBe(false);
      expect(isPublicFile("src/modules/content/team/ui/TeamPhotoField.tsx")).toBe(false);
      expect(isPublicFile("src/modules/content/team/ui/TeamCanvasCard.tsx")).toBe(true);
      const editor = sourceOf("src/modules/content/events/ui/boxes/StatusBox.tsx", `import StatusChip from "@/shared/ui/StatusChip";\nexport const X = () => <StatusChip glyph="series" label="x" />;\n`);
      expect(statusOffenders([editor])).toEqual([]);
    });

    it("a backoffice file drawing a name in neither table stays out of the public set", () => {
      const admin = sourceOf("src/app/[locale]/admin/x/page.tsx", `import GlyphChip from "@/modules/events/ui/GlyphChip";\nexport default function Page() { return <GlyphChip glyph="nowhere" label="x" />; }\n`);
      expect(drawn(admin).has("nowhere")).toBe(true);
      expect(publicNames([admin]).has("nowhere")).toBe(false);
      expect("nowhere" in GLYPHS || "nowhere" in STATUS_GLYPHS).toBe(false);
    });
  });
});
