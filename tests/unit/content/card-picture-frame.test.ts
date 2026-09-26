import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CARD_FRAME_ASPECT,
  drawLocked,
  focalPoint,
  frameCrop,
  presetCrop,
  presetOf,
  PRESET_RATIOS,
  resizeLocked,
} from "@/modules/content/rich-text/domain/picture-frame";
import { parseRichText, type ImageCrop } from "@/modules/content/rich-text/domain/schema";
import RichText from "@/modules/content/rich-text/ui/RichText";
import EventExcerpt from "@/modules/events/ui/EventExcerpt";
import { CARD_FRAME_SX, cardCoverSx, cardFrameGeometry } from "@/modules/content/rich-text/ui/image-layout";

/**
 * BR-REQ-041-01, BR-REQ-050-03, `DECISIONS.md` §NNN — every listing card draws its picture in the
 * same 16∶9 frame around a focal point the club picks, and the crop box and the upload offer fixed
 * shapes. The owner, 2026-09-26, of a card whose portrait photograph stood twice as tall as its
 * neighbours': "this card looks different than the others… I need some predefined crops and sizes
 * for aspect ratios".
 */

/** A camera's landscape photograph, a phone's portrait one, and one already 16∶9. */
const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 3000, height: 4000 };
const WIDE = { width: 1920, height: 1080 };

/** The pixel ratio of a crop of `intrinsic`, width over height. */
const ratioOf = (crop: ImageCrop, intrinsic: { width: number; height: number }) =>
  (crop.w * intrinsic.width) / (crop.h * intrinsic.height);

const inside = (crop: ImageCrop) =>
  crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= 1.0001 && crop.y + crop.h <= 1.0001;

describe("§NNN the shapes the crop box and the upload offer", () => {
  it("draws the largest rectangle of the shape, centred, inside the photograph", () => {
    // 4000 × 3000 at 16∶9 keeps the whole width and 2250 of the 3000 pixels of height.
    expect(presetCrop("16:9", LANDSCAPE)).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75 });
    // A portrait photograph made square keeps its whole width.
    expect(presetCrop("1:1", PORTRAIT)).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75 });
    for (const preset of ["16:9", "4:3", "1:1", "4:5"] as const) {
      for (const picture of [LANDSCAPE, PORTRAIT, WIDE]) {
        const crop = presetCrop(preset, picture);
        if (!crop) continue;
        expect(inside(crop), `${preset} on ${picture.width}×${picture.height}`).toBe(true);
        expect(ratioOf(crop, picture)).toBeCloseTo(PRESET_RATIOS[preset], 2);
      }
    }
  });

  it("is no crop at all on a photograph that already has the shape", () => {
    // A rectangle covering the whole photograph is not a crop (§241's `meaningfulCrop`).
    expect(presetCrop("16:9", WIDE)).toBeNull();
    expect(presetCrop("4:3", LANDSCAPE)).toBeNull();
  });

  it("keeps the subject when the shape changes: centred on the crop already drawn, clamped to the edge", () => {
    const around = { x: 0.6, y: 0.1, w: 0.3, h: 0.3 };
    const square = presetCrop("1:1", LANDSCAPE, around)!;
    // The largest square in 4000 × 3000 is 3000 wide (0.75); centred on 0.75 it would end at
    // 1.125, so it is pulled back to the right edge.
    expect(square).toEqual({ x: 0.25, y: 0, w: 0.75, h: 1 });
  });

  it("recognises the shape a stored crop was drawn with, and «Liber» for anything else", () => {
    expect(presetOf(presetCrop("16:9", LANDSCAPE), LANDSCAPE)).toBe("16:9");
    expect(presetOf(presetCrop("4:5", LANDSCAPE), LANDSCAPE)).toBe("4:5");
    expect(presetOf(null, LANDSCAPE)).toBe("free");
    expect(presetOf({ x: 0, y: 0, w: 0.5, h: 0.9 }, LANDSCAPE)).toBe("free");
  });

  it("holds the shape while a rectangle is dragged, in every direction, and never past the edge", () => {
    for (const [from, to] of [
      [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.3 }],
      [{ x: 0.8, y: 0.8 }, { x: 0.1, y: 0.7 }],
      [{ x: 0.9, y: 0.1 }, { x: 1, y: 1 }],
      [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0 }],
    ] as const) {
      const crop = drawLocked(from, to, PRESET_RATIOS["16:9"], PORTRAIT);
      expect(inside(crop), JSON.stringify([from, to])).toBe(true);
      if (crop.w > 0) expect(ratioOf(crop, PORTRAIT)).toBeCloseTo(16 / 9, 5);
    }
  });

  it("holds the shape while the arrows resize it, inside the photograph", () => {
    const start = presetCrop("4:3", PORTRAIT)!;
    const grown = resizeLocked(start, 0.5, PRESET_RATIOS["4:3"], PORTRAIT);
    expect(inside(grown)).toBe(true);
    expect(ratioOf(grown, PORTRAIT)).toBeCloseTo(4 / 3, 2);
    const shrunk = resizeLocked(start, -0.2, PRESET_RATIOS["4:3"], PORTRAIT);
    expect(shrunk.w).toBeCloseTo(start.w - 0.2, 4);
    expect(ratioOf(shrunk, PORTRAIT)).toBeCloseTo(4 / 3, 2);
  });
});

