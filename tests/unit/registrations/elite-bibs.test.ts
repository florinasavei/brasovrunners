import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ELITE_NAME_MAX } from "@/db/schema/event-elite-entries";
import { bibDesignSchema, DEFAULT_BIB_DESIGN, readBibDesign } from "@/modules/registrations/bib-design";
import { BIB_DESIGN_FORM_PREFIX, readBibDesignForm } from "@/modules/registrations/bib-design-query";
import { bibElite, bibEliteParts } from "@/modules/registrations/bib-elite";
import { BIB_CARD, BIB_IMAGE, BIB_LAYOUT, BIB_TEXT_LINE, bibNumberArea } from "@/modules/registrations/bib-geometry";
import { bibEliteElement, renderBibImage } from "@/modules/registrations/bib-image";
import { renderBibSheet } from "@/modules/registrations/bibs-pdf";

/**
 * «Elită — doar numele pe BIB» (§895; BR-REQ-038-01) — the owner, 2026-11-03: the race's elite runners printed as
 * named bibs, the NAME where the number usually is; the number only with «Număr pe BIB-urile de elită» ticked and a
 * number on the line, the sponsors' band only with «Banda de sponsori pe BIB-urile de elită» ticked; both ticks off
 * by default, so every stored design reads as it did. The sheet and the picture lay the name out through the one
 * geometry (`bib-geometry.ts#bibEliteLayout`), measured never narrower than either renderer sets it.
 */
const FONTS = path.join(process.cwd(), "src", "theme", "pdf");
const WIDTH = BIB_CARD.width - 2 * BIB_LAYOUT.inset;

/** pdfkit's own measure of a bold line at a size — what the paper sets. */
function boldWidth(text: string, size: number): number {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("bold", path.join(FONTS, "Roboto-Bold.ttf"));
  return doc.font("bold").fontSize(size).widthOfString(text);
}

const sheet = (over: Partial<Parameters<typeof renderBibSheet>[0]> = {}) =>
  renderBibSheet({
    rows: [],
    elite: [
      { name: "Eliud Kipchoge", bibNumber: 7 },
      { name: "Faith Kipyegon", bibNumber: null },
      { name: "Jakob Ingebrigtsen", bibNumber: 3 },
    ],
    eventTitle: "Crosul aniversar",
    eventDate: "21 noiembrie 2026",
    generatedAt: new Date("2026-11-03T12:00:00Z"),
    ...over,
  });

const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

/** The strings the sheet hands pdfkit's `text`, while `run` draws. */
async function drawnStrings(run: () => Promise<unknown>): Promise<string[]> {
  const text = vi.spyOn(PDFDocument.prototype, "text");
  try {
    await run();
    return text.mock.calls.map(([string]) => String(string));
  } finally {
    text.mockRestore();
  }
}

describe("§895 the two design ticks", () => {
  it("are off by default, and a design stored before them reads off and otherwise unchanged", () => {
    expect(DEFAULT_BIB_DESIGN.eliteNumber).toBe(false);
    expect(DEFAULT_BIB_DESIGN.eliteSponsors).toBe(false);
    const stored = { ...DEFAULT_BIB_DESIGN, numberScale: "large", numberStubs: true, showDistance: true } as Record<string, unknown>;
    delete stored.eliteNumber;
    delete stored.eliteSponsors;
    expect(readBibDesign(stored)).toEqual({ ...DEFAULT_BIB_DESIGN, numberScale: "large", numberStubs: true, showDistance: true });
    // The schema itself, as the save parses: an absent key and a nonsense value are both «off».
    const parsed = bibDesignSchema.parse(stored);
    expect([parsed.eliteNumber, parsed.eliteSponsors]).toEqual([false, false]);
    expect(readBibDesign({ ...DEFAULT_BIB_DESIGN, eliteNumber: "yes", eliteSponsors: 1 })).toMatchObject({ eliteNumber: false, eliteSponsors: false });
    expect(readBibDesign({ ...DEFAULT_BIB_DESIGN, eliteNumber: true, eliteSponsors: true })).toMatchObject({ eliteNumber: true, eliteSponsors: true });
  });

  it("are tick boxes on the form: ticked posts «on», unticked posts nothing", () => {
    const form = new FormData();
    form.set(`${BIB_DESIGN_FORM_PREFIX}eliteNumber`, "on");
    const values = readBibDesignForm((name) => {
      const value = form.get(name);
      return typeof value === "string" ? value : null;
    });
    expect([values.eliteNumber, values.eliteSponsors]).toEqual([true, false]);
  });

  it("decide the number, the sponsors' row and the stubs of an elite bib", () => {
    const off = { eliteNumber: false, eliteSponsors: false, numberStubs: true };
    expect(bibEliteParts(off, { bibNumber: 7 })).toEqual({ number: null, sponsors: false, stubs: false });
    // The number only when ticked AND the line has one.
    expect(bibEliteParts({ ...off, eliteNumber: true }, { bibNumber: 7 })).toEqual({ number: 7, sponsors: false, stubs: false });
    expect(bibEliteParts({ ...off, eliteNumber: true }, { bibNumber: null }).number).toBeNull();
    // The stubs only on a sponsors' row, with a number to repeat.
    expect(bibEliteParts({ ...off, eliteNumber: true, eliteSponsors: true }, { bibNumber: 7 })).toEqual({ number: 7, sponsors: true, stubs: true });
    expect(bibEliteParts({ ...off, eliteSponsors: true }, { bibNumber: 7 })).toEqual({ number: null, sponsors: true, stubs: false });
  });
});

