import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { presetCrop, ratioCrop } from "@/modules/content/rich-text/domain/picture-frame";
import { initialBibCrop } from "@/modules/content/events/ui/BibPictureField";
import { type BibDesign, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import { BIB_CARD, BIB_IMAGE, BIB_IMAGE_SCALE, BIB_LAYOUT, BIB_MARGIN } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import {
  BIB_PICTURE_BOX,
  BIB_PICTURE_RATIO,
  BIB_PICTURE_UNCROPPED,
  bibPictureDrawing,
} from "@/modules/registrations/bib-picture-frame";
import { bibPictureForImage, loadBibPictures } from "@/modules/registrations/bib-pictures";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";

/**
 * BR-REQ-038-01, §NNN (amending §249 and §485) — the bib designer's two picture places, each with
 * one fixed shape, and the one crop rule the sheet, the picture of one bib and the editor's
 * preview draw through.
 */

const OURS = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";

describe("§NNN the two places' fixed shapes", () => {
  it("are the paper's own boxes: the card's width by the band, the card less its inset by the sponsors' picture", () => {
    expect(BIB_PICTURE_BOX.header).toEqual({ width: BIB_CARD.width, height: BIB_LAYOUT.bandHeight });
    expect(BIB_PICTURE_BOX.sponsors).toEqual({ width: BIB_CARD.width - 2 * BIB_LAYOUT.inset, height: BIB_LAYOUT.sponsorPicture });
    // 559.28 × 62 and 523.28 × 24 points: about 9 to 1 and 22 to 1.
    expect(BIB_PICTURE_RATIO.header).toBeCloseTo(559.28 / 62, 4);
    expect(BIB_PICTURE_RATIO.sponsors).toBeCloseTo(523.28 / 24, 4);
    expect(Math.round(BIB_PICTURE_RATIO.header)).toBe(9);
    expect(Math.round(BIB_PICTURE_RATIO.sponsors)).toBe(22);
  });

  it("start a new picture at the shape's largest rectangle, in the middle", () => {
    const photo = { width: 2000, height: 1000 };
    const header = initialBibCrop("header", photo);
    expect(header).not.toBeNull();
    // The whole width, as tall as 9 : 1 allows, centred.
    expect(header?.w).toBe(1);
    expect((header!.w * photo.width) / (header!.h * photo.height)).toBeCloseTo(BIB_PICTURE_RATIO.header, 1);
    expect(header!.y + header!.h / 2).toBeCloseTo(0.5, 3);
    const sponsors = initialBibCrop("sponsors", photo);
    expect((sponsors!.w * photo.width) / (sponsors!.h * photo.height)).toBeCloseTo(BIB_PICTURE_RATIO.sponsors, 1);
    // No size, no crop: the crop box never draws over a picture it cannot measure (§241).
    expect(initialBibCrop("header", { width: 0, height: 0 })).toBeNull();
  });

  it("ratioCrop is presetCrop for any shape — the five presets answer the same as before", () => {
    const photo = { width: 4000, height: 3000 };
    expect(ratioCrop(16 / 9, photo)).toEqual(presetCrop("16:9", photo));
    expect(ratioCrop(1, photo)).toEqual(presetCrop("1:1", photo));
    // A photograph already of the shape needs no crop.
    expect(ratioCrop(4 / 3, photo)).toBeNull();
  });

  it("leaves a picture without a crop as every bib drew it: the header covers, the sponsors fit whole", () => {
    expect(BIB_PICTURE_UNCROPPED).toEqual({ header: "cover", sponsors: "fit" });
    expect(bibPictureDrawing("header", null, { width: 2000, height: 1000 })).toEqual({ kind: "cover" });
    expect(bibPictureDrawing("sponsors", null, { width: 2000, height: 1000 })).toEqual({ kind: "fit" });
  });
});

describe("§NNN the one crop rule", () => {
  it("fills the place's box with exactly the cropped part, undistorted", () => {
    const photo = { width: 2000, height: 1000 };
    const crop = ratioCrop(BIB_PICTURE_RATIO.header, photo)!;
    const box = BIB_PICTURE_BOX.header;
    const drawing = bibPictureDrawing("header", crop, photo);
    if (drawing.kind !== "crop") throw new Error("expected a crop");
    // The crop's left edge at the box's left, its width the box's width.
    expect(-drawing.left / drawing.width).toBeCloseTo(crop.x, 3);
    expect(box.width / drawing.width).toBeCloseTo(crop.w, 3);
    expect(-drawing.top / drawing.height).toBeCloseTo(crop.y, 3);
    expect(box.height / drawing.height).toBeCloseTo(crop.h, 2);
    // The picture keeps its own proportion: 2 : 1 drawn at 2 : 1.
    expect(drawing.width / drawing.height).toBeCloseTo(2, 2);
  });

  it("trims a crop of another shape to the place's shape rather than squashing it", () => {
    const photo = { width: 2000, height: 1000 };
    // A square in the middle: the band shows the widest 22 : 1 strip inside it, centred.
    const drawing = bibPictureDrawing("sponsors", { x: 0.25, y: 0, w: 0.5, h: 1 }, photo);
    if (drawing.kind !== "crop") throw new Error("expected a crop");
    expect(drawing.width / drawing.height).toBeCloseTo(2, 2);
    expect(-drawing.left / drawing.width).toBeCloseTo(0.25, 3);
  });

  it("scales to the renderer's own units — the same part in points on the paper and in pixels on the screen", () => {
    const photo = { width: 1600, height: 900 };
    const crop = { x: 0.1, y: 0.2, w: 0.8, h: 0.8 * (1600 / (900 * BIB_PICTURE_RATIO.header)) };
    const points = bibPictureDrawing("header", crop, photo);
    const pixels = bibPictureDrawing("header", crop, photo, {
      width: BIB_PICTURE_BOX.header.width * BIB_IMAGE_SCALE,
      height: BIB_PICTURE_BOX.header.height * BIB_IMAGE_SCALE,
    });
    if (points.kind !== "crop" || pixels.kind !== "crop") throw new Error("expected a crop");
    expect(pixels.width).toBeCloseTo(points.width * BIB_IMAGE_SCALE, 3);
    expect(pixels.left).toBeCloseTo(points.left * BIB_IMAGE_SCALE, 3);
    expect(pixels.top).toBeCloseTo(points.top * BIB_IMAGE_SCALE, 3);
  });

  it("takes the crop as stored when the picture's size is unknown", () => {
    const crop = { x: 0, y: 0.4, w: 1, h: 0.2 };
    const drawing = bibPictureDrawing("header", crop, null);
    if (drawing.kind !== "crop") throw new Error("expected a crop");
    expect(drawing.width).toBeCloseTo(BIB_PICTURE_BOX.header.width, 3);
    expect(drawing.height).toBeCloseTo(BIB_PICTURE_BOX.header.height / 0.2, 3);
  });
});

describe("§NNN the crop in the design", () => {
  it("reads a crop posted as JSON, stored as an object, and drops one that is malformed or whole", () => {
    const crop = { x: 0, y: 0.3, w: 1, h: 0.2 };
    expect(readBibDesign({ headerImageSrc: OURS, headerImageCrop: JSON.stringify(crop) }).headerImageCrop).toEqual(crop);
    expect(readBibDesign({ headerImageSrc: OURS, headerImageCrop: crop }).headerImageCrop).toEqual(crop);
    expect(readBibDesign({ headerImageSrc: OURS, headerImageCrop: "{not json" }).headerImageCrop).toBeNull();
    expect(readBibDesign({ headerImageSrc: OURS, headerImageCrop: { x: 0.9, y: 0, w: 0.5, h: 0.5 } }).headerImageCrop).toBeNull();
    // The whole photograph is no crop (§241): the sponsors' «Toată imaginea».
    expect(readBibDesign({ sponsorImageSrc: OURS, sponsorImageCrop: { x: 0, y: 0, w: 1, h: 1 } }).sponsorImageCrop).toBeNull();
    // A crop never outlives its picture.
    expect(readBibDesign({ headerImageSrc: null, headerImageCrop: crop }).headerImageCrop).toBeNull();
  });
});

/** A picture: the left half red, the right half blue — which side a crop kept is a pixel away. */
async function halves(width: number, height: number): Promise<string> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 3;
      if (x < width / 2) raw[at] = 255;
      else raw[at + 2] = 255;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function pixels(response: Response) {
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
  return (x: number, y: number) => {
    const at = (Math.round(y) * info.width + Math.round(x)) * info.channels;
    return { r: data[at], g: data[at + 1], b: data[at + 2] };
  };
}

const isRed = (p: { r: number; b: number }) => p.r > 180 && p.b < 80;
const isBlue = (p: { r: number; b: number }) => p.b > 180 && p.r < 80;

/**
 * The picture of one bib — what the preview route answers — with the header drawn through the
 * crop. `renderBibImage` takes the design as given, so a data URI stands in for the stored picture
 * (the route's schema accepts only this site's own, `bib-design.test.ts`), as the route's own
 * loader hands it over.
 */
type Size = { width: number; height: number };
const bib = (design: BibDesign, sizes: { header?: Size; sponsors?: Size }) =>
  renderBibImage({
    bibNumber: 7,
    registeredName: "Nume Prenume",
    eventTitle: "Crosul",
    eventDate: "",
    partners: [],
    replyTo: null,
    design,
    // What the route hands over (`bib-pictures.ts#loadBibPictures`): a PNG `next/og` reads, and its size.
    pictures: {
      header: design.headerImageSrc && sizes.header ? { src: design.headerImageSrc, ...sizes.header } : null,
      sponsors: design.sponsorImageSrc && sizes.sponsors ? { src: design.sponsorImageSrc, ...sizes.sponsors } : null,
    },
  });

describe("§NNN the preview draws the crop (pixels of the PNG)", () => {
  const px = (points: number) => points * BIB_IMAGE_SCALE;
  // The middle of the header strip, a quarter and three quarters across the card.
  const headerY = px(BIB_MARGIN + BIB_LAYOUT.bandHeight / 2);
  const left = px(BIB_MARGIN + BIB_CARD.width / 4);
  const right = px(BIB_MARGIN + (3 * BIB_CARD.width) / 4);

  it("without a crop the header covers from the middle: red at the left, blue at the right", async () => {
    const src = await halves(1000, 200);
    const at = await pixels(await bib({ ...DEFAULT_BIB_DESIGN, headerImageSrc: src }, { header: { width: 1000, height: 200 } }));
    expect(isRed(at(left, headerY))).toBe(true);
    expect(isBlue(at(right, headerY))).toBe(true);
  });

  it("with the right half cropped the whole header strip is blue", async () => {
    const src = await halves(1000, 200);
    const photo = { width: 1000, height: 200 };
    // The right half, in the header's shape: 500 pixels wide, 500 / 9.02 tall.
    const h = 500 / (200 * BIB_PICTURE_RATIO.header);
    const crop = { x: 0.5, y: (1 - h) / 2, w: 0.5, h };
    const response = await bib({ ...DEFAULT_BIB_DESIGN, headerImageSrc: src, headerImageCrop: crop }, { header: photo });
    expect(response.status).toBe(200);
    const at = await pixels(response);
    expect(isBlue(at(left, headerY))).toBe(true);
    expect(isBlue(at(right, headerY))).toBe(true);
  });

  it("the sponsors' band: the whole picture fitted without a crop, the cropped half filling it with one", async () => {
    const src = await halves(1000, 100);
    const photo = { width: 1000, height: 100 };
    // The band's picture sits above the one-line footer, at the foot of the card (`bib-geometry.ts`).
    const bandTop = BIB_MARGIN + BIB_CARD.height - BIB_LAYOUT.footerHeight - BIB_LAYOUT.sponsorHeight + BIB_LAYOUT.sponsorTop;
    const y = px(bandTop + BIB_LAYOUT.sponsorPicture / 2);
    const wide = { left: px(BIB_MARGIN + BIB_LAYOUT.inset + 20), right: px(BIB_MARGIN + BIB_CARD.width - BIB_LAYOUT.inset - 20) };

    // Fitted: a 10 : 1 picture is narrower than the 22 : 1 band, so its ends are the paper.
    const fitted = await pixels(await bib({ ...DEFAULT_BIB_DESIGN, sponsorImageSrc: src }, { sponsors: photo }));
    expect(isRed(fitted(wide.left, y)) || isBlue(fitted(wide.left, y))).toBe(false);
    expect(isRed(fitted(BIB_IMAGE.width / 2 - 20, y))).toBe(true);

    const h = 500 / (100 * BIB_PICTURE_RATIO.sponsors);
    const crop = { x: 0.5, y: (1 - h) / 2, w: 0.5, h };
    const cropped = await pixels(await bib({ ...DEFAULT_BIB_DESIGN, sponsorImageSrc: src, sponsorImageCrop: crop }, { sponsors: photo }));
    expect(isBlue(cropped(wide.left, y))).toBe(true);
    expect(isBlue(cropped(wide.right, y))).toBe(true);
  });
});

/** Every content stream of a PDF, inflated: the drawing operators are compressed in the file. */
function contentOf(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  let text = "";
  for (const match of raw.matchAll(/(?<![d])stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      text += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // A font or an image, not a content stream.
    }
  }
  return text;
}

describe("§NNN the sheet prints the same crop", () => {
  it("clips the header's box and draws the picture scaled so the crop fills it", async () => {
    const png = Buffer.from((await halves(1000, 200)).split(",")[1], "base64");
    const h = 500 / (200 * BIB_PICTURE_RATIO.header);
    const crop = { x: 0.5, y: (1 - h) / 2, w: 0.5, h };
    const pdf = await renderBibSheet({
      rows: [{ bibNumber: 1, registeredName: "Nume Prenume" }],
      eventTitle: "Crosul",
      eventDate: "",
      generatedAt: new Date("2026-09-29T12:00:00Z"),
      design: { ...DEFAULT_BIB_DESIGN, headerImageSrc: OURS, headerImageCrop: crop },
      pictures: { header: png },
    });
    const content = contentOf(pdf);
    // A clipping path, then the image at twice the box's width (the crop is half the picture).
    expect(content).toMatch(/\bW\s+n\b/);
    const widths = [...content.matchAll(/(-?[\d.]+)\s+0\s+0\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+cm/g)].map((m) => Number(m[1]));
    expect(widths.some((width) => Math.abs(width - BIB_PICTURE_BOX.header.width * 2) < 0.5)).toBe(true);

    // Without the crop, no clip and the picture covering the strip, as before.
    const plain = contentOf(
      await renderBibSheet({
        rows: [{ bibNumber: 1, registeredName: "Nume Prenume" }],
        eventTitle: "Crosul",
        eventDate: "",
        generatedAt: new Date("2026-09-29T12:00:00Z"),
        design: { ...DEFAULT_BIB_DESIGN, headerImageSrc: OURS },
        pictures: { header: png },
      }),
    );
    expect(plain).not.toMatch(/\bW\s+n\b/);
  });
});

describe("§NNN the stored WebP reaches both renderers as PNG", () => {
  /** A stored picture is WebP (§414): the left half red, the right half blue, 1000 × 200. */
  const webp = async () => {
    const png = Buffer.from((await halves(1000, 200)).split(",")[1], "base64");
    return sharp(png).webp({ lossless: true }).toBuffer();
  };
  const sheetWith = (header: Buffer) =>
    renderBibSheet({
      rows: [{ bibNumber: 1, registeredName: "Nume Prenume" }],
      eventTitle: "Crosul",
      eventDate: "",
      generatedAt: new Date("2026-09-29T12:00:00Z"),
      design: { ...DEFAULT_BIB_DESIGN, headerImageSrc: OURS },
      pictures: { header },
    });

  it("reads each place's picture as a PNG with its size, and a missing one as none", async () => {
    const bytes = await webp();
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      seen.push(String(input));
      return String(input).includes("missing") ? new Response(null, { status: 404 }) : new Response(new Uint8Array(bytes));
    });
    try {
      const loaded = await loadBibPictures({ headerImageSrc: OURS, sponsorImageSrc: OURS.replace("web.webp", "missing/web.webp") }, 600);
      expect(loaded.sponsors).toBeNull();
      expect(seen).toContain(OURS);
      // PNG's signature, and the picture no wider than asked, its proportion kept.
      expect([...(loaded.header?.png.subarray(0, 4) ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(loaded.header).toMatchObject({ width: 600, height: 120 });
      const image = bibPictureForImage(loaded.header);
      expect(image?.src.startsWith("data:image/png;base64,")).toBe(true);

      // pdfkit embeds the PNG — the WebP itself failed the whole sheet…
      expect((await sheetWith(loaded.header!.png)).toString("latin1")).toMatch(/\/Subtype \/Image/);
      await expect(sheetWith(bytes)).rejects.toThrow(/Unknown image format/);

      // …and `next/og` draws it: red at the left of the header, blue at the right.
      const at = await pixels(
        await renderBibImage({
          bibNumber: 7,
          registeredName: "Nume Prenume",
          eventTitle: "Crosul",
          eventDate: "",
          design: { ...DEFAULT_BIB_DESIGN, headerImageSrc: OURS },
          pictures: { header: image, sponsors: null },
        }),
      );
      const y = (BIB_MARGIN + BIB_LAYOUT.bandHeight / 2) * BIB_IMAGE_SCALE;
      expect(isRed(at((BIB_MARGIN + BIB_CARD.width / 4) * BIB_IMAGE_SCALE, y))).toBe(true);
      expect(isBlue(at((BIB_MARGIN + (3 * BIB_CARD.width) / 4) * BIB_IMAGE_SCALE, y))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
