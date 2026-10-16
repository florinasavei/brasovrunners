import type { ReactElement } from "react";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type BibDesign,
  DEFAULT_BIB_DESIGN,
  DEFAULT_BIB_MEMBER_DESIGN,
  readBibDesign,
} from "@/modules/registrations/bib-design";
import {
  type BibDesignFormValues,
  bibDesignSearchParams,
  bibDesignValuesFromQuery,
} from "@/modules/registrations/bib-design-query";
import { bibMemberMarkElement, renderBibImage } from "@/modules/registrations/bib-image";
import { BIB_CARD, BIB_LAYOUT, bibNameReserve } from "@/modules/registrations/bib-geometry";
import {
  BIB_MEMBER_MARK_PATHS,
  BIB_MEMBER_MARK_VIEWBOX,
  BIB_MEMBER_MARKS,
  type BibMemberMark,
  bibMemberMarkBox,
  isVectorMark,
} from "@/modules/registrations/bib-member-mark";
import { BIB_DRAWING_VERSION, bibPictureStamp } from "@/modules/registrations/domain/bib-stamp";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";
import { drawnRuns } from "../../helpers/pdf-drawn";

/**
 * §750, amended §759, BR-REQ-038-01 — «Semn de membru pe număr» and «Semnul de membru»: a mark on every
 * member's number, only when ticked and only on a member's — a star by default, the club's logo, or a
 * registry glyph, each drawn from the one path `bib-member-mark.ts` holds by both renderers.
 * «Același fundal ca restul numerelor» is the members' header alone over the race's own background (the
 * `band` style), the default for a design saved before.
 */

const withMember = (member: Partial<BibDesign["member"]>): BibDesign => ({
  ...DEFAULT_BIB_DESIGN,
  member: { ...DEFAULT_BIB_MEMBER_DESIGN, enabled: true, ...member },
});

const SHEET = {
  eventTitle: "Crosul de toamnă",
  eventDate: "21 noiembrie 2026",
  generatedAt: new Date("2026-10-10T12:00:00Z"),
  memberLabelDefault: "Membru club",
};

/** What a sheet hands pdfkit's SVG path reader, and the images it places, call by call. */
async function drawnMarks(rows: Array<{ member?: boolean }>, design: BibDesign) {
  const paths: string[] = [];
  const images: Array<{ x: number; y: number; fit: unknown }> = [];
  const originalPath = PDFDocument.prototype.path;
  const originalImage = PDFDocument.prototype.image;
  vi.spyOn(PDFDocument.prototype, "path").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    paths.push(args[0] as string);
    return originalPath.call(this, args[0] as string);
  });
  vi.spyOn(PDFDocument.prototype, "image").mockImplementation(function (this: PDFKit.PDFDocument, ...args: unknown[]) {
    const options = args[3] as { fit?: unknown } | undefined;
    images.push({ x: args[1] as number, y: args[2] as number, fit: options?.fit });
    return (originalImage as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
  });
  await renderBibSheet({
    rows: rows.map((row, index) => ({ bibNumber: 101 + index, registeredName: `Alergător ${index + 1}`, member: row.member })),
    ...SHEET,
    design,
  });
  vi.restoreAllMocks();
  return { paths, images };
}

const picture = (design: BibDesign, member: boolean) =>
  renderBibImage({
    bibNumber: 101,
    registeredName: "Alergător Unu",
    eventTitle: SHEET.eventTitle,
    eventDate: SHEET.eventDate,
    bandColour: null,
    design,
    member,
    memberLabelDefault: SHEET.memberLabelDefault,
  }).then(async (response) => Buffer.from(await response.arrayBuffer()));

afterEach(() => vi.restoreAllMocks());