describe("§NNN the listing card's frame", () => {
  it("is the same 16∶9 on every card, whatever the photograph", () => {
    for (const picture of [LANDSCAPE, PORTRAIT, WIDE]) {
      const frame = frameCrop(null, null, picture);
      expect(inside(frame)).toBe(true);
      expect(ratioOf(frame, picture)).toBeCloseTo(16 / 9, 2);
      expect(cardFrameGeometry({ ...picture, crop: null })?.geometry.aspectRatio).toBe("16 / 9");
    }
    expect(CARD_FRAME_ASPECT).toBe("16 / 9");
    expect(CARD_FRAME_SX.aspectRatio).toBe("16 / 9");
    expect(CARD_FRAME_SX.overflow).toBe("hidden");
    expect(CARD_FRAME_SX.width).toBe("100%");
  });

  it("centres on the middle of the photograph when nobody picked a point", () => {
    // A portrait photograph: the whole width, a band of 3000 × 1687.5 through the middle.
    const frame = frameCrop(null, null, PORTRAIT);
    expect(frame.x).toBe(0);
    expect(frame.w).toBe(1);
    expect(frame.y + frame.h / 2).toBeCloseTo(0.5, 3);
  });

  it("moves to the club's focal point, and stops at the photograph's edge", () => {
    // A face near the top of a portrait photograph: the band starts at the top.
    expect(frameCrop(null, { x: 0.5, y: 0.05 }, PORTRAIT).y).toBe(0);
    const lower = frameCrop(null, { x: 0.5, y: 0.6 }, PORTRAIT);
    expect(lower.y + lower.h / 2).toBeCloseTo(0.6, 3);
  });

  it("stays inside the organizer's crop, and a 16∶9 crop is its own frame", () => {
    const crop = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
    const frame = frameCrop(crop, { x: 0.95, y: 0.95 }, LANDSCAPE);
    expect(frame.x).toBeGreaterThanOrEqual(crop.x);
    expect(frame.y).toBeGreaterThanOrEqual(crop.y);
    expect(frame.x + frame.w).toBeLessThanOrEqual(crop.x + crop.w + 0.0001);
    expect(frame.y + frame.h).toBeLessThanOrEqual(crop.y + crop.h + 0.0001);
    const wide = presetCrop("16:9", LANDSCAPE)!;
    expect(frameCrop(wide, null, LANDSCAPE)).toEqual(wide);
    // With no point picked, the frame's centre is the crop's.
    expect(focalPoint(crop, null)).toEqual({ x: 0.4, y: 0.45 });
  });

  it("draws the frame with §241's window, magnified by the frame's own width", () => {
    const drawn = cardFrameGeometry({ ...PORTRAIT, crop: null, focus: { x: 0.5, y: 0 } })!;
    expect(drawn.geometry).toEqual({ aspectRatio: "16 / 9", width: "100%", left: "0%", top: "0%" });
    expect(drawn.magnify).toBe(1);
    const zoomed = cardFrameGeometry({ ...LANDSCAPE, crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } })!;
    expect(zoomed.magnify).toBeCloseTo(2, 4);
    expect(zoomed.geometry.left).toBe("-100%");
  });

  it("covers the frame at the focal point when the photograph's size was never stored", () => {
    expect(cardFrameGeometry({ width: null, height: null })).toBeNull();
    expect(cardCoverSx(null)).toMatchObject({ objectFit: "cover", objectPosition: "50% 50%", height: "100%" });
    expect(cardCoverSx({ x: 0.25, y: 0.1 }).objectPosition).toBe("25% 10%");
  });
});

