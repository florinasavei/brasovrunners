import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A5 bibs (§NNN) — the bib's picture draws the paper's edge itself, 2 pixels in the line colour,
 * because a white A5 on a white page would otherwise not show where it ends. The screens that show
 * the picture must not frame it again: the editor's live preview and the desk's "show the bib" both
 * did, and read as a double line with its corners clipped by a rounded frame. One edge, the
 * picture's.
 */
const read = (file: string) => readFileSync(file, "utf8");

describe("§NNN one edge round a bib's picture", () => {
  it("is drawn by the picture", () => {
    const picture = read("src/modules/registrations/bib-image.tsx");
    expect(picture).toMatch(/const PAPER_EDGE = 2;/);
    expect(picture).toContain("border: `${PAPER_EDGE}px solid ${COLOR.line}`");
  });

  it("is not drawn again by the editor's preview", () => {
    const preview = read("src/modules/content/events/ui/BibDesignPreview.tsx");
    const img = preview.slice(preview.indexOf('component="img"'), preview.indexOf("/>", preview.indexOf('component="img"')));
    expect(img).toContain("sx={{");
    expect(img).not.toMatch(/\bborder\b/);
    expect(img).not.toMatch(/borderRadius/);
  });

  it("is not drawn again at the desk", () => {
    const desk = read("src/modules/registrations/ui/DeskRow.tsx");
    const start = desk.indexOf("bibs/preview?registration=");
    const img = desk.slice(start, desk.indexOf("/>", start));
    expect(img).toContain("style={{");
    expect(img).not.toMatch(/\bborder\b/);
    expect(img).not.toMatch(/borderRadius/);
  });
});
