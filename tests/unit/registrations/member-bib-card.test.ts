import { writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BIB_COLOURS } from "@/modules/content/events/ui/bib-colours";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import {
  BIB_MEMBER_CARD,
  type BibDesign,
  bibMemberCardBackground,
  bibMemberCardColourReadable,
  bibMemberStripeText,
  DEFAULT_BIB_DESIGN,
  DEFAULT_BIB_MEMBER_DESIGN,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import { BIB_CARD, BIB_IMAGE, BIB_LAYOUT, BIB_MARGIN } from "@/modules/registrations/bib-geometry";
import { renderBibImage } from "@/modules/registrations/bib-image";
import { BIB_PICTURE_BOX, BIB_PICTURE_RATIO } from "@/modules/registrations/bib-picture-frame";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { COLOR, GRADIENT } from "@/theme/brand";

/**
 * §NNN, BR-REQ-038-01 — a members' race number «Tot numărul»: the whole card above the small print
 * in the members' background (a photograph under the navy veil, a colour that carries white at AA, or
 * the kit's gradient), the words on it white, the label an orange stripe; the ordinary bib unchanged.
 */

const OURS = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
const PURPLE = BIB_COLOURS.find((choice) => choice.key === "purple")!.hex;
const card = (member: Partial<BibDesign["member"]> = {}): BibDesign => ({
  ...DEFAULT_BIB_DESIGN,
  member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, style: "card", ...member },
});

const sheet = (rows: Array<{ member?: boolean }>, design: BibDesign = card(), over: Partial<Parameters<typeof renderBibSheet>[0]> = {}) =>
  renderBibSheet({
    rows: rows.map((row, index) => ({ bibNumber: 101 + index, registeredName: `Alergător ${index + 1}`, member: row.member })),
    eventTitle: "Crosul Brașov Runners",
    eventDate: "21 noiembrie 2026",
    generatedAt: new Date("2026-10-10T12:00:00Z"),
    design,
    memberLabelDefault: "Membru Brașov Runners",
    ...over,
  });

/** The pages' inflated content streams (`bibs-pdf.test.ts` says why). */
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
      // Not a content stream.
    }
  }
  return text;
}

function fills(pdf: Buffer, hex: string): boolean {
  const want = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  return [...contentOf(pdf).matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(?:rg|scn)\b/g)].some((m) =>
    [m[1], m[2], m[3]].every((part, index) => Math.abs(Number(part) - want[index]) < 0.002),
  );
}

