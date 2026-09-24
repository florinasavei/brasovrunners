import path from "node:path";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { type BibDesign, DEFAULT_BIB_DESIGN } from "@/modules/registrations/bib-design";
import {
  BIB_FOOTER_ADVANCES,
  BIB_FOOTER_EMS,
  BIB_FOOTER_KERNING,
  BIB_FOOTER_MAX_LINES,
  BIB_FOOTER_SEPARATOR,
  BIB_FOOTER_TEXT_MAX,
  bibFooterLines,
  bibFooterParts,
  bibFooterText,
  bibFooterWidth,
  bibWebsiteHost,
} from "@/modules/registrations/bib-footer";
import { BIB_FOOTER_LINE, BIB_IMAGE_SCALE } from "@/modules/registrations/bib-geometry";
import { BIB_IMAGE_FOOTER, bibImageFooterLines } from "@/modules/registrations/bib-image";
import { BIB_SHEET_FOOTER, bibSheetFooterLines } from "@/modules/registrations/bibs-pdf";

/**
 * BR-REQ-038-01, `DECISIONS.md` §317 — the footer is the club's to compose.
 *
 * Three promises, each of which would fail silently on paper: the platform's own design prints
 * exactly the footer every bib printed before; a footer never overflows the bib or shrinks into
 * illegibility, however much the club switches on; and the preview picture breaks the footer in
 * the same places as the A4 sheet, because it is the club's only look at the paper (§180).
 */

const PARTNERS = ["Primăria Brașov", "Salvamont"];
const REPLY_TO = "contact@example.test";
const SITE = "https://www.example.test/";
const TITLE = "Crosul aniversar Brașov Runners";
const DATE = "21 noiembrie 2026";
/** The band at the top, as on the platform's own design: `headerPicture` is the renderer's to say. */
const FACTS = { partners: PARTNERS, replyTo: REPLY_TO, siteUrl: SITE, eventTitle: TITLE, eventDate: DATE, headerPicture: false };

const design = (over: Partial<BibDesign> = {}): BibDesign => ({ ...DEFAULT_BIB_DESIGN, ...over });

/** Enough of everything that a footer cannot fit on one line, and sometimes not on two. */
const LONG_PARTNERS = [
  "Primăria Municipiului Brașov",
  "Salvamont Brașov",
  "Asociația Sportivă Carpați",
  "Decathlon Brașov",
  "Clubul Sportiv Olimpia",
  "Coresi Shopping Resort",
];
const LONG_LINE = "Cronometraj: StartTime România · Urgențe organizator: 0722 000 000 · Traseu marcat cu bandă roșie";

