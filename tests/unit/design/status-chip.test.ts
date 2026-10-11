import ts from "typescript";
import { describe, expect, it } from "vitest";
import { FILTER_FLAGS } from "@/modules/events/domain/listing-filter";
import { GLYPHS } from "@/modules/events/ui/glyphs";
import { STATUS_GLYPHS } from "@/shared/ui/status-glyphs";
import { SOURCES, stringLiterals, type Source } from "./scan";

/**
 * §NNN, amending §694 and §521 — the backoffice's status chip and its own registry. The public table
 * (`modules/events/ui/glyphs.ts`, drawn by `GlyphChip`) keeps only the names public pages draw, so a
 * visitor never downloads a backoffice icon; `status-glyphs.ts` (drawn by `StatusChip`) holds the rest.
 * A tripwire, source-level like the other design tests: each table is held to its own surface, and a
 * name counts as drawn only where a file really draws it — a `glyph` attribute or property, or
 * `GLYPHS.<name>` — never because the word appears in a comment or an unrelated string.
 */

/**
 * The names the public table still holds although only the shop's files draw them, through `GlyphChip`:
 * the members' zone's order chip, the orders card and the product list (`src/app/[locale]/members-area/`,
 * `src/modules/content/shop/`), which another change owns. They leave this list, and the public table,
 * when those chips move to `StatusChip` — the test below fails the day they do, so the list cannot rot.
 */
const PENDING_SHOP = ["done", "cancelled", "planned", "visible", "hidden", "language", "orders", "club"];

const BACKOFFICE_PREFIXES = [
  "src/app/[locale]/admin/",
  "src/app/[locale]/members-area/",
  "src/app/[locale]/preview/",
  "src/modules/design/",
  "src/modules/staff-identity/",
  "src/modules/content/shop/",
  "src/modules/content/member-codes/",
  "src/modules/content/pages/",
  "src/modules/content/menu/",
  "src/modules/content/faq/",
  "src/modules/content/gallery/",
  "src/modules/content/rich-text/",
  "src/modules/content/members/",
];

/** The files a visitor's pages are made of: everything that is not listed backoffice, and not a registry. */
const isPublicFile = (file: string): boolean => !BACKOFFICE_PREFIXES.some((prefix) => file.startsWith(prefix)) && !file.endsWith("/glyphs.ts");

/** The names a file really draws: `glyph="x"` / `glyph: "x"`, `GLYPHS.x`, `GLYPHS["x"]`. */
function drawn(source: Source): Set<string> {
  const names = new Set<string>();
  for (const literal of stringLiterals(source)) if (literal.name === "glyph") names.add(literal.text);
  const collect = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) names.add(node.text);
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node) => {
    // A table typed by the glyph names (`Record<…, StatusGlyphName>`): its values are names drawn by whoever reads it.
    if (ts.isVariableDeclaration(node) && node.initializer && node.type?.getText(source.tree).includes("GlyphName")) collect(node.initializer);
    // `glyph={a ? "x" : "y"}`: every literal inside the attribute's expression is a name drawn.
    if (ts.isJsxAttribute(node) && node.name.getText(source.tree) === "glyph" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) collect(node.initializer.expression);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && /GLYPHS$/.test(node.expression.text)) names.add(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && /GLYPHS$/.test(node.expression.text) && ts.isStringLiteralLike(node.argumentExpression)) names.add(node.argumentExpression.text);
    ts.forEachChild(node, visit);
  };
  visit(source.tree);
  return names;
}

/** The listing's switches reach the chip by a computed name (`glyph(group, value)` in `ListingFilterPanel`). */
const DYNAMIC_PUBLIC: readonly string[] = FILTER_FLAGS;

const usesStatusChip = (source: Source) => /from "@\/shared\/ui\/StatusChip"/.test(source.text);

describe("§694 the status chip keeps the public glyph table public", () => {
  it("the two tables share no name, but the shop's pending ones", () => {
    const shared = Object.keys(STATUS_GLYPHS).filter((name) => name in GLYPHS && !PENDING_SHOP.includes(name));
    expect(shared).toEqual([]);
  });

  it("no public file draws a status chip", () => {
    const offenders = SOURCES.filter(usesStatusChip)
      .map((source) => source.file)
      .filter(isPublicFile);
    expect(offenders).toEqual([]);
  });

  it("every status name is drawn by a file that imports StatusChip", () => {
    const users = SOURCES.filter(usesStatusChip);
    const names = new Set(users.flatMap((source) => [...drawn(source)]));
    for (const name of Object.keys(STATUS_GLYPHS)) expect(names.has(name), `status glyph ${name} is drawn nowhere`).toBe(true);
  });

  it("every plain public name is drawn by a public file, bar the shop's pending ones", () => {
    const names = new Set([...SOURCES.filter((source) => isPublicFile(source.file)).flatMap((source) => [...drawn(source)]), ...DYNAMIC_PUBLIC]);
    const plain = Object.keys(GLYPHS).filter((name) => !name.includes(":") && !PENDING_SHOP.includes(name));
    for (const name of plain) expect(names.has(name), `public glyph ${name} is drawn by no public file`).toBe(true);
  });

  it("the shop's pending names are still drawn by the shop through GlyphChip, so the list is true", () => {
    const shop = SOURCES.filter((source) => source.file.startsWith("src/modules/content/shop/") || source.file.startsWith("src/app/[locale]/members-area/"));
    const names = new Set(shop.filter((source) => !usesStatusChip(source)).flatMap((source) => [...drawn(source)]));
    for (const name of PENDING_SHOP) expect(names.has(name), `${name} is no longer drawn by the shop: drop it from PENDING_SHOP and the public table`).toBe(true);
  });

  it("a backoffice-only name is caught: `series` is in no public file", () => {
    const publicNames = new Set(SOURCES.filter((source) => isPublicFile(source.file)).flatMap((source) => [...drawn(source)]));
    expect(publicNames.has("series")).toBe(false);
    expect("series" in GLYPHS).toBe(false);
  });
});
