import { describe, expect, it } from "vitest";
import {
  KIT_MARGIN as SCRIPT_MARGIN,
  KIT_PNG_WIDTH as SCRIPT_PNG_WIDTH,
  KIT_SHAPES,
  kitColours,
  kitFileName,
  kitFiles,
  kitGrounds,
} from "../../../scripts/brand-kit.mjs";
import {
  KIT_MARGIN,
  KIT_PNG_WIDTH,
  LOGO_FORMATS,
  LOGO_INK_GROUND,
  LOGO_INK_HEX,
  LOGO_INKS,
  LOGO_SHAPES,
  logoFileName,
  logoFiles,
  logoGrounds,
  logoVariants,
  parseLogoFile,
  posterFileName,
  rgbOf,
  shownAddress,
  STICKER_SHEET_KEYS,
  isStickerSheetKey,
  stickerFileName,
} from "@/modules/pr-kit/domain/kit";
import { CLUB_SLUG, PALETTE } from "@/theme/brand";

/**
 * §1015 — «PR Kit»: what the kit holds and what every file is called.
 *
 * Every download is named from the club's slug (`club.json`, read through `brand.ts`), never a literal — so a fork's files carry
 * the fork's name — and the app's names are the very names `yarn brand:assets` writes (`scripts/brand-kit.mjs`), shape by shape,
 * ink by ink. The address under a code is the site's address as a person reads it: no scheme, no `www.`, no closing slash —
 * the code keeps the whole one. And the club's colour is the palette's primary, as hex and as RGB.
 */
describe("§1015 the PR kit's files and names", () => {
  it("names every file from the club's slug", () => {
    for (const { shape, ink } of logoVariants()) {
      for (const format of LOGO_FORMATS) expect(logoFileName(shape, ink, format).startsWith(`${CLUB_SLUG}-`), `${shape} ${ink} ${format}`).toBe(true);
    }
    expect(logoFileName("lockup", "primary", "svg")).toBe(`${CLUB_SLUG}-logo-primary.svg`);
    expect(logoFileName("mountains", "white", "png")).toBe(`${CLUB_SLUG}-mountains-white-4000px.png`);
    expect(logoFileName("lockup", "black", "pdf")).toBe(`${CLUB_SLUG}-logo-black.pdf`);
    expect(STICKER_SHEET_KEYS.map((sheet) => stickerFileName(sheet))).toEqual([
      `${CLUB_SLUG}-stickers-qr-12-per-sheet.pdf`,
      `${CLUB_SLUG}-stickers-qr-24-per-sheet.pdf`,
      `${CLUB_SLUG}-stickers-logo-12-per-sheet.pdf`,
      `${CLUB_SLUG}-stickers-logo-24-per-sheet.pdf`,
      `${CLUB_SLUG}-stickers-logo-40-per-sheet.pdf`,
      `${CLUB_SLUG}-stickers-logo-12-per-sheet-on-primary.pdf`,
    ]);
    expect(posterFileName("ro")).toBe(`${CLUB_SLUG}-youtube-poster-a4-ro.pdf`);
    // Another slug, another name: nothing of this club's is written in.
    expect(logoFileName("lockup", "primary", "svg", "someclub")).toBe("someclub-logo-primary.svg");
    // §NNN: the white on the club's colour, with the stickers' «on-primary» word.
    expect(logoFileName("lockup", "white", "png", undefined, "primary")).toBe(`${CLUB_SLUG}-logo-white-on-primary-4000px.png`);
    expect(logoFileName("mountains", "white", "pdf", "someclub", "primary")).toBe("someclub-mountains-white-on-primary.pdf");
    expect(stickerFileName("logo-12-primary", "someclub")).toBe("someclub-stickers-logo-12-per-sheet-on-primary.pdf");
  });

  it("names the SVGs and PNGs exactly as the script writes them, and shares its margin and its PNG width", () => {
    const written = kitFiles(CLUB_SLUG).map(({ name }) => name).sort();
    const named = logoFiles()
      .flatMap(({ shape, ink, ground }) => (["svg", "png"] as const).map((format) => logoFileName(shape, ink, format, undefined, ground)))
      .sort();
    expect(named).toEqual(written);
    // §NNN: the white alone also comes on the club's colour, in the app as in the script.
    for (const ink of LOGO_INKS) expect([...logoGrounds(ink)], ink).toEqual(kitGrounds(ink));
    expect(logoFiles().filter(({ ground }) => ground === "primary")).toEqual([
      { shape: "lockup", ink: "white", ground: "primary" },
      { shape: "mountains", ink: "white", ground: "primary" },
    ]);
    expect(KIT_SHAPES.map(({ key }) => key)).toEqual([...LOGO_SHAPES]);
    expect(kitFileName(CLUB_SLUG, "mountains", "black", "svg")).toBe(logoFileName("mountains", "black", "svg"));
    expect(KIT_MARGIN).toBe(SCRIPT_MARGIN);
    expect(KIT_PNG_WIDTH).toBe(SCRIPT_PNG_WIDTH);
  });

  it("paints the three inks as the script does: the palette's primary, white and black — each on its own ground", () => {
    expect(kitColours(PALETTE).map(({ key }) => key)).toEqual([...LOGO_INKS]);
    expect(Object.fromEntries(kitColours(PALETTE).map(({ key, hex }) => [key, hex]))).toEqual(LOGO_INK_HEX);
    expect(LOGO_INK_HEX.primary).toBe(PALETTE.primary);
    expect(LOGO_INK_GROUND).toEqual({ primary: "#ffffff", white: PALETTE.primary, black: "#ffffff" });
  });

  it("reads a download's name back to what it names, and nothing else", () => {
    for (const { shape, ink, ground } of logoFiles()) {
      for (const format of LOGO_FORMATS) expect(parseLogoFile(logoFileName(shape, ink, format, undefined, ground))).toEqual({ shape, ink, ground, format });
    }
    // Only the white comes on the club's colour.
    for (const name of [`${CLUB_SLUG}-logo-black-on-primary.svg`, `${CLUB_SLUG}-logo-primary-on-primary-4000px.png`]) expect(parseLogoFile(name), name).toBeNull();
    for (const name of ["", "logo.svg", "../../club/club.json", `${CLUB_SLUG}-logo-primary.svg/..`, `${CLUB_SLUG}-logo-red.svg`, `${CLUB_SLUG}-logo-primary.png`]) {
      expect(parseLogoFile(name), name).toBeNull();
    }
    expect(STICKER_SHEET_KEYS.every(isStickerSheetKey)).toBe(true);
    expect(isStickerSheetKey("qr-99")).toBe(false);
    expect(isStickerSheetKey("__proto__")).toBe(false);
  });

  it("prints an address as a person reads it: no scheme, no www., no closing slash", () => {
    expect(shownAddress("https://example.org")).toBe("example.org");
    expect(shownAddress("https://www.example.org/")).toBe("example.org");
    expect(shownAddress("http://localhost:47821")).toBe("localhost:47821");
    expect(shownAddress("https://www.youtube.com/@club")).toBe("youtube.com/@club");
    expect(shownAddress("https://qa.example.org/ro/")).toBe("qa.example.org/ro");
  });

  it("gives the club's colour as RGB beside its hex", () => {
    expect(rgbOf("#0000ff")).toEqual([0, 0, 255]);
    expect(rgbOf("#D6176F")).toEqual([214, 23, 111]);
    expect(() => rgbOf("blue")).toThrow();
    expect(rgbOf(PALETTE.primary)).toHaveLength(3);
  });
});