describe("§317 what the footer says", () => {
  it("prints exactly today's footer on the platform's own design", () => {
    // The footer every bib printed before this, character for character, on one line.
    expect(bibFooterLines(bibFooterParts(DEFAULT_BIB_DESIGN, FACTS))).toEqual([
      "Primăria Brașov  ·  Salvamont  ·  contact@example.test",
    ]);
  });

  it("prints no address when the email is switched off", () => {
    const parts = bibFooterParts(design({ showEmail: false }), FACTS);
    expect(parts).toEqual(PARTNERS);
    expect(parts.join(" ")).not.toContain("@");
  });

  it("prints no partners when they are switched off, and nothing at all when everything is", () => {
    expect(bibFooterParts(design({ showPartners: false }), FACTS)).toEqual([REPLY_TO]);
    expect(bibFooterParts(design({ showPartners: false, showEmail: false }), FACTS)).toEqual([]);
    expect(bibFooterLines([])).toEqual([]);
  });

  it("puts the club's own line between the partners and the website, and the mailbox last", () => {
    const parts = bibFooterParts(design({ footerText: "Cronometraj: StartTime", showWebsite: true }), FACTS);
    expect(parts).toEqual([...PARTNERS, "Cronometraj: StartTime", "example.test", REPLY_TO]);
    expect(bibFooterLines(parts)).toEqual([parts.join(BIB_FOOTER_SEPARATOR)]);
  });

  it("prints the website as the bare host of the base URL, never anything else", () => {
    expect(bibWebsiteHost("https://www.example.test/")).toBe("example.test");
    expect(bibWebsiteHost("https://qa.example.test")).toBe("qa.example.test");
    expect(bibWebsiteHost("http://localhost:3000")).toBe("localhost:3000");
    expect(bibWebsiteHost("https://Example.TEST/some/path?x=1")).toBe("example.test");
    expect(bibWebsiteHost("not a url")).toBeNull();
    expect(bibWebsiteHost(null)).toBeNull();
    // Off by default: today's footer carries no website.
    expect(bibFooterParts(DEFAULT_BIB_DESIGN, FACTS)).not.toContain("example.test");
    expect(bibFooterParts(design({ showWebsite: true, showEmail: false, showPartners: false }), FACTS)).toEqual(["example.test"]);
    // A switch with nothing behind it prints nothing, not an empty piece between separators.
    expect(bibFooterParts(design({ showWebsite: true }), { ...FACTS, siteUrl: "::" })).toEqual([...PARTNERS, REPLY_TO]);
  });

  it("adds the event to the footer only where the header does not already say it", () => {
    const picture = "https://pub-example.r2.dev/qa/3f2a1b4c-0000-4000-8000-000000000000/web.webp";
    const withEvent = (over: Partial<BibDesign>, headerPicture = false) =>
      bibFooterParts(design({ showEventInFooter: true, showPartners: false, showEmail: false, ...over }), { ...FACTS, headerPicture });
    // The band shows the title and the date: the switch adds nothing, so nothing is said twice.
    expect(withEvent({})).toEqual([]);
    // A picture replaces the band and everything on it: both come down to the footer.
    expect(withEvent({ headerImageSrc: picture }, true)).toEqual([TITLE, DATE]);
    // The design names a picture the route could not fetch, so the sheet prints the band — title
    // and date on it — and the footer must not print them a second time. The renderer says which
    // header it draws; the stored address does not.
    expect(withEvent({ headerImageSrc: picture }, false)).toEqual([]);
    // The date switched off in the header: only the date.
    expect(withEvent({ showDate: false })).toEqual([DATE]);
    expect(withEvent({ showEventTitle: false })).toEqual([TITLE]);
    // And first, before the partners.
    expect(bibFooterParts(design({ showEventInFooter: true, showDate: false }), FACTS)).toEqual([DATE, ...PARTNERS, REPLY_TO]);
    // Off by default.
    expect(bibFooterParts(design({ showDate: false }), FACTS)).toEqual([...PARTNERS, REPLY_TO]);
  });

  it("prints only the club's facts: nothing about a participant can reach it", () => {
    // Every switch on: every piece is one of the facts handed in, and the function has no
    // parameter a name, a telephone number or an emergency contact could arrive through.
    const everything = design({ showEventInFooter: true, showDate: false, showWebsite: true, footerText: "Cronometraj" });
    const allowed = new Set([TITLE, DATE, ...PARTNERS, "Cronometraj", "example.test", REPLY_TO]);
    for (const part of bibFooterParts(everything, FACTS)) expect(allowed.has(part), part).toBe(true);
    expect(bibFooterParts.length).toBe(2);
  });
});

describe("§317 the club's own line", () => {
  it("is one line of plain text, trimmed, at most the limit", () => {
    expect(bibFooterText("  Urgențe:\n0722 000 000\t ")).toBe("Urgențe: 0722 000 000");
    expect(Array.from(bibFooterText("ă".repeat(500)))).toHaveLength(BIB_FOOTER_TEXT_MAX);
    expect(bibFooterText("   ")).toBe("");
  });

  it("keeps only what the bib's font can draw", () => {
    expect(bibFooterText("Start \u{1F3C3} 10:00")).toBe("Start 10:00");
    expect(bibFooterText("zero\u200Bwidth soft\u00ADhyphen")).toBe("zerowidth softhyphen");
    // Both Romanian forms of the letters, and the typographic punctuation a club types.
    expect(bibFooterText("ș ț ş ţ Ș Ț – „citat” € …")).toBe("ș ț ş ţ Ș Ț – „citat” € …");
  });
});

