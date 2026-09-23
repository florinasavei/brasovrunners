import { z } from "zod";
import { COLOR } from "@/theme/brand";
import { bibDesignValuesFromQuery } from "./bib-design-query";
import { bibFooterText } from "./bib-footer";

/**
 * What a race number looks like, decided once for both renderers (`DECISIONS.md` §173, §180).
 *
 * There are two of them — `bibs-pdf.ts` draws the A4 sheet with pdfkit, `bib-image.tsx` draws
 * the 900×600 picture with `next/og` — and they must agree, because the picture is the club's
 * preview of the paper. Anything that is a *decision* rather than a drawing instruction lives
 * here so the two cannot drift: which colour the header band is when the event names none, and
 * what the club chose to print. What the footer says and how it breaks into lines is
 * `bib-footer.ts`, the same kind of decision with a font table of its own (§317).
 *
 * Pure, and importing nothing but the palette and the two pure modules beside it
 * (`bib-design-query.ts`, `bib-footer.ts`): no `node:` builtin, no pdfkit, no React. That
 * is deliberate — `src/modules/media/limits.ts` exists for the same reason after a native
 * module reached the client bundle through a shared constant.
 */

/**
 * The header band's colour: the event's own, or the club's.
 *
 * `bib_colour` is a hex string or null, and null means "the club's colour" in the editor's
 * palette — the one choice `<input type="color">` cannot express (§177). `blueInk` rather than
 * `blue`: this is a large flat fill behind white text, and pure blue vibrates there, which is
 * the distinction `theme/brand.ts` draws between the two tokens.
 *
 * Anything that is not a six-digit hex falls back rather than reaching a renderer: the column
 * has a CHECK constraint, but a colour is cosmetic and a bib that fails to print is not.
 */
export const BIB_BAND_FALLBACK = COLOR.blueInk;

export function bibBandColour(colour: string | null | undefined): string {
  return typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour) ? colour : BIB_BAND_FALLBACK;
}

/**
 * What else the club may decide about a bib (`DECISIONS.md` §249; the owner: "I wanna be able
 * to design the BIDs").
 *
 * Until now a bib had exactly one decision on it — the band's colour — and everything else was
 * this file's opinion. The club asked for the rest: what is printed, how large the number is,
 * where the name goes, a picture instead of the coloured band, a sponsors' strip, and whether
 * the sheet carries cut marks.
 *
 * ## Why it is one JSON column and one schema
 *
 * Eight settings as eight columns is eight migrations the next time somebody wants a ninth,
 * and none of them is queried — a bib is drawn, never filtered. So: `events.bib_design`, read
 * through `readBibDesign`, which answers with the platform's own choices for anything stored
 * before this existed or stored wrong. A bib that fails to print is worse than a bib that
 * prints plainly, so nothing here throws.
 *
 * ## The two renderers stay in step through the multipliers
 *
 * `bibs-pdf.ts` measures in points and `bib-image.tsx` in pixels, so a font size cannot be
 * shared. A *factor* can: each renderer keeps its own base size and multiplies. That is what
 * `numberScaleFactor` is, and it is why the preview on the screen is the paper.
 */

/** Three sizes, because a number is read across a field and a name is read at the finish. */
export const BIB_NUMBER_SCALES = ["small", "medium", "large"] as const;
export type BibNumberScale = (typeof BIB_NUMBER_SCALES)[number];

/** Above the number or below it; the name is switched off with `showName`. */
export const BIB_NAME_POSITIONS = ["below", "above"] as const;
export type BibNamePosition = (typeof BIB_NAME_POSITIONS)[number];

/**
 * A picture this site stored, and nothing else.
 *
 * The same rule the editorial body's images follow: one of this application's own WebP
 * variants, on the store's public host or the local media route — never a third party's
 * address, which on a printed sheet would be a request to somebody else's server every time
 * the club prints, and in the preview a way to make this application fetch an arbitrary URL.
 */
const storedPicture = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => /\/[0-9a-f-]{36}\/web\.webp$/.test(value) && (value.startsWith("https://") || value.startsWith("/api/media/")),
    "a picture must be one this site stored",
  )
  .nullable()
  .catch(null);

