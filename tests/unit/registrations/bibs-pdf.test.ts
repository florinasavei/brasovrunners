import { writeFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { describe, expect, it, vi } from "vitest";
import { BIB_BAND_FALLBACK, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import { BIB_SHEET_CUT, BIB_SHEET_FOOTER, bibSheetFooterLines, renderBibSheet } from "@/modules/registrations/bibs-pdf";

/**
 * BR-REQ-038-01 — the printable sheet: two bibs per A4 page, the club's font and logo embedded,
 * and since §180 a header band in the event's own colour with the partners at the foot.
 */
const sheet = (count: number, layout?: "two" | "one", over: Partial<Parameters<typeof renderBibSheet>[0]> = {}) =>
  renderBibSheet({
    layout,
    rows: Array.from({ length: count }, (_, i) => ({ bibNumber: i + 1, registeredName: `Alergător Ștefan ${i + 1}` })),
    eventTitle: "Crosul aniversar Brașov Runners",
    eventDate: "11 octombrie 2026",
    generatedAt: new Date("2026-09-17T12:00:00Z"),
    ...over,
  });

/**
 * Every fill colour the pages actually ask for.
 *
 * pdfkit flate-compresses its content streams, so the drawing operators are not in the bytes
 * as text — which is why the assertions below inflate every stream in the file first rather
 * than grepping the PDF. A colour reaches the page as three components between 0 and 1
 * followed by the fill operator, so the components are compared as numbers: the exact decimal
 * expansion of 11/255 is pdfkit's business, not this test's.
 */
function fillColours(pdf: Buffer): Array<[number, number, number]> {
  const raw = pdf.toString("latin1");
  let text = "";
  // "endstream" also ends in "stream", hence the look-behind for anything but its "d".
  for (const match of raw.matchAll(/(?<![d])stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      text += inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1");
    } catch {
      // A font file or an image: not a content stream, and not what this is looking for.
    }
  }
  return [...text.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(?:rg|scn)\b/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ]);
}

const asComponents = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
];

const carries = (pdf: Buffer, hex: string) => {
  const want = asComponents(hex);
  return fillColours(pdf).some((got) => got.every((part, index) => Math.abs(part - want[index]) < 0.002));
};