describe("§895 the name where the number goes", () => {
  const area = bibNumberArea({ footer: BIB_LAYOUT.footerHeight, name: 0, sponsors: 0, stripe: 0, extras: 0 });

  it("fits any name on at most two lines, inside the card's width and the area's height, never cut", () => {
    const names = [
      "Ion",
      "Eliud Kipchoge",
      "Maria-Magdalena Ștefănescu-Popovici",
      // The longest a line may hold, one word and many.
      "W".repeat(ELITE_NAME_MAX),
      Array.from({ length: 16 }, (_, index) => `Nume${index}`).join(" ").slice(0, ELITE_NAME_MAX),
    ];
    for (const name of names) {
      for (const number of [false, true]) {
        const layout = bibElite(name, { area, scale: 1, number });
        expect(layout.lines.length, name).toBeGreaterThanOrEqual(1);
        expect(layout.lines.length, name).toBeLessThanOrEqual(2);
        // Never cut: every word is there, in order, and no «…».
        expect(layout.lines.map((line) => line.text).join(" "), name).toBe(name);
        for (const line of layout.lines) expect(boldWidth(line.text, layout.size), `${name}: ${line.text}`).toBeLessThanOrEqual(WIDTH + 1e-6);
        const foot = number && layout.number ? layout.number.top + BIB_TEXT_LINE * layout.number.size : layout.lines[layout.lines.length - 1].top + BIB_TEXT_LINE * layout.size;
        expect(layout.lines[0].top, name).toBeGreaterThanOrEqual(-1e-6);
        expect(foot, name).toBeLessThanOrEqual(area + 1e-6);
        expect(layout.number !== null, name).toBe(number);
      }
    }
  });

  it("draws a short name large, at the cap the club's scale sets, a usual one unbroken, and a long one on two lines rather than tiny", () => {
    expect(bibElite("Ion", { area, scale: 1, number: false }).size).toBe(BIB_LAYOUT.eliteNameMaxSize);
    expect(bibElite("Ion", { area, scale: 0.78, number: false }).size).toBeLessThanOrEqual(BIB_LAYOUT.eliteNameMaxSize * 0.78);
    // A name that reads at the one-line minimum stays on one line.
    const usual = bibElite("Eliud Kipchoge", { area, scale: 1, number: true });
    expect(usual.lines.map((line) => line.text)).toEqual(["Eliud Kipchoge"]);
    expect(usual.size).toBeGreaterThanOrEqual(BIB_LAYOUT.eliteNameOneLineMin);
    const long = bibElite("Maria-Magdalena Ștefănescu-Popovici", { area, scale: 1, number: false });
    expect(long.lines.map((line) => line.text)).toEqual(["Maria-Magdalena", "Ștefănescu-Popovici"]);
    expect(long.size).toBeGreaterThan(40);
  });
});