describe("§NNN the focal point in the document", () => {
  const image = (focus: unknown) => ({
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "https://pictures.example/00000000-0000-4000-8000-000000000000/web.webp",
          width: 3000,
          height: 4000,
          ...(focus === undefined ? {} : { focus }),
        },
      },
    ],
  });

  it("is stored as two fractions, and absent stays absent", () => {
    expect(parseRichText(image({ x: 0.3, y: 0.2 })).content?.[0]).toMatchObject({ attrs: { focus: { x: 0.3, y: 0.2 } } });
    expect(parseRichText(image(null)).content?.[0]).toMatchObject({ attrs: { focus: null } });
    const before = parseRichText(image(undefined)).content?.[0] as { attrs: Record<string, unknown> };
    expect("focus" in before.attrs).toBe(false);
  });

  it("refuses a point off the photograph, or anything that is not two fractions", () => {
    for (const focus of [{ x: 1.2, y: 0 }, { x: -0.1, y: 0.5 }, { x: 0.5 }, { x: 0.5, y: 0.5, z: 1 }, "top"]) {
      expect(() => parseRichText(image(focus)), JSON.stringify(focus)).toThrow();
    }
  });
});

describe("§NNN the card draws the frame, the page does not", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src: "/api/media/aaaaaaaa-1111-2222-3333-444444444444/web.webp",
          alt: "Alergătoare la start",
          width: 3000,
          height: 4000,
          focus: { x: 0.5, y: 0.2 },
        },
      },
    ],
  };

  it("puts every card picture in the 16∶9 frame, and leaves the page's picture whole", () => {
    const card = renderToStaticMarkup(createElement(RichText, { body: doc, links: false, pictures: "card" }));
    expect(card).toContain('data-testid="card-picture"');
    expect(card).toContain('alt="Alergătoare la start"');
    const page = renderToStaticMarkup(createElement(RichText, { body: doc }));
    expect(page).not.toContain("card-picture");
    expect(page).toContain('height="4000"');
  });

  it("gives a portrait and a landscape photograph the same frame, the pull alone differing", () => {
    const shaped = (intrinsic: { width: number; height: number }) =>
      renderToStaticMarkup(
        createElement(RichText, {
          body: {
            type: "doc",
            content: [{ type: "image", attrs: { src: "/api/media/aaaaaaaa-1111-2222-3333-444444444444/web.webp", alt: "x", ...intrinsic } }],
          },
          links: false,
          pictures: "card",
        }),
      );
    const frameOf = (html: string) => /<style[^>]*>([^<]*aspect-ratio:[^<]*)<\/style><div class="rt-card-frame/.exec(html)?.[1] ?? "";
    const imageOf = (html: string) => /<style[^>]*>([^<]*position:absolute[^<]*)<\/style><img/.exec(html)?.[1] ?? "";
    const portrait = shaped(PORTRAIT);
    const landscape = shaped(LANDSCAPE);
    for (const html of [portrait, landscape]) {
      expect(html).toContain('data-testid="card-picture"');
      expect(frameOf(html)).toContain("aspect-ratio:16/9");
      expect(imageOf(html)).toContain("width:100%");
      expect(imageOf(html)).toContain("left:0%");
    }
    // The same frame, so the same box around the image: only where the photograph is pulled to differs.
    expect(frameOf(portrait).replace(/css-\w+/g, "")).toBe(frameOf(landscape).replace(/css-\w+/g, ""));
    const top = (html: string) => /top:(-?[\d.]+)%/.exec(imageOf(html))?.[1];
    expect(top(portrait)).not.toBe(top(landscape));
    expect(imageOf(portrait).replace(/top:[^;]+;|css-\w+/g, "")).toBe(imageOf(landscape).replace(/top:[^;]+;|css-\w+/g, ""));
  });

  it("frames the featured hero's summary too, and never the event page's", () => {
    const hero = renderToStaticMarkup(createElement(EventExcerpt, { excerptJson: doc, excerpt: null, place: "hero" }));
    expect(hero).toContain('data-testid="card-picture"');
    expect(hero).toContain("aspect-ratio:16/9");
    const page = renderToStaticMarkup(createElement(EventExcerpt, { excerptJson: doc, excerpt: null }));
    expect(page).not.toContain("card-picture");
    const heroSource = readFileSync(path.join(process.cwd(), "src", "modules", "events", "ui", "FeaturedEventHero.tsx"), "utf8");
    expect(heroSource).toContain('<EventExcerpt place="hero"');
  });

  it("is drawn by one function, shared with the editor's preview", () => {
    const source = (...where: string[]) => readFileSync(path.join(process.cwd(), ...where), "utf8");
    const renderer = source("src", "modules", "content", "rich-text", "ui", "RichText.tsx");
    const cropBox = source("src", "modules", "content", "rich-text", "ui", "ImageCropBox.tsx");
    for (const file of [renderer, cropBox]) {
      expect(file).toContain("cardFrameGeometry(");
      expect(file).toContain("CARD_FRAME_SX");
    }
    // The short description's editor is the one that shows the card's frame.
    const fields = source("src", "modules", "content", "events", "ui", "TranslationFields.tsx");
    expect(fields).toMatch(/cardPictures\s/);
  });
});
