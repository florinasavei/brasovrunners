import { describe, expect, it } from "vitest";
import { ALLOWED, inPrimitiveScope, PINNED, PRIMITIVE_FILES } from "./guards-allowlist";
import { byFile, holdRatchet, importFacts, SOURCES } from "./scan";

/**
 * BR-REQ-041-01 criterion 6, BR-REQ-070-02, §694 — a button and a chip are the house's own.
 *
 * `ButtonLink` (a link that looks like a button), `GlyphButton` / `GlyphButtonLink` /
 * `GlyphSubmitButton` (a verb with its glyph), `SubmitButton` and `ConfirmSubmitButton` (a form's
 * send), `GlyphChip` and `ChipLink` (a state with its glyph) carry what a bare MUI `Button` does
 * not: the 44-pixel tap target, the glyph beside the words, the pending runner, the AA colours.
 * A page that imports `Button`, `IconButton` or `Chip` from MUI draws a button the design page
 * (`/admin/design`) does not show and the next page will not match.
 *
 * What it refuses, in `src/app/**` and every `src/modules/<area>/.../ui/**`: an import of `Button`,
 * `IconButton` or `Chip` from `@mui/material` (named), `@mui/material/Button` (default), a
 * namespace import, `export * from`, `export { default } from` or `import()` of either. The
 * primitives' own files, and `src/shared/`, where they are written, are not scanned. A genuinely
 * different control (a toolbar's toggle, a lightbox's close) is one line in the allowlist, with its
 * reason.
 *
 * A failure prints `file:line — the import`. The remedy for a button depends on the route:
 * backoffice, `GlyphButton` / `GlyphButtonLink` with a name from `action-icons.ts`; public,
 * `ButtonLink`, or `SubmitButton` with its public glyph named in `events/ui/glyphs.ts` — GlyphButton
 * ships the backoffice table and `action-icons.test.ts` refuses it on a public route. A chip is
 * `GlyphChip` on either.
 */
const GUARDED = new Set(["Button", "IconButton", "Chip"]);
const DEEP = /^@mui\/material\/(Button|IconButton|Chip)$/;

const offenders = byFile(
  SOURCES.filter((source) => inPrimitiveScope(source.file) && !PRIMITIVE_FILES.has(source.file)).flatMap((source) =>
    importFacts(source)
      .filter(
        (fact) =>
          !fact.typeOnly &&
          ((fact.specifier === "@mui/material" && fact.names.some((name) => name === "*" || GUARDED.has(name))) ||
            (DEEP.test(fact.specifier) && fact.names.some((name) => name === "default" || name === "*"))),
      )
      .map((fact) => ({ file: source.file, line: fact.line, text: `${fact.names.join(", ")} from ${fact.specifier}` })),
  ),
);

describe("§694 buttons and chips are the house primitives", () => {
  it("scopes pages and areas, not the primitives", () => {
    expect(inPrimitiveScope("src/app/[locale]/contact/page.tsx")).toBe(true);
    expect(inPrimitiveScope("src/modules/events/ui/EventCard.tsx")).toBe(true);
    expect(inPrimitiveScope("src/modules/content/team/ui/TeamPhotoField.tsx")).toBe(true);
    expect(inPrimitiveScope("src/shared/ui/ButtonLink.tsx")).toBe(false);
    expect(inPrimitiveScope("src/modules/events/service.ts")).toBe(false);
    for (const file of PRIMITIVE_FILES) expect(SOURCES.some((source) => source.file === file), file).toBe(true);
    expect(offenders.size).toBeGreaterThan(10);
  });

  it("imports no bare MUI Button, IconButton or Chip but the reviewed ones", () => {
    holdRatchet("primitives", offenders, ALLOWED.primitives, PINNED.primitives, "Backoffice: GlyphButton / GlyphChip by an action-icons name. Public: ButtonLink, or SubmitButton with a glyph named in events/ui/glyphs.ts; GlyphChip for a chip.");
  });
});
