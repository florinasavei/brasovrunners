import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_ALIGNMENTS } from "@/modules/content/rich-text/domain/schema";
import { imageCaptionSx, imageFigureSx } from "@/modules/content/rich-text/ui/image-layout";

/**
 * BR-REQ-050-03 criterion 10, `AGENTS.md` §11.3 — a picture the text flows around, and the
 * three places that rule is allowed to apply.
 *
 * This reverses `DECISIONS.md` §73 ("a block in the flow, never floated, so two pictures are
 * never side by side") after the owner asked for the opposite: "vreau sa pot seta imaginile ca
 * si «inline» ca sa pot scrie text in stanga sau dreapta lor". What §73 was right about is kept
 * here as three assertions — a phone never floats, two pictures never form a row, and a body
 * that floats nothing is styled exactly as it was.
 */
describe("DECISIONS.md §73 reversed — a picture the text flows around", () => {
  const band = { align: "block", widthPercent: 100 } as const;

  it("floats the figure only from `sm` up, so a 320-pixel column is the band it always was", () => {
    // The hard target in this codebase is 320 pixels. A third of it beside a paragraph is two
    // words a line, which is why the float is a media query and not a value.
    for (const align of ["left", "right"] as const) {
      const sx = imageFigureSx({ align, widthPercent: 50 }, true);
      expect(sx, align).toMatchObject({
        float: { xs: "none", sm: align },
        width: { xs: "100%", sm: "50%" },
        // Centred again below `sm`: no side gutter, and the auto margins that centre a band.
        mx: { xs: "auto", sm: 0 },
        [align === "left" ? "mr" : "ml"]: { xs: "auto", sm: 3 },
      });
    }
  });

  it("puts the gutter on the inner side only, so the picture still reaches the column's edge", () => {
    expect(imageFigureSx({ align: "left", widthPercent: 50 }, true)).not.toHaveProperty("ml");
    expect(imageFigureSx({ align: "right", widthPercent: 50 }, true)).not.toHaveProperty("mr");
  });

  it("never lets two pictures stand side by side", () => {
    // §72's "a page is text with pictures, not a layout" is the part that still holds: every
    // figure in a body that floats anything also clears, so the second picture drops below the
    // first rather than forming a row, and a band after a float is never pulled up beside it.
    for (const align of IMAGE_ALIGNMENTS) {
      expect(imageFigureSx({ align, widthPercent: 50 }, true), align).toMatchObject({
        clear: { xs: "none", sm: "both" },
      });
    }
  });

  it("styles a body that floats nothing exactly as it was styled before", () => {
    // Every document written before 2026-09-20, and every one where the organizer never
    // pressed left or right. Not "the new rules happen to be no-ops": they are absent.
    expect(imageFigureSx(band, false)).toStrictEqual({
      m: 0,
      my: 2,
      mx: "auto",
      width: { xs: "100%", sm: "100%" },
      maxWidth: "100%",
    });
    expect(imageCaptionSx(band)).toEqual({ mt: 1, textAlign: "center" });
  });

  it("keeps the width share the organizer chose, whatever side the picture is on", () => {
    // Two questions, two controls: answering "where" must not silently re-answer "how big".
    for (const widthPercent of [100, 75, 50, 33] as const) {
      expect(imageFigureSx({ align: "right", widthPercent }, true).width).toEqual({
        xs: "100%",
        sm: `${widthPercent}%`,
      });
    }
  });

  it("sets the caption against the same edge as the float, and centres it on a phone", () => {
    expect(imageCaptionSx({ align: "left" })).toEqual({ mt: 1, textAlign: { xs: "center", sm: "left" } });
    expect(imageCaptionSx({ align: "right" })).toEqual({ mt: 1, textAlign: { xs: "center", sm: "right" } });
  });

  it("clears the float at the end of the body, so it never reaches the page beneath", () => {
    // A float that runs past the last block would pull the registration panel, the programme
    // or the next section up beside the picture. The renderer emits one clearing element, and
    // only when the body floats something — the regression is that `floats` stops being read.
    const source = readFileSync(
      path.join(process.cwd(), "src", "modules", "content", "rich-text", "ui", "RichText.tsx"),
      "utf8",
    );
    expect(source).toContain('block.type === "image" && block.attrs.align !== "block"');
    expect(source).toContain('{floats && <Box sx={{ clear: "both" }} />}');
    expect(source).toContain("imageFigureSx(block.attrs, floats)");
  });
});