export const bibDesignSchema = z
  .object({
    showName: z.boolean().catch(true),
    showEventTitle: z.boolean().catch(true),
    showDate: z.boolean().catch(true),
    showLogo: z.boolean().catch(true),
    numberScale: z.enum(BIB_NUMBER_SCALES).catch("medium"),
    namePosition: z.enum(BIB_NAME_POSITIONS).catch("below"),
    /** A picture across the top instead of the coloured band, or null for the band (§249). */
    headerImageSrc: storedPicture,
    /** A strip of sponsors above the small print, or null. */
    sponsorImageSrc: storedPicture,
    /** Corner marks on the sheet, for a club that takes it to a printer. */
    cutMarks: z.boolean().catch(false),
    /*
      The footer, the club's to compose (§317; `bib-footer.ts` lays it out). Every default is
      the footer every bib printed before this — the partners, then the club's mailbox — so a
      design stored before these keys existed prints exactly as it did.
    */
    /** The club's mailbox (`EMAIL_REPLY_TO`) at the end of the small print. */
    showEmail: z.boolean().catch(true),
    /** The partners' names (§168). */
    showPartners: z.boolean().catch(true),
    /** The event's title and date in the footer — only the ones the header does not show. */
    showEventInFooter: z.boolean().catch(false),
    /** The bare host of `APP_BASE_URL`, never a hostname literal. */
    showWebsite: z.boolean().catch(false),
    /**
     * A line of the club's own: plain text, one line, what the bib's font can draw, at most
     * `BIB_FOOTER_TEXT_MAX` characters — normalised rather than refused, like every field here.
     */
    footerText: z.string().transform(bibFooterText).catch(""),
  })
  .strict();

export type BibDesign = z.infer<typeof bibDesignSchema>;

export const DEFAULT_BIB_DESIGN: BibDesign = {
  showName: true,
  showEventTitle: true,
  showDate: true,
  showLogo: true,
  numberScale: "medium",
  namePosition: "below",
  headerImageSrc: null,
  sponsorImageSrc: null,
  cutMarks: false,
  showEmail: true,
  showPartners: true,
  showEventInFooter: false,
  showWebsite: false,
  footerText: "",
};

/**
 * Whatever is stored, read as a design — and never a throw.
 *
 * A bib that prints plainly beats a bib that does not print, so a column written by an older
 * version, by a migration, or by hand falls back setting by setting rather than failing: every
 * field `catch`es its own default, and an object that is not one at all reads as the platform's
 * whole design.
 *
 * Only the keys this release knows are read (§317). The schema is strict because the *form*
 * must not post a setting nobody defined, but a stored design is read, not posted: a key a later
 * release added is ignored here rather than taking every other choice down with it, so rolling
 * back after the club saved a newer design still prints the club's design.
 */
export function readBibDesign(value: unknown): BibDesign {
  const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  const known = Object.fromEntries(Object.keys(DEFAULT_BIB_DESIGN).filter((key) => key in stored).map((key) => [key, stored[key]]));
  const parsed = bibDesignSchema.safeParse({ ...DEFAULT_BIB_DESIGN, ...known });
  return parsed.success ? parsed.data : DEFAULT_BIB_DESIGN;
}

/** What a renderer multiplies its own base number size by. */
export function numberScaleFactor(design: BibDesign): number {
  return design.numberScale === "small" ? 0.78 : design.numberScale === "large" ? 1.2 : 1;
}

/**
 * White or ink on the band, whichever can be read on it (§249).
 *
 * The club chooses a colour with a colour picker, and a picker offers yellow. White on yellow
 * is the event title nobody can read at the start line. The threshold is the usual relative
 * luminance one: anything lighter than about 60 per cent takes the body ink instead of white.
 */
export function bandTextColour(band: string): string {
  const hex = /^#[0-9a-f]{6}$/i.test(band) ? band.slice(1) : BIB_BAND_FALLBACK.slice(1);
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.36 ? COLOR.ink : COLOR.surface;
}

/** An address a renderer can fetch: the stored one, or absolute for the local media route. */
export function bibPictureUrl(src: string | null, baseUrl: string): string | null {
  if (!src) return null;
  return src.startsWith("/") ? `${baseUrl.replace(/\/$/, "")}${src}` : src;
}

/**
 * The unsaved design the editor's live preview carries in the picture route's query string,
 * read with the same schema the save uses (the owner: "la BID îmi trebuie un preview aici").
 *
 * `bib-design-query.ts` turns the string into the panel's values; this turns those into a
 * design the renderer accepts — field by field, so a query with one nonsense value draws the
 * platform's choice for that one field, and a query that says nothing draws the platform's
 * design. A picture from somebody else's server is refused here exactly as a stored one is:
 * the preview fetches from this site's store and nowhere else (§249).
 */
export function bibDesignFromQuery(params: URLSearchParams): BibDesign {
  return readBibDesign(bibDesignValuesFromQuery(params));
}