describe("§317 one line or two, measured", () => {
  const fitsTheTable = (line: string) => bibFooterWidth(line) <= BIB_FOOTER_EMS;

  it("keeps a footer that fits on one line", () => {
    expect(bibFooterLines(["a", "b"])).toEqual([`a${BIB_FOOTER_SEPARATOR}b`]);
  });

  it("moves whole pieces to a second line rather than splitting one", () => {
    const parts = [...LONG_PARTNERS, REPLY_TO];
    expect(fitsTheTable(parts.join(BIB_FOOTER_SEPARATOR))).toBe(false);
    const lines = bibFooterLines(parts);
    expect(lines).toHaveLength(2);
    expect(lines.every(fitsTheTable)).toBe(true);
    // Every piece is whole on one line or the other, in order, and nothing was cut.
    expect(lines.join(BIB_FOOTER_SEPARATOR)).toBe(parts.join(BIB_FOOTER_SEPARATOR));
    expect(lines[1]).not.toContain("…");
    // The first line is as full as whole pieces allow: one more would not have fitted.
    const onFirst = lines[0].split(BIB_FOOTER_SEPARATOR).length;
    expect(fitsTheTable(parts.slice(0, onFirst + 1).join(BIB_FOOTER_SEPARATOR))).toBe(false);
  });

  it("cuts the second line with an ellipsis when two are not enough, and never makes a third", () => {
    const parts = [...LONG_PARTNERS, LONG_LINE, "example.test", REPLY_TO, ...LONG_PARTNERS];
    const lines = bibFooterLines(parts);
    expect(lines).toHaveLength(BIB_FOOTER_MAX_LINES);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(lines.every(fitsTheTable)).toBe(true);
    // No separator left dangling before the ellipsis.
    expect(lines[1]).not.toMatch(/[\s·]…$/u);
    // As much as fits: one more character of the text would not have.
    expect(lines[1].length).toBeGreaterThan(60);
  });

  it("breaks a single piece wider than a line between words, and a single word between characters", () => {
    const sentence = Array.from({ length: 40 }, (_, i) => `cuvânt${i}`).join(" ");
    const lines = bibFooterLines([sentence]);
    expect(lines).toHaveLength(2);
    expect(lines.every(fitsTheTable)).toBe(true);
    expect(sentence.startsWith(lines[0])).toBe(true);
    expect(lines[0].endsWith(" ")).toBe(false);

    const word = "W".repeat(200);
    const cut = bibFooterLines([word]);
    expect(cut).toHaveLength(2);
    expect(cut.every(fitsTheTable)).toBe(true);
    expect(cut[1].endsWith("…")).toBe(true);
  });

  it("never lays out a line wider than the budget, whatever it is given", () => {
    // A little property test: pseudo-random pieces from the characters a club types.
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const alphabet = "abcdefghijklmnopqrstuvwxyzăâîșț ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.:-–·WMm";
    for (let round = 0; round < 200; round++) {
      const parts = Array.from({ length: 1 + Math.floor(random() * 10) }, () =>
        Array.from({ length: 1 + Math.floor(random() * 90) }, () => alphabet[Math.floor(random() * alphabet.length)]).join(""),
      );
      const lines = bibFooterLines(parts);
      expect(lines.length).toBeLessThanOrEqual(BIB_FOOTER_MAX_LINES);
      for (const line of lines) expect(fitsTheTable(line), line).toBe(true);
    }
  });

  it("adds the pairs the font kerns apart, so a line rich in them is measured wider", () => {
    // "rt" is Roboto's widest pair: 50/2048 of an em on top of the two advances.
    const advances = (text: string) => Array.from(text).reduce((sum, character) => sum + BIB_FOOTER_ADVANCES.get(character)!, 0) / 2048;
    expect(bibFooterWidth("rt")).toBeCloseTo(advances("rt") + 50 / 2048, 12);
    expect(bibFooterWidth("Fort Sport")).toBeCloseTo(advances("Fort Sport") + 100 / 2048, 12);
    // A pair the font kerns together counts as its two advances, never less.
    expect(bibFooterWidth("AV")).toBe(advances("AV"));
  });

  it("counts a character it does not know wider than any glyph, so it can wrap early but never overflow", () => {
    expect(bibFooterWidth("\u{1F3C3}")).toBeGreaterThan(Math.max(...BIB_FOOTER_ADVANCES.values()) / 2048);
  });
});