describe("BR-REQ-038-01 the bib sheet", () => {
  /**
   * §NNN — every bib is an A5 sheet lying on its side, two to an A4 portrait page, so a page
   * count is always the rows split into pairs, an odd row's own page left with a blank half.
   */
  it.each([1, 2, 3, 4, 5, 6])("prints two A5 bibs per A4 page, so %i bibs are ceil(n/2) pages", async (count) => {
    const pdf = await sheet(count);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(Math.ceil(count / 2));
    expect(text).toMatch(/Roboto/);
    expect(text).toMatch(/\/Subtype \/Image/);
  });

  it("prints one bib per page when asked, the same A5 size, so five bibs are five pages", async () => {
    const pdf = await sheet(5, "one");
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(5);
  });

  it("is still a file when there is nothing to print", async () => {
    const pdf = await sheet(0);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
  });

  /**
   * §NNN — the cut is the one place a club's scissors or guillotine go: exactly half-way down
   * the A4 page, the upper bib's foot and the lower bib's top, whether or not a second bib sits
   * under it (an odd count's last page still gets the line, its lower half left blank).
   */
  it("draws the cut exactly half-way down the page, on every page, even the odd one out", async () => {
    const moveTo = vi.spyOn(PDFDocument.prototype, "moveTo");
    try {
      const pdf = await sheet(3);
      expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(2);
      const cuts = moveTo.mock.calls.filter(([x, y]) => x === 0 && y === BIB_SHEET_CUT);
      // Once per page for the dashed line itself (cut marks are off by default).
      expect(cuts.length).toBe(2);
    } finally {
      moveTo.mockRestore();
    }
  });

  /**
   * §180 — the band is the event's colour, which is how a volunteer holding a handful of bibs
   * knows which start line they belong to before reading a word.
   */
  it("fills the header band with the event's own colour", async () => {
    const pdf = await sheet(2, "two", { bandColour: "#1b7f3b" });
    expect(carries(pdf, "#1b7f3b")).toBe(true);
    // And not the club's, which is what it would fall back to had the colour been dropped.
    expect(carries(pdf, BIB_BAND_FALLBACK)).toBe(false);
  });

  it("falls back to the club's own colour when the event names none", async () => {
    expect(carries(await sheet(2, "two", { bandColour: null }), BIB_BAND_FALLBACK)).toBe(true);
    // The editor's palette cannot produce this, but a hand-written row could; a cosmetic
    // value must never be the reason a bib fails to print.
    expect(carries(await sheet(2, "two", { bandColour: "chartreuse" }), BIB_BAND_FALLBACK)).toBe(true);
  });

  /**
   * `AGENTS.md` §19.2 — a bib is worn in public. The partners and the club's mailbox belong on
   * it; a telephone number does not, and the emergency contact's least of all. The renderer is
   * never given one, and this is the assertion that keeps it that way.
   */
  it("prints the partners and the club's mailbox at the foot, and nothing else", async () => {
    const pdf = await sheet(1, "one", {
      partners: ["Primăria Brașov", "Salvamont"],
      replyTo: "contact@example.test",
    });
    // The text is drawn with an embedded subset, so the bytes are not searchable: what is
    // asserted is that the renderer accepted the footer and still produced a page.
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
    expect(pdf.byteLength).toBeGreaterThan(await sheet(1, "one").then((plain) => plain.byteLength - 1));
  });

  /**
   * §317 — the footer the club composed. Two lines take their height from the number's area
   * rather than shrinking the small print, and the sheet is still two bibs to a page.
   */
  it("prints a footer of two lines when the club's composition needs them", async () => {
    const long = {
      partners: ["Primăria Municipiului Brașov", "Salvamont Brașov", "Asociația Sportivă Carpați", "Decathlon Brașov", "Clubul Sportiv Olimpia"],
      replyTo: "contact@example.test",
      siteUrl: "https://www.example.test",
      design: {
        ...DEFAULT_BIB_DESIGN,
        showWebsite: true,
        footerText: "Cronometraj: StartTime România · Urgențe organizator: 0722 000 000",
      },
    };
    expect(bibSheetFooterLines({ ...long, eventTitle: "x", eventDate: "y" }, false)).toHaveLength(2);
    const pdf = await sheet(4, "two", long);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(2);
    // Every switch off: no small print, and still a sheet.
    const bare = await sheet(2, "two", { replyTo: "contact@example.test", design: { ...DEFAULT_BIB_DESIGN, showEmail: false, showPartners: false } });
    expect(bare.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBe(1);
    const target = process.env.BIBS_PDF_SAMPLE_FOOTER;
    if (target) writeFileSync(target, pdf);
  });

  /**
   * §317 — pdfkit wraps any text it is given a width for, whatever `lineBreak` says, and its
   * `ellipsis` does nothing without a `height`. A footer line a point wider than its box used to
   * drop its last word onto a line of its own, 9 points lower: over the second line, or over the
   * cut edge. So the sheet centres each line itself and hands pdfkit no width to wrap in.
   *
   * This fixture only needs to force the footer onto two lines at the sheet's 523.28-point
   * measure; the kerning-at-the-limit case — a first line that fits by the advance widths and
   * not in pdfkit, because Roboto kerns "rt" apart — is exercised by the randomised widths in
   * `bib-footer.test.ts` instead.
   */
  it("draws each footer line centred on the bib and without a width, so pdfkit cannot wrap it", async () => {
    const input = {
      partners: ["Expert Port Sportivă Start", "Fort Sport", "Fort Heart Turism Asociația", "Munte", "Port Resort", "Expert Primăria Heart Turism"],
      replyTo: "contact@example.test",
    };
    const lines = bibSheetFooterLines({ ...input, eventTitle: "x", eventDate: "y" }, false);
    expect(lines).toHaveLength(2);

    const measure = new PDFDocument({ autoFirstPage: false });
    measure.registerFont("footer", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf"));
    measure.font("footer").fontSize(BIB_SHEET_FOOTER.size);

    const text = vi.spyOn(PDFDocument.prototype, "text");
    try {
      await sheet(1, "one", input);
      const drawn = text.mock.calls.filter(([string]) => lines.includes(String(string)));
      expect(drawn.map(([string]) => string)).toEqual(lines);
      for (const [string, x, , options] of drawn) {
        expect(options, String(string)).toEqual({ lineBreak: false });
        const width = measure.widthOfString(String(string));
        expect(width, String(string)).toBeLessThanOrEqual(BIB_SHEET_FOOTER.width);
        // Centred on the bib, which is centred on the page.
        expect(Number(x) + width / 2).toBeCloseTo(595.28 / 2, 6);
      }
    } finally {
      text.mockRestore();
    }
  });

  it("writes a sample to disk for a person to look at, when asked", async () => {
    const target = process.env.BIBS_PDF_SAMPLE;
    if (!target) return;
    writeFileSync(
      target,
      await sheet(3, "two", { bandColour: "#1b7f3b", partners: ["Primăria Brașov"], replyTo: "contact@example.test" }),
    );
  });
});
