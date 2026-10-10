import { describe, expect, it } from "vitest";
import { ALLOWED, isBackoffice, isIconRegistry, PINNED } from "./guards-allowlist";
import { byFile, holdRatchet, importFacts, SOURCES } from "./scan";

/**
 * BR-REQ-060-01, BR-REQ-041-01, §318, §521, §NNN — icons come from the registries, by name.
 *
 * One filled Material family, one picture per verb. The backoffice asks `src/shared/ui/action-icons.ts`
 * by name (`icon="save"` on a `GlyphButton`, a glyph name on a `GlyphChip`); that table never reaches
 * a public route (`action-icons.test.ts` walks the imports). A public page, by the house rule
 * (`GlyphButton`'s doc, §318, §521), imports its ONE icon file directly — `@mui/icons-material/Save`
 * — so the registry's table stays out of the visitor's bundle; the public registries
 * (`src/modules/events/ui/glyphs.ts` and the areas' own `…-glyphs.ts`) are for what a name can say.
 *
 * Two rules, so:
 *
 * 1. Nowhere but a registry: the barrel. `import { Save } from "@mui/icons-material"` (also an
 *    `export … from` and an `import()`) pulls every icon of the family into the bundle (§90). Never
 *    allowlisted: there is none today and there is none to add.
 * 2. In a backoffice file (`isBackoffice` in `guards-allowlist.ts`): not even one icon file. Ask
 *    `action-icons.ts` by name; add the name there if the verb has none. Today's exceptions are the
 *    allowlist's, each with a count, and the list only shrinks (the ratchet, `scan.ts`). A public
 *    file is never listed: a single-file import there is the rule, not a defect.
 *
 * A registry is one of the files named in `ICON_REGISTRIES` in `guards-allowlist.ts` — an explicit
 * list, not a file-name pattern, so a new registry is a reviewed edit of that file and a
 * `FooGlyphCard.tsx` is not one by its name. A failure prints `file:line — the import`.
 */
const facts = SOURCES.filter((source) => !isIconRegistry(source.file)).flatMap((source) =>
  importFacts(source)
    .filter((fact) => fact.specifier.startsWith("@mui/icons-material"))
    .map((fact) => ({ file: source.file, line: fact.line, text: fact.specifier })),
);

const barrel = facts.filter((fact) => fact.text === "@mui/icons-material");
const offenders = byFile(facts.filter((fact) => fact.text !== "@mui/icons-material" && isBackoffice(fact.file)));

describe("§NNN icons come from the registries", () => {
  it("knows a registry and a backoffice file when it sees one", () => {
    expect(isIconRegistry("src/shared/ui/action-icons.ts")).toBe(true);
    expect(isIconRegistry("src/modules/events/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/modules/weather/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/shared/ui/SubmitButton.tsx")).toBe(false);
    expect(isIconRegistry("src/modules/content/events/ui/GlyphSelect.tsx")).toBe(false);
    expect(isIconRegistry("src/modules/events/ui/FooGlyphCard.tsx")).toBe(false);
    expect(isBackoffice("src/app/[locale]/admin/tasks/page.tsx")).toBe(true);
    expect(isBackoffice("src/modules/design/ui/ButtonSection.tsx")).toBe(true);
    expect(isBackoffice("src/modules/registrations/ui/DeskRow.tsx")).toBe(true);
    expect(isBackoffice("src/app/[locale]/contact/page.tsx")).toBe(false);
    expect(isBackoffice("src/modules/registrations/ui/EmailTwice.tsx")).toBe(false);
    expect(facts.length).toBeGreaterThan(100);
  });

  it("imports no icon from the barrel", () => {
    expect(barrel.map((fact) => `${fact.file}:${fact.line} — ${fact.text}`), "one file per glyph, never the barrel (§90)").toEqual([]);
  });

  it("has no direct icon import in a backoffice file but the reviewed ones", () => {
    holdRatchet("icons", offenders, ALLOWED.icons, PINNED.icons, "Backoffice: name the glyph in action-icons.ts and ask a GlyphButton / GlyphChip (or `ACTION_ICONS.<name>`) for it by name.");
  });
});