describe("§750 §759 the member mark in the design", () => {
  it("reads off for a design saved before, and on only as a boolean", () => {
    expect(readBibDesign({ member: { enabled: true } }).member.mark).toBe(false);
    expect(readBibDesign({ member: { enabled: true, mark: true } }).member.mark).toBe(true);
    expect(readBibDesign({ member: { enabled: true, mark: "yes" } }).member.mark).toBe(false);
    expect(DEFAULT_BIB_DESIGN.member.mark).toBe(false);
  });

  it("is a star by default — a design saved before the choice existed draws a star — and only a known mark is kept", () => {
    expect(DEFAULT_BIB_DESIGN.member.markShape).toBe("star");
    expect(readBibDesign({ member: { enabled: true, mark: true } }).member.markShape).toBe("star");
    for (const mark of BIB_MEMBER_MARKS) expect(readBibDesign({ member: { enabled: true, mark: true, markShape: mark } }).member.markShape).toBe(mark);
    expect(readBibDesign({ member: { enabled: true, mark: true, markShape: "skull" } }).member.markShape).toBe("star");
  });

  it("offers the star first, the club's logo, and four registry glyphs", () => {
    expect(BIB_MEMBER_MARKS).toEqual(["star", "logo", "heart", "bolt", "runner", "check"]);
    expect(isVectorMark("logo")).toBe(false);
    for (const mark of BIB_MEMBER_MARKS.filter(isVectorMark)) {
      // One SVG path each, in the 24-unit box, starting with a move.
      expect(BIB_MEMBER_MARK_PATHS[mark]).toMatch(/^[Mm]/);
    }
    expect(BIB_MEMBER_MARK_VIEWBOX).toBe(24);
  });

  it("an old design keeps the header-alone background it had", () => {
    expect(readBibDesign({ member: { enabled: true } }).member.style).toBe("band");
  });

  it("travels in the preview's address and back, with its shape, so the picture's cache key changes with it", () => {
    const base = withMember({ mark: false });
    const on: BibDesignFormValues = { ...base, member: { ...base.member, mark: true } };
    const heart: BibDesignFormValues = { ...base, member: { ...base.member, mark: true, markShape: "heart" } };
    expect(bibDesignSearchParams(base).toString()).not.toBe(bibDesignSearchParams(on).toString());
    expect(bibDesignSearchParams(on).toString()).not.toBe(bibDesignSearchParams(heart).toString());
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(on))).member.mark).toBe(true);
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(heart))).member.markShape).toBe("heart");
    expect(readBibDesign(bibDesignValuesFromQuery(bibDesignSearchParams(base))).member.mark).toBe(false);
    // Without the mark the shape is not in the address: the ordinary preview's address stays as it was.
    expect(bibDesignSearchParams(base).has("memberMarkShape")).toBe(false);
  });
});

describe("§759 the mark on the sheet: each choice through pdfkit's drawn paths", () => {
  it.each(BIB_MEMBER_MARKS.filter(isVectorMark))("%s: its own path, once per member's number when ticked", async (mark) => {
    const rows = [{ member: true }, { member: true }, { member: false }];
    const { paths } = await drawnMarks(rows, withMember({ mark: true, markShape: mark }));
    expect(paths.filter((d) => d === BIB_MEMBER_MARK_PATHS[mark])).toHaveLength(2);
    const off = await drawnMarks(rows, withMember({ mark: false, markShape: mark }));
    expect(off.paths).toHaveLength(0);
  });

  it("logo: the blue lockup placed in the mark's wider box, at the card's inset under the header, no path", async () => {
    const { paths, images } = await drawnMarks([{ member: true }, { member: false }], withMember({ mark: true, markShape: "logo" }));
    expect(paths).toHaveLength(0);
    const box = bibMemberMarkBox("logo");
    const placed = images.filter((image) => JSON.stringify(image.fit) === JSON.stringify([box.width, box.height]));
    expect(placed).toHaveLength(1);
    // The upper bib: its card starts at the 18-point margin.
    expect(placed[0].x).toBe(18 + BIB_LAYOUT.inset);
    expect(placed[0].y).toBe(18 + BIB_LAYOUT.bandHeight + BIB_LAYOUT.memberMarkTop);
    expect(box.height).toBe(BIB_LAYOUT.memberMarkSize);
    expect(box.width).toBeCloseTo(BIB_LAYOUT.memberMarkSize * BIB_LAYOUT.logoRatio, 1);
  });

  it("is never drawn on the ordinary numbers, or while the members' number is off", async () => {
    expect((await drawnMarks([{ member: false }, {}], withMember({ mark: true }))).paths).toHaveLength(0);
    expect((await drawnMarks([{ member: true }], withMember({ mark: true, enabled: false }))).paths).toHaveLength(0);
  });

  it("is drawn on the card style too", async () => {
    const { paths } = await drawnMarks([{ member: true }], withMember({ mark: true, style: "card" }));
    expect(paths).toEqual([BIB_MEMBER_MARK_PATHS.star]);
  });
});

