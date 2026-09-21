import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { meaningfulCrop, parseRichText, WHOLE_IMAGE } from "@/modules/content/rich-text/domain/schema";
import { cropGeometry, cropImageCss, cropWindowCss } from "@/modules/content/rich-text/ui/image-layout";

/**
 * BR-REQ-050-03, `DECISIONS.md` §241 — the organizer draws the crop, and every surface that
 * shows the picture shows that rectangle.
 *
 * What was wrong: the editor showed the whole photograph, the listing card cut it to 180
 * pixels from the centre, and nobody could see the second thing while doing the first. The
 * crop is four fractions on the image node, and this is the arithmetic that turns them into
 * the window the page, the card and the editor all draw.
 */
describe("DECISIONS.md §241 — the crop the organizer drew", () => {
  const picture = { width: 1600, height: 900 };

  it("magnifies the photograph and pulls it to the chosen corner", () => {
    // Half the width and a quarter of the height, starting a quarter in and a tenth down.
    const geometry = cropGeometry({ x: 0.25, y: 0.1, w: 0.5, h: 0.25 }, picture);
    expect(geometry).toEqual({
      // 1600 × 0.5 wide by 900 × 0.25 high: the window keeps the rectangle's own shape.
      aspectRatio: "3.5556",
      // Twice the window's width, so the chosen half fills it.
      width: "200%",
      // A quarter of the photograph is a half of the window; the same for the tenth.
      left: "-50%",
      top: "-40%",
    });
  });

  it("is nothing at all when there is no crop", () => {
    expect(cropGeometry(null, picture)).toBeNull();
    // Every picture written before §241 parses to this, and renders the markup it always did.
    expect(cropGeometry(undefined, picture)).toBeNull();
  });

  it("refuses to draw a crop for a picture whose own size was never stored", () => {
    // The window is shaped from the photograph's ratio. Guessing it would put a band of
    // background under the picture, so such a picture is rendered whole instead.
    const crop = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(cropGeometry(crop, { width: null, height: 900 })).toBeNull();
    expect(cropGeometry(crop, { width: 1600, height: null })).toBeNull();
    expect(cropGeometry(crop, {})).toBeNull();
  });

  it("measures the crop in nothing but fractions, so 320 pixels and a card agree with a column", () => {
    const geometry = cropGeometry({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 }, picture);
    const css = `${cropWindowCss(geometry!)};${cropImageCss(geometry!)}`;
    expect(css).not.toMatch(/\d(px|vw|vh|rem|em)/);
    // The window hides what is outside the rectangle; the photograph inside it is free of the
    // margins and the ceiling the editor's and the card's own rules put on a plain picture.
    expect(cropWindowCss(geometry!)).toContain("overflow:hidden");
    expect(cropImageCss(geometry!)).toContain("max-width:none");
    expect(cropImageCss(geometry!)).toContain("margin:0");
  });

  it("reads a rectangle that covers the whole photograph as no crop at all", () => {
    // Dragging the box back out to the edges leaves the document as it was, rather than
    // storing `{0,0,1,1}` and making the editor, the card and the page each decide separately.
    expect(meaningfulCrop(WHOLE_IMAGE)).toBeNull();
    expect(meaningfulCrop({ x: 0, y: 0, w: 0.9995, h: 1 })).toBeNull();
    expect(meaningfulCrop({ x: 0, y: 0, w: 0.6, h: 1 })).toEqual({ x: 0, y: 0, w: 0.6, h: 1 });
  });

  const image = (crop: unknown) => ({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: { src: "https://pictures.example/00000000-0000-4000-8000-000000000000/web.webp", width: 1600, height: 900, crop },
      },
    ],
  });

  it("stores a crop that lies inside the picture", () => {
    const parsed = parseRichText(image({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }));
    expect(parsed.content?.[0]).toMatchObject({ attrs: { crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } } });
  });

  it("refuses a crop that hangs over the edge, or that is not four fractions", () => {
    // The editor cannot be trusted with this: it runs in somebody else's browser (§11.3). A
    // rectangle that runs off the picture renders as a band of background nobody can explain.
    for (const crop of [
      { x: 0.7, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.7, w: 0.5, h: 0.5 },
      { x: -0.1, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 0, h: 0.5 },
      { x: 0, y: 0, w: 0.5, h: 0.5, zoom: 2 },
      { x: 0, y: 0, w: 0.5 },
      "half",
    ]) {
      expect(() => parseRichText(image(crop)), JSON.stringify(crop)).toThrow();
    }
  });

  it("reads a picture written before §241 as one with no crop", () => {
    const parsed = parseRichText({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "https://pictures.example/00000000-0000-4000-8000-000000000000/web.webp", width: 1600, height: 900 },
        },
      ],
    });
    expect(parsed.content?.[0]).toMatchObject({ attrs: { crop: null } });
  });

  it("draws the same window in the editor as on the page", () => {
    // The whole point of §241 is that the two agree. They agree by sharing `cropGeometry` and
    // its two CSS rules; the regression is either surface growing a second copy of the maths.
    const source = (...where: string[]) => readFileSync(path.join(process.cwd(), ...where), "utf8");
    const editor = source("src", "modules", "content", "rich-text", "ui", "RichTextEditor.tsx");
    const renderer = source("src", "modules", "content", "rich-text", "ui", "RichText.tsx");
    expect(editor).toContain("cropWindowCss(crop)");
    expect(editor).toContain("cropImageCss(crop)");
    expect(renderer).toContain("cropWindowSx(crop)");
    expect(renderer).toContain("cropImageSx(crop)");
    for (const file of [editor, renderer]) expect(file).toContain("cropGeometry(");
  });
});