/**
 * The table is the font. If `Roboto-Regular.ttf` is ever replaced, these fail rather than the
 * footer quietly overflowing the paper.
 */
describe("§317 the widths are the font's, and the lines fit the paper", () => {
  const doc = new PDFDocument({ autoFirstPage: false });
  doc.registerFont("footer", path.join(process.cwd(), "src", "theme", "pdf", "Roboto-Regular.ttf"));
  const pdfkitWidth = (text: string, size: number) => doc.font("footer").fontSize(size).widthOfString(text);

  it("holds every width in the table to the font file, glyph by glyph", () => {
    const wrong: string[] = [];
    for (const [character, units] of BIB_FOOTER_ADVANCES) {
      if (Math.abs(pdfkitWidth(character, 2048) - units) > 0.001) wrong.push(`${character} ${units}`);
    }
    expect(wrong).toEqual([]);
    // The characters a Romanian footer is made of are all there.
    for (const character of "aăâbcdefghiîjklmnopqrsștțuvwxyzĂÂÎȘȚşţŞŢ0123456789@.:-–—·,;!?()/&+%€„”…") {
      expect(BIB_FOOTER_ADVANCES.has(character), character).toBe(true);
    }
  });

  /**
   * Every pair of the table's characters, laid out by pdfkit as one run (`features: []` keeps
   * pdfkit from measuring word by word, so a pair after a space is kerned as a browser would):
   * the pairs it sets wider than their two advances are exactly the kerning table, unit for unit.
   * A pair it sets closer — or joins into a ligature — is not in the table, on purpose.
   */
  it("holds the kerning table to the font file, pair by pair", () => {
    doc.font("footer").fontSize(2048);
    const characters = [...BIB_FOOTER_ADVANCES.keys()];
    const wrong: string[] = [];
    for (const first of characters) {
      for (const second of characters) {
        const kern = Math.round(
          doc.widthOfString(`${first}${second}`, { features: [] }) - BIB_FOOTER_ADVANCES.get(first)! - BIB_FOOTER_ADVANCES.get(second)!,
        );
        if ((BIB_FOOTER_KERNING.get(`${first}${second}`) ?? 0) !== Math.max(kern, 0)) wrong.push(`${first}${second} ${kern}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(BIB_FOOTER_KERNING.size).toBe(627);
  });

  it("counts an unknown character wider than any character the font can draw, with a kern each side", () => {
    // The whole Basic Multilingual Plane through pdfkit: whatever a partner's name holds, the
    // font draws it no wider than the measure counts it.
    doc.font("footer").fontSize(2048);
    let widest = 0;
    for (let code = 0x20; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      widest = Math.max(widest, doc.widthOfString(String.fromCharCode(code)));
    }
    const widestKern = Math.max(...BIB_FOOTER_KERNING.values());
    expect(bibFooterWidth("\u{1F3C3}") * 2048).toBeGreaterThanOrEqual(widest + 2 * widestKern);
  });

  it("never lays out a sheet line wider than pdfkit measures the paper's line", () => {
    const cases: Array<Parameters<typeof bibSheetFooterLines>[0]> = [
      { ...FACTS, design: DEFAULT_BIB_DESIGN },
      { ...FACTS, partners: LONG_PARTNERS, design: design({ footerText: LONG_LINE, showWebsite: true }) },
      { ...FACTS, partners: [...LONG_PARTNERS, ...LONG_PARTNERS], design: design({ footerText: LONG_LINE, showWebsite: true, showEventInFooter: true, showDate: false }) },
      { ...FACTS, partners: ["W".repeat(150)], design: DEFAULT_BIB_DESIGN },
      // The review's example: its first line fitted by the advances alone and not in pdfkit.
      { ...FACTS, partners: ["Expert Port Sportivă Start", "Fort Sport", "Fort Heart Turism Asociația", "Munte", "Port Resort", "Expert Primăria Heart"], design: DEFAULT_BIB_DESIGN },
    ];
    for (const input of cases) {
      const lines = bibSheetFooterLines(input, false);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        // pdfkit's own measure, kerning and all, at the size the sheet prints.
        expect(pdfkitWidth(line, BIB_SHEET_FOOTER.size), line).toBeLessThanOrEqual(BIB_SHEET_FOOTER.width);
      }
    }
  });

  /**
   * The property the paper depends on, measured by pdfkit rather than by the table: random
   * footers built from the pairs the font kerns apart ("rt", "FT", "’l"…), the ligatures, the
   * separator and words a partner list is made of. Every line laid out fits the paper's line, and
   * the measure is never narrower than pdfkit's, whether pdfkit sets it word by word (as the
   * sheet draws) or as one run.
   */
  it("never measures a line narrower than pdfkit sets it, however rich in kerned pairs", () => {
    let seed = 2026;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    const widening = [...BIB_FOOTER_KERNING.keys()];
    const words = ["Expert", "Port", "Sportivă", "Start", "Fort", "Heart", "Turism", "Asociația", "Forța", "Art", "FTP", "’l", "(Y)", "fi", "fl", "ffi"];
    const characters = [...BIB_FOOTER_ADVANCES.keys()];
    const piece = () =>
      Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
        const roll = random();
        return roll < 0.4 ? pick(widening) : roll < 0.8 ? pick(words) : pick(characters);
      }).join(random() < 0.5 ? " " : "");
    doc.font("footer").fontSize(BIB_SHEET_FOOTER.size);
    for (let round = 0; round < 400; round++) {
      const parts = Array.from({ length: 1 + Math.floor(random() * 12) }, piece);
      for (const line of bibFooterLines(parts)) {
        const measured = bibFooterWidth(line) * BIB_SHEET_FOOTER.size;
        expect(doc.widthOfString(line), line).toBeLessThanOrEqual(measured + 1e-9);
        expect(doc.widthOfString(line, { features: [] }), line).toBeLessThanOrEqual(measured + 1e-9);
        expect(doc.widthOfString(line), line).toBeLessThanOrEqual(BIB_SHEET_FOOTER.width);
      }
    }
  });
});

describe("§317 the picture and the paper break the footer in the same places", () => {
  it("measures both footers in the same ems", () => {
    expect(BIB_SHEET_FOOTER.width / BIB_SHEET_FOOTER.size).toBeCloseTo(BIB_FOOTER_EMS, 2);
    expect(BIB_IMAGE_FOOTER.width / BIB_IMAGE_FOOTER.size).toBeCloseTo(BIB_FOOTER_EMS, 6);
    // The picture's line is the sheet's own 523.28-point line, times the one factor that takes
    // every length on the paper to a pixel (`bib-geometry.ts`).
    expect(BIB_IMAGE_FOOTER.width).toBeCloseTo(BIB_FOOTER_LINE.width * BIB_IMAGE_SCALE, 6);
  });

  it("lays out the same lines for the same design and facts — which parts show, and where it breaks", () => {
    const designs = [
      DEFAULT_BIB_DESIGN,
      design({ showEmail: false }),
      design({ showPartners: false, footerText: "Cronometraj: StartTime" }),
      design({ footerText: LONG_LINE, showWebsite: true }),
      design({ footerText: LONG_LINE, showWebsite: true, showEventInFooter: true, showEventTitle: false, showDate: false }),
    ];
    const partnerLists = [[], PARTNERS, LONG_PARTNERS, [...LONG_PARTNERS, ...LONG_PARTNERS]];
    for (const bib of designs) {
      for (const partners of partnerLists) {
        for (const headerPicture of [false, true]) {
          const input = { ...FACTS, partners, design: bib };
          expect(bibImageFooterLines(input, headerPicture), JSON.stringify(input)).toEqual(bibSheetFooterLines(input, headerPicture));
        }
      }
    }
  });

  it("draws the picture's lines inside the picture's footer", () => {
    const lines = bibImageFooterLines({ ...FACTS, partners: LONG_PARTNERS, design: design({ footerText: LONG_LINE, showWebsite: true }) }, false);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(bibFooterWidth(line) * BIB_IMAGE_FOOTER.size).toBeLessThanOrEqual(BIB_IMAGE_FOOTER.width);
  });
});