describe("§759 the mark on the picture: the same path in the markup", () => {
  it.each(BIB_MEMBER_MARKS.filter(isVectorMark))("%s: an inline SVG in the 24-unit box with the sheet's path, in the ink given", (mark) => {
    const element = bibMemberMarkElement(mark, "#000001", null) as ReactElement<{ viewBox: string; "data-mark": string; children: ReactElement<{ d: string; fill: string }> }>;
    expect(element.type).toBe("svg");
    expect(element.props.viewBox).toBe("0 0 24 24");
    expect(element.props["data-mark"]).toBe(mark);
    expect(element.props.children.props.d).toBe(BIB_MEMBER_MARK_PATHS[mark]);
    expect(element.props.children.props.fill).toBe("#000001");
  });

  it("logo: the lockup's own picture in the wider box, never recoloured — no fill, no filter", () => {
    const element = bibMemberMarkElement("logo", "#000001", "data:image/png;base64,AAAA") as ReactElement<{ src: string; style: Record<string, unknown>; width: number; height: number }>;
    expect(element.type).toBe("img");
    expect(element.props.src).toBe("data:image/png;base64,AAAA");
    expect(element.props.style).not.toHaveProperty("filter");
    expect(element.props.width / element.props.height).toBeCloseTo(BIB_LAYOUT.logoRatio, 2);
    expect(bibMemberMarkElement("logo", "#000001", null)).toBeNull();
  });

  it("changes a member's picture only when ticked, never an ordinary one; each shape draws differently", async () => {
    const off = withMember({ mark: false });
    const star = withMember({ mark: true });
    const heart = withMember({ mark: true, markShape: "heart" });
    expect((await picture(star, true)).equals(await picture(off, true))).toBe(false);
    expect((await picture(star, true)).equals(await picture(heart, true))).toBe(false);
    expect((await picture(star, false)).equals(await picture(off, false))).toBe(true);
  });

  it("draws the logo on the picture", async () => {
    const off = withMember({ mark: false });
    const logo = withMember({ mark: true, markShape: "logo" });
    expect((await picture(logo, true)).equals(await picture(off, true))).toBe(false);
  });
});

describe("§750 the name above the number steps aside for the mark", () => {
  const LONG = "Alexandra-Maria Popescu-Ionescu Georgescu";

  const nameRun = async (design: BibDesign, member: boolean) => {
    const runs = await drawnRuns(() =>
      renderBibSheet({
        rows: [{ bibNumber: 101, registeredName: LONG, member }],
        ...SHEET,
        design,
      }),
    );
    const run = runs.find((r) => r.text === LONG);
    expect(run).toBeDefined();
    return run!;
  };

  it("starts the name's box past the mark's right edge, and keeps it centred", async () => {
    const above = { namePosition: "above" } as const;
    const plain = await nameRun({ ...withMember({ mark: false }), ...above }, true);
    const marked = await nameRun({ ...withMember({ mark: true }), ...above }, true);
    const reserve = marked.x! - plain.x!;
    expect(reserve).toBe(BIB_LAYOUT.memberMarkSize + BIB_LAYOUT.memberMarkGap);
    // The mark spans plain.x .. plain.x + memberMarkSize (both at the card's inset).
    expect(marked.x!).toBeGreaterThan(plain.x! + BIB_LAYOUT.memberMarkSize);
    expect(marked.width!).toBe(BIB_CARD.width - 2 * (BIB_LAYOUT.inset + reserve));
    expect(marked.x! + marked.width! + reserve).toBeCloseTo(plain.x! + plain.width!, 5);
  });

  it("steps further aside for the logo's wider box (§759)", async () => {
    const above = { namePosition: "above" } as const;
    const plain = await nameRun({ ...withMember({ mark: false }), ...above }, true);
    const logo = await nameRun({ ...withMember({ mark: true, markShape: "logo" }), ...above }, true);
    expect(logo.x! - plain.x!).toBeCloseTo(bibMemberMarkBox("logo").width + BIB_LAYOUT.memberMarkGap, 5);
  });

  it("leaves the name alone below the number, on an ordinary number, and with no mark", async () => {
    const below = await nameRun({ ...withMember({ mark: true }), namePosition: "below" }, true);
    const belowOff = await nameRun({ ...withMember({ mark: false }), namePosition: "below" }, true);
    expect(below.x).toBe(belowOff.x);
    const ordinary = await nameRun({ ...withMember({ mark: true }), namePosition: "above" }, false);
    const ordinaryOff = await nameRun({ ...withMember({ mark: false }), namePosition: "above" }, false);
    expect(ordinary.x).toBe(ordinaryOff.x);
    expect(bibNameReserve(null, true)).toBe(0);
    expect(bibNameReserve(BIB_LAYOUT.memberMarkSize, false)).toBe(0);
  });
});

describe("§750 §759 the picture's stamp follows the mark", () => {
  it("changes when the tick flips or the shape changes, so a cached picture is not served stale", () => {
    expect(bibPictureStamp([withMember({ mark: true })])).not.toBe(bibPictureStamp([withMember({ mark: false })]));
    const shapes = new Set<string>(BIB_MEMBER_MARKS.map((mark: BibMemberMark) => bibPictureStamp([withMember({ mark: true, markShape: mark })])));
    expect(shapes.size).toBe(BIB_MEMBER_MARKS.length);
  });

  it("is past drawing version 3, which made existing members' numbers draw a star where they drew a ring and a check", () => {
    // 4 since §804 (the strip drawn by the elevation core): every address stamped before it is a new one.
    expect(BIB_DRAWING_VERSION).toBeGreaterThanOrEqual(3);
  });
});