describe("§895 the elite sheet", () => {
  it("prints every elite line, two A5 bibs to an A4 page or one per page", async () => {
    expect(pages(await sheet())).toBe(2);
    expect(pages(await sheet({ layout: "one" }))).toBe(3);
    // Nothing on the list is still a file that says so.
    expect(pages(await sheet({ elite: [] }))).toBe(1);
  });

  it("draws the name in the number's place, no name line and no blank mark, and the number only when ticked and set", async () => {
    const moveTo = vi.spyOn(PDFDocument.prototype, "moveTo");
    let plain: string[];
    try {
      plain = await drawnStrings(() => sheet({ blankMark: "înscris la fața locului", design: { ...DEFAULT_BIB_DESIGN, showName: true } }));
      // No blank line where a spare's name goes.
      const lineLeft = (595.28 - BIB_LAYOUT.blankLineWidth) / 2;
      expect(moveTo.mock.calls.filter(([x]) => Math.abs(Number(x) - lineLeft) < 1e-6)).toHaveLength(0);
    } finally {
      moveTo.mockRestore();
    }
    for (const name of ["Eliud Kipchoge", "Faith Kipyegon", "Jakob Ingebrigtsen"]) expect(plain).toContain(name);
    expect(plain).not.toContain("înscris la fața locului");
    // Off by default: no number at all.
    expect(plain.filter((string) => /^\d+$/.test(string))).toEqual([]);

    const numbered = await drawnStrings(() => sheet({ design: { ...DEFAULT_BIB_DESIGN, eliteNumber: true, numberFormat: "pad3" } }));
    // Ticked: the two lines that have a number print it, in the event's way of writing it; the third prints none.
    expect(numbered.filter((string) => /^\d+$/.test(string))).toEqual(["007", "003"]);
  });

  it("prints the sponsors' band only when ticked", async () => {
    const sponsors = readFileSync(path.join(FONTS, "logo.png"));
    const design = { ...DEFAULT_BIB_DESIGN, showLogo: false, sponsorImageSrc: "/api/media/x/web.webp" };
    const image = vi.spyOn(PDFDocument.prototype, "image");
    try {
      await sheet({ design, pictures: { sponsors } });
      expect(image).not.toHaveBeenCalled();
      await sheet({ design: { ...design, eliteSponsors: true }, pictures: { sponsors } });
      expect(image).toHaveBeenCalledTimes(3);
    } finally {
      image.mockRestore();
    }
    // The same sheet's ordinary bibs keep their band whatever the elite tick says.
    const ordinary = vi.spyOn(PDFDocument.prototype, "image");
    try {
      await renderBibSheet({ rows: [{ bibNumber: 1, registeredName: "Ana Pop" }], eventTitle: "x", eventDate: "y", generatedAt: new Date(), design, pictures: { sponsors } });
      expect(ordinary).toHaveBeenCalledTimes(1);
    } finally {
      ordinary.mockRestore();
    }
  });

  it("writes a sample to disk for a person to look at, when asked", async () => {
    const target = process.env.ELITE_PDF_SAMPLE;
    if (!target) return;
    writeFileSync(target, await sheet({ design: { ...DEFAULT_BIB_DESIGN, eliteNumber: true }, bandColour: "#1b7f3b" }));
  });
});

describe("§895 the elite bib's picture", () => {
  it("draws the layout's lines at their tops, and the number only when the layout has one", () => {
    const area = 250;
    const withNumber = bibElite("Maria-Magdalena Ștefănescu-Popovici", { area, scale: 1, number: true });
    const html = renderToStaticMarkup(bibEliteElement(withNumber, "7", "#000000"));
    expect(html.match(/data-testid="bib-elite-name"/g)).toHaveLength(withNumber.lines.length);
    expect(html).toContain('data-testid="bib-elite-number"');
    for (const line of withNumber.lines) expect(html).toContain(line.text);
    const nameOnly = renderToStaticMarkup(bibEliteElement(bibElite("Eliud Kipchoge", { area, scale: 1, number: false }), "", "#000000"));
    expect(nameOnly).not.toContain("bib-elite-number");
  });

  it("renders as a PNG of the card's size, through the same renderer as every bib", async () => {
    const response = await renderBibImage({
      bibNumber: 7,
      registeredName: "Nume Prenume",
      eventTitle: "Crosul aniversar",
      eventDate: "21 noiembrie 2026",
      design: { ...DEFAULT_BIB_DESIGN, eliteNumber: true },
      elite: { name: "Maria-Magdalena Ștefănescu-Popovici", bibNumber: 7 },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.readUInt32BE(16)).toBe(BIB_IMAGE.width);
    expect(bytes.readUInt32BE(20)).toBe(BIB_IMAGE.height);
  });
});