/** `top` over `under` at `alpha`, channel by channel in sRGB — how a PDF viewer and Satori composite. */
function over(top: string, under: string, alpha: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return `#${[1, 3, 5]
    .map((at) => Math.round(alpha * channel(top, at) + (1 - alpha) * channel(under, at)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** A light landscape for the photograph: a pale sky over grey mountains — the hardest case for white words. */
async function landscape(width = 1600, height = 1040): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfefff"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#s)"/>
    <path d="M0 ${height * 0.75} L${width * 0.22} ${height * 0.38} L${width * 0.38} ${height * 0.6} L${width * 0.58} ${height * 0.3} L${width * 0.8} ${height * 0.62} L${width} ${height * 0.45} L${width} ${height} L0 ${height} Z" fill="#7d8a96"/>
    <path d="M0 ${height * 0.88} L${width * 0.3} ${height * 0.7} L${width * 0.55} ${height * 0.82} L${width * 0.85} ${height * 0.68} L${width} ${height * 0.8} L${width} ${height} L0 ${height} Z" fill="#3f5a3a"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

afterEach(() => vi.restoreAllMocks());

describe("§NNN the members' style in the design", () => {
  it("reads a design saved before the style existed as the header alone, as it printed", () => {
    const saved = readBibDesign({ member: { enabled: true, bandColour: PURPLE, label: "BVR" } });
    expect(saved.member.style).toBe("band");
    expect(saved.member.cardImageSrc).toBeNull();
  });

  it("keeps the whole card, its photograph and its crop, and drops a crop without its photograph", () => {
    const crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.6 };
    const read = readBibDesign({ member: { enabled: true, style: "card", cardImageSrc: OURS, cardImageCrop: crop } });
    expect(read.member).toMatchObject({ style: "card", cardImageSrc: OURS, cardImageCrop: crop });
    expect(readBibDesign({ member: { enabled: true, style: "card", cardImageCrop: crop } }).member.cardImageCrop).toBeNull();
    // A style nobody defined, and a third party's photograph: the header alone, and no photograph.
    expect(readBibDesign({ member: { style: "poster", cardImageSrc: "https://evil.example/x/web.webp" } }).member).toMatchObject({
      style: "band",
      cardImageSrc: null,
    });
  });

  it("chooses the background in the order the club's choices win, never the event's own", () => {
    expect(bibMemberCardBackground(card().member, true)).toEqual({ kind: "picture" });
    expect(bibMemberCardBackground(card({ bandColour: PURPLE }).member, false)).toEqual({ kind: "colour", colour: PURPLE });
    expect(bibMemberCardBackground(card().member, false)).toEqual({ kind: "gradient", stops: [GRADIENT.deep, GRADIENT.mid] });
    // A colour white cannot be read on prints the club's gradient instead.
    for (const key of ["green", "orange"] as const) {
      const hex = BIB_COLOURS.find((choice) => choice.key === key)!.hex;
      expect(bibMemberCardBackground(card({ bandColour: hex }).member, false).kind).toBe("gradient");
    }
  });

  it("writes the stripe in capitals, the Romanian letters kept", () => {
    expect(bibMemberStripeText("Membru Brașov Runners")).toBe("MEMBRU BRAȘOV RUNNERS");
  });
});

describe("§NNN the number stays readable on every background (AA)", () => {
  it("takes every colour from the brand's tokens, none typed here", () => {
    expect(BIB_MEMBER_CARD.text).toBe(COLOR.surface);
    expect(BIB_MEMBER_CARD.stripe).toBe(COLOR.orange);
    expect(BIB_MEMBER_CARD.stripeText).toBe(COLOR.ink);
    expect(BIB_MEMBER_CARD.veil).toBe(GRADIENT.deep);
    expect(BIB_MEMBER_CARD.gradient).toEqual([GRADIENT.deep, GRADIENT.mid]);
  });

  it("white on both of the gradient's stops", () => {
    for (const stop of BIB_MEMBER_CARD.gradient) expect(contrastRatio(BIB_MEMBER_CARD.text, stop)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    // The kit's third stop, the cyan by the hem, would not carry it — which is why the card stops short of it.
    expect(contrastRatio(BIB_MEMBER_CARD.text, GRADIENT.light)).toBeLessThan(MIN_TEXT_CONTRAST);
  });

  it("white on every bib colour the whole card accepts, and most of them are accepted", () => {
    const accepted = BIB_COLOURS.filter((choice) => bibMemberCardColourReadable(choice.hex));
    for (const choice of accepted) expect(contrastRatio(BIB_MEMBER_CARD.text, choice.hex)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(accepted.map((choice) => choice.key).sort()).toEqual(["black", "purple", "red", "teal"]);
  });

  it("white over the veil on a pure-white photograph and a pure-black one", () => {
    for (const photograph of [COLOR.surface, "#000000"]) {
      const shown = over(BIB_MEMBER_CARD.veil, photograph, BIB_MEMBER_CARD.veilOpacity);
      expect(contrastRatio(BIB_MEMBER_CARD.text, shown)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it("the stripe's words on the stripe", () => {
    expect(contrastRatio(BIB_MEMBER_CARD.stripeText, BIB_MEMBER_CARD.stripe)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });
});

describe("§NNN the card's photograph has a place of its own", () => {
  it("is the card's width by its height less the small print's one line", () => {
    expect(BIB_PICTURE_BOX.memberCard).toEqual({ width: BIB_CARD.width, height: BIB_CARD.height - BIB_LAYOUT.footerHeight });
    expect(BIB_PICTURE_RATIO.memberCard).toBeCloseTo(1.54, 2);
  });
});

describe("§NNN the sheet", () => {
  it("draws a member's card in the members' colour, the stripe in orange, the label in capitals and no small tag", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const pdf = await sheet([{ member: true }], card({ bandColour: PURPLE }));
    expect(fills(pdf, PURPLE)).toBe(true);
    expect(fills(pdf, COLOR.orange)).toBe(true);
    const values = text.mock.calls.map(([value]) => String(value));
    expect(values).toContain("MEMBRU BRAȘOV RUNNERS");
    expect(values).not.toContain("Membru Brașov Runners");
  });

  it("draws the kit's gradient when the members chose no colour, and only on a member's bib", async () => {
    expect(pdfHasShading(await sheet([{ member: true }]))).toBe(true);
    expect(pdfHasShading(await sheet([{ member: false }]))).toBe(false);
    // The switch off: a row flagged a member prints the ordinary bib.
    expect(pdfHasShading(await sheet([{ member: true }], { ...card(), member: { ...card().member, enabled: false } }))).toBe(false);
  });

  it("draws the photograph clipped to the card under the veil, and a colour when it could not be fetched", async () => {
    const pdf = await sheet([{ member: true }], card({ cardImageSrc: OURS, bandColour: PURPLE }), { pictures: { memberCard: await landscape() } });
    expect(contentOf(pdf)).toMatch(/\bW\s+n\b/);
    expect(pdf.toString("latin1")).toMatch(/\/ca 0\.7\b/);
    expect(fills(pdf, PURPLE)).toBe(false);
    const missing = await sheet([{ member: true }], card({ cardImageSrc: OURS, bandColour: PURPLE }), { pictures: { memberCard: null } });
    expect(fills(missing, PURPLE)).toBe(true);
  });

  it("keeps the number's line where the ordinary bib has it, and the name above the stripe", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await sheet([{ member: false }, { member: true }]);
    const calls = text.mock.calls.map(([value, , y]) => ({ value: String(value), y: Number(y) }));
    const y = (value: string) => calls.find((call) => call.value === value)!.y;
    // Each the upper card of its own page (§681). The stripe's height comes out of the number's area,
    // so the member's number sits half of it higher — and never under the header.
    expect(y("101") - y("102")).toBeCloseTo(BIB_LAYOUT.memberStripeHeight / 2, 3);
    expect(y("102")).toBeGreaterThan(BIB_MARGIN + BIB_LAYOUT.bandHeight - 40);
    // The name sits a stripe higher, its letters clear of it.
    expect(y("Alergător 1") - y("Alergător 2")).toBeCloseTo(BIB_LAYOUT.memberStripeHeight, 3);
    const stripeTop = y("MEMBRU BRAȘOV RUNNERS") - (BIB_LAYOUT.memberStripeHeight - BIB_LAYOUT.memberStripeSize) / 2;
    expect(y("Alergător 2") + BIB_LAYOUT.nameSize).toBeLessThan(stripeTop + 4);
  });

  it("leaves the ordinary bib exactly as it was", async () => {
    const plain = await sheet([{ member: false }], DEFAULT_BIB_DESIGN);
    const beside = await sheet([{ member: false }], card({ bandColour: PURPLE }));
    expect(contentOf(beside)).toBe(contentOf(plain));
  });
});

/** A linear gradient in the file: pdfkit writes it as an axial shading. */
function pdfHasShading(pdf: Buffer): boolean {
  return /\/ShadingType 2\b/.test(pdf.toString("latin1"));
}

describe("§NNN the picture", () => {
  const draw = async (over: Partial<Parameters<typeof renderBibImage>[0]> = {}) =>
    Buffer.from(
      await (
        await renderBibImage({
          bibNumber: 101,
          registeredName: "Nume Prenume",
          eventTitle: "Crosul Brașov Runners",
          eventDate: "21 noiembrie 2026",
          design: card(),
          member: true,
          memberLabelDefault: "Membru Brașov Runners",
          pictures: {},
          ...over,
        })
      ).arrayBuffer(),
    );

  /** One pixel of a PNG as `#rrggbb`. */
  async function pixel(png: Buffer, x: number, y: number): Promise<string> {
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (Math.round(y) * info.width + Math.round(x)) * 3;
    return `#${[0, 1, 2].map((offset) => data[at + offset].toString(16).padStart(2, "0")).join("")}`;
  }

  it("fills the card with the background and paints the stripe, the small print on white", async () => {
    const png = await draw({ design: card({ bandColour: PURPLE }) });
    expect(png.readUInt32BE(16)).toBe(BIB_IMAGE.width);
    expect(png.readUInt32BE(20)).toBe(BIB_IMAGE.height);
    const scale = BIB_IMAGE.width / (BIB_CARD.width + 2 * BIB_MARGIN);
    // Just inside the card's top-left corner: the members' colour.
    expect(await pixel(png, (BIB_MARGIN + 4) * scale, (BIB_MARGIN + 4) * scale)).toBe(PURPLE);
    // Just above the small print, at the card's left edge: the stripe's orange.
    const footTop = BIB_MARGIN + BIB_CARD.height - BIB_LAYOUT.footerHeight;
    expect(await pixel(png, (BIB_MARGIN + 4) * scale, (footTop - 3) * scale)).toBe(COLOR.orange);
    // Inside the small print's strip, left of its words: the paper.
    expect(await pixel(png, (BIB_MARGIN + 4) * scale, (footTop + 3) * scale)).toBe(COLOR.surface);
  });

  it("draws the ordinary bib exactly as before whatever the members' style", async () => {
    const ordinary = await draw({ member: false, design: DEFAULT_BIB_DESIGN });
    expect((await draw({ member: false, design: card({ bandColour: PURPLE }) })).equals(ordinary)).toBe(true);
  });

  it("writes the three proposals to disk for a person to look at, when asked", async () => {
    const into = process.env.MEMBER_BIB_CARD_SAMPLES;
    if (!into) return;
    const photo = await landscape();
    const meta = await sharp(photo).metadata();
    const picture = { src: `data:image/png;base64,${photo.toString("base64")}`, width: meta.width!, height: meta.height! };
    writeFileSync(path.join(into, "member-bib-gradient.png"), await draw());
    writeFileSync(path.join(into, "member-bib-colour.png"), await draw({ design: card({ bandColour: PURPLE }) }));
    writeFileSync(path.join(into, "member-bib-photo.png"), await draw({ design: card({ cardImageSrc: OURS }), pictures: { memberCard: picture } }));
    writeFileSync(path.join(into, "member-bib-band-today.png"), await draw({ design: { ...card({ bandColour: PURPLE }), member: { ...card({ bandColour: PURPLE }).member, style: "band" } } }));
    writeFileSync(path.join(into, "ordinary-bib.png"), await draw({ member: false, design: DEFAULT_BIB_DESIGN }));
    writeFileSync(path.join(into, "member-bib-sheet.pdf"), await sheet([{ member: true }, { member: true }, { member: false }], card(), {}));
  });
});
