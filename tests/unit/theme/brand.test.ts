import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "@/../messages/ro.json";
import en from "@/../messages/en.json";
import { CLUB_NAME, COLOR, COLOR_DARK, FONT, GRADIENT, LOGO, SURFACE_GRADIENT, WORDMARK } from "@/theme/brand";

/**
 * BR-REQ-070-02 criterion 4 — colour contrast meets the accessibility baseline.
 *
 * The palette is a placeholder, but "placeholder" is not a reason to ship unreadable text: the
 * pairs below are the ones the pages actually render, and each is asserted against the WCAG
 * 2.1 AA threshold. When the club's t-shirt colours replace these values, this test is what
 * says whether they can be used as-is or need a darkened variant for text.
 *
 * The full audit of criterion 4 is an e2e concern (`seo.spec.ts`, not built). This covers the
 * half that is decidable from the tokens alone, which is the half that a brand swap breaks.
 */

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe("BR-REQ-070-02 the palette is readable", () => {
  it("computes a known ratio, so the helper itself is not the thing under test", () => {
    // Black on white is 21:1 exactly.
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  const bodyText: [string, string, string][] = [
    ["body text on the page", COLOR.ink, COLOR.paper],
    ["body text on a card", COLOR.ink, COLOR.surface],
    ["field labels on the page", COLOR.inkMuted, COLOR.paper],
    ["field labels on a card", COLOR.inkMuted, COLOR.surface],
    ["the club blue as text on the page", COLOR.blue, COLOR.paper],
    ["the club blue as text on a card", COLOR.blue, COLOR.surface],
    ["the hover shade on the page", COLOR.blueInk, COLOR.paper],
    ["the hover shade on a card", COLOR.blueInk, COLOR.surface],
    ["button text on the primary colour", COLOR.paper, COLOR.blue],
    ["text on the secondary colour", COLOR.ink, COLOR.orange],
  ];

  for (const [label, foreground, background] of bodyText) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  // The same pairs after dark (`DECISIONS.md` §93).
  const darkText: Array<[string, string, string]> = [
    ["dark: body text on the page", COLOR_DARK.ink, COLOR_DARK.paper],
    ["dark: body text on a card", COLOR_DARK.ink, COLOR_DARK.surface],
    ["dark: field labels on the page", COLOR_DARK.inkMuted, COLOR_DARK.paper],
    ["dark: field labels on a card", COLOR_DARK.inkMuted, COLOR_DARK.surface],
    ["dark: the blue as text on the page", COLOR_DARK.blue, COLOR_DARK.paper],
    ["dark: the blue as text on a card", COLOR_DARK.blue, COLOR_DARK.surface],
    ["dark: the hover shade on the page", COLOR_DARK.blueInk, COLOR_DARK.paper],
    ["dark: button text on the primary colour", COLOR_DARK.paper, COLOR_DARK.blue],
    ["dark: text on the secondary colour", COLOR.ink, COLOR.orange],
  ];
  for (const [label, foreground, background] of darkText) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("keeps the dark surface distinguishable from the dark page, in six-digit hex", () => {
    expect(COLOR_DARK.surface).not.toBe(COLOR_DARK.paper);
    for (const [name, value] of Object.entries(COLOR_DARK)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("records that the secondary colour is a surface, not a text colour", () => {
    // 2.64:1 on the page background. The theme uses it the only way it works — as a fill with
    // dark text on top, which is the `ink on orange` pair above at 6.25:1. This assertion is
    // here so that colouring text with it looks like breaking a rule rather than picking a
    // colour, and so the same question gets asked of the club's real secondary.
    expect(contrastRatio(COLOR.orange, COLOR.paper)).toBeLessThan(4.5);
  });

  it("keeps the surface distinguishable from the page behind it", () => {
    // Not a WCAG threshold — cards are separated by a border as well. This only catches a
    // brand swap that makes `surface` and `paper` the same colour, which would flatten the
    // event list into one undifferentiated column.
    expect(COLOR.surface).not.toBe(COLOR.paper);
  });

  it("uses the blue the club's own logo file states", () => {
    // Every path in public/brand/logo.svg is filled with this value. If the club settles on
    // the t-shirt's navy instead, this and the SVG have to move together — a palette that
    // disagrees with the logo beside it is the one branding error everybody notices.
    expect(COLOR.blue).toBe("#0000ff");
  });

  it("uses six-digit hex everywhere, which the contrast helper assumes", () => {
    for (const [name, value] of Object.entries(COLOR)) {
      expect(value, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

/**
 * BR-REQ-070-02 criterion 4, again, for the gradients (§166).
 *
 * A flat background is one colour and one ratio. A gradient is a *range*, and a reader lands
 * somewhere in it: the countdown sits over the light end of the hero and the body text runs
 * across the whole of it. So every pair is asserted against **both stops**, in both schemes,
 * which is what stops "more gradients and shiny Front-End stuff" from costing somebody the
 * one sentence the hero exists to say.
 *
 * The accent gradient's two stops are the palette's own blue and its ink-blue, so their
 * ratios against button text are asserted above; what is asserted here is that the gradient
 * is actually made of them, because a hand-written stop inside the CSS string would be a hex
 * outside the palette and no other test would see it.
 */
describe("BR-REQ-070-02 the gradients are readable at both ends", () => {
  const overHero: Array<[string, string, string]> = [
    ["body text over the hero's light end", COLOR.ink, GRADIENT.heroTint],
    ["body text over the hero's card end", COLOR.ink, COLOR.surface],
    ["muted text over the hero's light end", COLOR.inkMuted, GRADIENT.heroTint],
    ["the countdown over the hero's light end", COLOR.blue, GRADIENT.heroTint],
    ["dark: body text over the hero's light end", COLOR_DARK.ink, GRADIENT.heroTintDark],
    ["dark: muted text over the hero's light end", COLOR_DARK.inkMuted, GRADIENT.heroTintDark],
    ["dark: the countdown over the hero's light end", COLOR_DARK.blue, GRADIENT.heroTintDark],
  ];

  for (const [label, foreground, background] of overHero) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  const overAccent: Array<[string, string, string]> = [
    ["button text over the accent's first stop", COLOR.paper, COLOR.blue],
    ["button text over the accent's last stop", COLOR.paper, COLOR.blueInk],
    ["dark: button text over the accent's first stop", COLOR_DARK.paper, COLOR_DARK.blue],
    ["dark: button text over the accent's last stop", COLOR_DARK.paper, COLOR_DARK.blueInk],
  ];

  for (const [label, foreground, background] of overAccent) {
    it(`clears AA for ${label}`, () => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("keeps the hero a surface rather than a wash", () => {
    // The tint is a step away from the card colour, not a different colour. If a future edit
    // pushes it far enough to need its own text colour, the pairs above fail first — this
    // catches the milder version, where the hero stops reading as a card at all.
    expect(GRADIENT.heroTint).not.toBe(COLOR.surface);
    expect(GRADIENT.heroTintDark).not.toBe(COLOR_DARK.surface);
    expect(contrastRatio(COLOR.surface, GRADIENT.heroTint)).toBeLessThan(1.5);
    expect(contrastRatio(COLOR_DARK.surface, GRADIENT.heroTintDark)).toBeLessThan(1.5);
  });

  it("states the new tints in six-digit hex, which the contrast helper assumes", () => {
    expect(GRADIENT.heroTint).toMatch(/^#[0-9a-f]{6}$/);
    expect(GRADIENT.heroTintDark).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("builds every CSS gradient out of palette tokens and nothing else", () => {
    // Every stop a component can paint has to be a value some assertion above has measured.
    // A colour typed straight into the CSS string would be a hex the palette never saw.
    const stops: Record<string, string[]> = {
      hero: [COLOR.surface, GRADIENT.heroTint],
      heroDark: [COLOR_DARK.surface, GRADIENT.heroTintDark],
      accent: [COLOR.blue, COLOR.blueInk],
      accentDark: [COLOR_DARK.blue, COLOR_DARK.blueInk],
      rule: [COLOR.blue, COLOR.orange],
      ruleDark: [COLOR_DARK.blue, COLOR.orange],
    };

    for (const [name, expected] of Object.entries(stops)) {
      const css = SURFACE_GRADIENT[name as keyof typeof SURFACE_GRADIENT];
      const found = css.match(/#[0-9a-f]{3,8}/g) ?? [];
      expect(found, name).toEqual(expected);
    }
  });
});

describe("the brand assets the theme points at exist", () => {
  for (const [name, asset] of Object.entries(LOGO)) {
    it(`${name} resolves to a file in public/`, () => {
      // A renamed or moved asset is invisible in review and shows up as a broken image on the
      // club's own home page. `src` is root-relative, so it resolves under `public/`.
      const path = join(process.cwd(), "public", asset.src);
      expect(existsSync(path), asset.src).toBe(true);
      expect(readFileSync(path, "utf8")).toContain("<svg");
    });

    it(`${name} declares the viewBox its proportions are derived from`, () => {
      // The layout reserves space from width/height, and the browser fits the artwork to the
      // viewBox. If the two disagree the logo is letterboxed or stretched, which is invisible
      // in review and obvious on the club's home page.
      const svg = readFileSync(join(process.cwd(), "public", asset.src), "utf8");
      expect(svg).toContain(`viewBox="${asset.viewBox}"`);
      expect(asset.viewBox.split(" ").slice(2).join(" ")).toBe(`${asset.width} ${asset.height}`);
    });

    it(`${name} has a variant for dark grounds`, () => {
      // The artwork is a flat single colour, so it disappears on a dark background. The club
      // supplied a white version; this is the check that it is actually wired up.
      const path = join(process.cwd(), "public", asset.onDark);
      expect(existsSync(path), asset.onDark).toBe(true);
      expect(readFileSync(path, "utf8")).toContain(`viewBox="${asset.viewBox}"`);
    });
  }

  it("keeps the browser-tab icon identical to the lockup", () => {
    // `src/app/icon.svg` is a Next file convention: nothing imports it, so a new lockup in
    // public/brand/ leaves the old one in the tab and no compiler notices. This is the only
    // thing that does.
    const lockup = readFileSync(join(process.cwd(), "public", LOGO.lockup.src), "utf8");
    const icon = readFileSync(join(process.cwd(), "src", "app", "icon.svg"), "utf8");

    expect(icon).toBe(lockup);
  });

  it("names a fallback stack, so a missing webfont does not fall back to Times", () => {
    expect(FONT.fallback).toMatch(/sans-serif$/);
  });

  describe("the kit wordmark constant stays inside what the kit typeface can render", () => {
    it("is ASCII, because Facón contains no Romanian characters", () => {
      // Verified by reading the font's own cmap: 129 mapped characters, and not one of
      // ș ț ă â î in either the comma-below or the cedilla encoding. Writing "BRAȘOV" here
      // would not throw — it would silently render the Ș in the fallback font, one Roboto
      // letter in the middle of a Facón word. docs/brand/README.md has the full table.
      expect(WORDMARK).toMatch(/^[\x20-\x7e]+$/);
    });

    it("is the kit's logotype, not the club's name", () => {
      // The name, spelled properly, is CLUB_NAME and is what the header link announces to a
      // screen reader. These two are allowed to differ; that is the whole point. If someone
      // ever "corrects" the constant, the assertion above catches it.
      expect(WORDMARK).toBe("BRASOV RUNNERS");
      expect(CLUB_NAME).toBe("Brașov Runners");
    });

    it("is the one copy of the club's name: the catalogues ask for it rather than hold it (§215, §369)", () => {
      // CLUB_NAME is what a registration *records* when somebody ticks "I am a member": one
      // string, the same for a Romanian and an English submission, so the export has one club
      // and not three spellings of it. The catalogues used to hold a second copy under
      // `Site.name`, kept equal by this test; now they hold none, and the tick's own words take
      // the constant as `{club}`, so the name a runner reads is the name the row stores.
      expect("name" in messages.Site).toBe(false);
      expect("name" in en.Site).toBe(false);
      const ro = createTranslator({ locale: "ro", messages, namespace: "Registration" });
      const english = createTranslator({ locale: "en", messages: en, namespace: "Registration" });
      expect(ro("clubMemberDeclared", { club: CLUB_NAME })).toBe(`Sunt membru al grupului ${CLUB_NAME}`);
      expect(english("clubMemberDeclared", { club: CLUB_NAME })).toBe(`I am a member of the ${CLUB_NAME} group`);
    });

    it("ships the font it is set in, with the licence beside it", () => {
      // next/font/local resolves this path at build time, so a rename breaks the build rather
      // than the page. The licence is asserted because the file is redistributed in every
      // deploy, and a font without its terms is the kind of thing nobody notices is missing.
      expect(existsSync(join(process.cwd(), "src/theme/fonts/Facon.ttf"))).toBe(true);
      expect(existsSync(join(process.cwd(), "src/theme/fonts/Facon-LICENSE.txt"))).toBe(true);
    });
  });
});
