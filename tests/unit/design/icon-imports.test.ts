import { describe, expect, it } from "vitest";
import { ALLOWED, isIconRegistry, PINNED } from "./guards-allowlist";
import { byFile, holdRatchet, importFacts, SOURCES } from "./scan";

/**
 * BR-REQ-060-01, BR-REQ-041-01, §318, §521, §NNN — icons come from the registries, by name.
 *
 * One filled Material family, one picture per verb. A public page asks `src/modules/events/ui/
 * glyphs.ts` (and the module's own `…-glyphs.ts`, one per area); the backoffice asks
 * `src/shared/ui/action-icons.ts`, which never reaches a public route (`action-icons.test.ts`
 * walks the imports). A component that imports `@mui/icons-material/Save` itself is a second
 * answer to "what does saving look like", and the next person copies it.
 *
 * What it refuses: any import, re-export or `import()` from `@mui/icons-material` in a file that
 * is not a registry. A registry is one of the files named in `ICON_REGISTRIES` in
 * `guards-allowlist.ts` — an explicit list, not a file-name pattern, so a new registry is a
 * reviewed edit of that file and a `FooGlyphCard.tsx` is not one by its name.
 *
 * A failure prints `file:line — the import`. To fix an offender: add the name to the right
 * registry and ask for it. In the backoffice, `icon="save"` on a `GlyphButton` or a glyph name on
 * a `GlyphChip` (the names are in `src/shared/ui/action-icons.ts`). On a public page, which never
 * reaches that table (`action-icons.test.ts`), `ButtonLink`, or `SubmitButton` with its public
 * glyph, with the glyph named in `src/modules/events/ui/glyphs.ts` or the area's own glyphs file.
 * Then remove the file from the allowlist.
 */
const offenders = byFile(
  SOURCES.filter((source) => !isIconRegistry(source.file)).flatMap((source) =>
    importFacts(source)
      .filter((fact) => fact.specifier.startsWith("@mui/icons-material"))
      .map((fact) => ({ file: source.file, line: fact.line, text: fact.specifier })),
  ),
);

describe("§NNN icons come from the registries", () => {
  it("knows a registry when it sees one", () => {
    expect(isIconRegistry("src/shared/ui/action-icons.ts")).toBe(true);
    expect(isIconRegistry("src/modules/events/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/modules/weather/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/shared/ui/SubmitButton.tsx")).toBe(false);
    expect(isIconRegistry("src/modules/content/events/ui/GlyphSelect.tsx")).toBe(false);
    expect(isIconRegistry("src/modules/events/ui/FooGlyphCard.tsx")).toBe(false);
    expect(offenders.size).toBeGreaterThan(10);
  });

  it("has no direct icon import outside the registries but the reviewed ones", () => {
    holdRatchet("icons", offenders, ALLOWED.icons, PINNED.icons, "Backoffice: name the glyph in action-icons.ts and ask a GlyphButton / GlyphChip for it by name. Public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts (the area's glyphs file).");
  });
});
