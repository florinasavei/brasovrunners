import { describe, expect, it } from "vitest";
import { ALLOWED, isIconRegistry, PINNED } from "./guards-allowlist";
import { holdRatchet, importFacts, SOURCES } from "./scan";

/**
 * BR-REQ-060-01, BR-REQ-041-01, §318, §521, §694 — icons come from the registries, by name.
 *
 * One filled Material family, one picture per verb. A public page asks `src/modules/events/ui/
 * glyphs.ts` (and the module's own `…-glyphs.ts`, one per area); the backoffice asks
 * `src/shared/ui/action-icons.ts`, which never reaches a public route (`action-icons.test.ts`
 * walks the imports). A component that imports `@mui/icons-material/Save` itself is a second
 * answer to "what does saving look like", and the next person copies it.
 *
 * What it refuses: any import, re-export or `import()` from `@mui/icons-material` in a file that
 * is not a registry. A registry is `action-icons.ts`, `glyphs.ts` or a file whose name says it is
 * one (`section-glyphs.ts`, `branch-glyph.ts`, `TeamLinkGlyph.tsx` — a name-to-icon table beside
 * the area that uses it); `isIconRegistry` in `guards-allowlist.ts` is the one definition.
 *
 * To fix an offender: add the name to the right registry and ask for it (`icon="save"` on a
 * `GlyphButton`, `glyph="STAR"` on a `GlyphChip`); then remove the file from the allowlist.
 */
const offenders = new Set(
  SOURCES.filter((source) => !isIconRegistry(source.file))
    .filter((source) => importFacts(source).some((fact) => fact.specifier.startsWith("@mui/icons-material")))
    .map((source) => source.file),
);

describe("§694 icons come from the registries", () => {
  it("knows a registry when it sees one", () => {
    expect(isIconRegistry("src/shared/ui/action-icons.ts")).toBe(true);
    expect(isIconRegistry("src/modules/events/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/modules/weather/ui/glyphs.ts")).toBe(true);
    expect(isIconRegistry("src/shared/ui/SubmitButton.tsx")).toBe(false);
    expect(offenders.size).toBeGreaterThan(10);
  });

  it("has no direct icon import outside the registries but the reviewed ones", () => {
    holdRatchet("icons", offenders, ALLOWED.icons, PINNED.icons, "Name the glyph in a registry (action-icons.ts, or the area's glyphs.ts) and ask for it by name.");
  });
});
