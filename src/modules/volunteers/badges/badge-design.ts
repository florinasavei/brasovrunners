import { z } from "zod";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { BIB_BAND_FALLBACK, bibEmergencyPhone, storedCrop, storedPicture } from "@/modules/registrations/bib-design";
import { formatPhone } from "@/modules/registrations/phone";
import { bibFooterText } from "@/modules/registrations/bib-footer";
import { fnv1a } from "@/shared/hash";
import { COLOR } from "@/theme/brand";
import { BADGE_CUSTOM_BOUNDS, BADGE_SIZE_PRESETS, BADGE_SIZES } from "./badge-geometry";
import { badgeDesignValuesFromQuery } from "./badge-query";

/**
 * What a volunteer badge looks like, decided once for both renderers (§764; the owner, 2026-10-14:
 * «Și trebuie să putem face design și printa ecusoane de voluntari (similar cu BIB-urile)», then
 * «Badge-urile sunt de obicei mai mici și mai lungi și fără nume, numele îl scriem manual cu markerul»).
 *
 * The bib's machinery, taken whole (§249, §750, §755, §759): one JSON column on the event read through
 * one forgiving reader (`readBadgeDesign`, never a throw — a badge that prints plainly beats one that
 * does not print), one geometry for the pdfkit sheet and the Satori picture (`badge-geometry.ts`), the
 * header's picture through the bib's own picture rules (`storedPicture`, `storedCrop`, the crop drawn by
 * `bib-picture-frame.ts`'s rule), the club's logo as its file draws it — blue on its own white ground,
 * never recoloured — and a stamp in every picture's address (`badgePictureStamp`).
 *
 * **No name is printed, and no person's data reaches a badge.** A badge is a strip — about 90 × 35 mm,
 * or 100 × 40 mm, or the club's own size — with the header band, «VOLUNTAR», the role on its coloured
 * band, and a white area where the name is written in marker at the desk. It is printed per role, so
 * the PDF carries the club's words and the roles' names, never a volunteer.
 *
 * Pure, importing only the palette and pure modules. The sizes live in `badge-geometry.ts`, which the
 * client's preview island reads without this schema.
 */

/** The longest short title, «VOLUNTAR» word and telephone label the club may type. */
export const BADGE_TITLE_MAX = 60;
export const BADGE_LABEL_MAX = 24;
export const BADGE_PHONE_LABEL_MAX = 30;

/**
 * The header band's colour as stored: a hex triplet, lower case, that carries its words at AA — or null
 * for the club's blue. A colour no word reads on (an imported file, a column written by hand) reads as
 * null, so it never prints and a save never "changes" it without the person touching it.
 */
const hexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase())
  .nullable()
  .catch(null)
  .transform((value) => (value !== null && badgeColourReadable(value) ? value : null));

/** One line of the club's text, as the bib keeps its own lines (§317): what the font can draw, cut at `max`. */
const line = (max: number) =>
  z
    .string()
    .transform((value) => bibFooterText(value, max))
    .catch("");

const millimetres = (bounds: { min: number; max: number }, fallback: number) => z.number().int().min(bounds.min).max(bounds.max).catch(fallback);

export const badgeDesignSchema = z
  .object({
    /** «Dimensiunea»: a preset strip, or `custom` with the two numbers below. */
    size: z.enum(BADGE_SIZES).catch("strip90"),
    customWidthMm: millimetres(BADGE_CUSTOM_BOUNDS.width, BADGE_SIZE_PRESETS.strip90.widthMm),
    customHeightMm: millimetres(BADGE_CUSTOM_BOUNDS.height, BADGE_SIZE_PRESETS.strip90.heightMm),
    /** The header band's colour from the bib's palette, or null for the club's blue. */
    bandColour: hexColour,
    /** A picture across the header instead of the colour, one this site stored, and its crop. */
    headerImageSrc: storedPicture,
    headerImageCrop: storedCrop,
    /** The club's logo at the band's left, on its own white ground (§664's plate). */
    showLogo: z.boolean().catch(true),
    /** The event's short title at the band's right: the club's, or the event's title. */
    showTitle: z.boolean().catch(true),
    titleRo: line(BADGE_TITLE_MAX),
    titleEn: line(BADGE_TITLE_MAX),
    /** «VOLUNTAR» / «VOLUNTEER», as the club types it; empty in both is the platform's words. */
    labelRo: line(BADGE_LABEL_MAX),
    labelEn: line(BADGE_LABEL_MAX),
    /** One faint line across the writing area, for the marker. */
    writingLine: z.boolean().catch(true),
    /** «Telefon coordonator»: the tick, the number (the bib's own check), and its label in both languages. */
    showPhone: z.boolean().catch(false),
    phone: z.string().transform(bibEmergencyPhone).catch(""),
    phoneLabelRo: line(BADGE_PHONE_LABEL_MAX),
    phoneLabelEn: line(BADGE_PHONE_LABEL_MAX),
    /** Solid marks in the page's margin at each cut, besides the dashed lines every sheet has. */
    cutMarks: z.boolean().catch(true),
  })
  .strict()
  // A crop belongs to its picture (§560): none without one.
  .transform((design) => ({ ...design, headerImageCrop: design.headerImageSrc ? design.headerImageCrop : null }));

export type BadgeDesign = z.infer<typeof badgeDesignSchema>;

export const DEFAULT_BADGE_DESIGN: BadgeDesign = {
  size: "strip90",
  customWidthMm: BADGE_SIZE_PRESETS.strip90.widthMm,
  customHeightMm: BADGE_SIZE_PRESETS.strip90.heightMm,
  bandColour: null,
  headerImageSrc: null,
  headerImageCrop: null,
  showLogo: true,
  showTitle: true,
  titleRo: "",
  titleEn: "",
  labelRo: "",
  labelEn: "",
  writingLine: true,
  showPhone: false,
  phone: "",
  phoneLabelRo: "",
  phoneLabelEn: "",
  cutMarks: true,
};

/**
 * Whatever is stored, read as a design — never a throw (the bib's `readBibDesign`, §317): only the keys
 * this release knows, each falling back on its own, and anything that is not an object the platform's.
 */
export function readBadgeDesign(value: unknown): BadgeDesign {
  const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  const known = Object.fromEntries(Object.keys(DEFAULT_BADGE_DESIGN).filter((key) => key in stored).map((key) => [key, stored[key]]));
  const parsed = badgeDesignSchema.safeParse({ ...DEFAULT_BADGE_DESIGN, ...known });
  return parsed.success ? parsed.data : DEFAULT_BADGE_DESIGN;
}

/** The unsaved design the preview's address carries, read as the save reads it — field by field. */
export function badgeDesignFromQuery(params: URLSearchParams): BadgeDesign {
  return readBadgeDesign(badgeDesignValuesFromQuery(params));
}

// --- Colours ---------------------------------------------------------------------------------

/** The header band when the club chose none: the club's blue, as the bib's band (§173). */
export const BADGE_BAND_FALLBACK = BIB_BAND_FALLBACK;

/**
 * A role's band when the role has no colour of its own — «Portocaliul clubului»: the kit's orange, which
 * carries the body ink at 6.2 : 1 and is never the header's blue, so the role reads apart from the band
 * above it. The badges «fără rol» wear it too, with «VOLUNTAR» alone on it.
 */
export const BADGE_ROLE_FALLBACK = COLOR.orange;

const isHex = (value: string | null | undefined): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** The text a band carries: white or the body ink, whichever reads better on it. */
export function badgeTextOn(colour: string): string {
  const band = isHex(colour) ? colour : BADGE_ROLE_FALLBACK;
  return contrastRatio(COLOR.surface, band) >= contrastRatio(COLOR.ink, band) ? COLOR.surface : COLOR.ink;
}

/** Whether a colour carries its text at AA (4.5 : 1): what a role's typed colour must do before it is saved. */
export function badgeColourReadable(colour: string): boolean {
  return isHex(colour) && contrastRatio(badgeTextOn(colour), colour) >= MIN_TEXT_CONTRAST;
}

/** The header band's colour: the design's own when it reads at AA (checked again, as a role's is), else the club's blue. */
export function badgeBandColour(design: Pick<BadgeDesign, "bandColour">): string {
  return isHex(design.bandColour) && badgeColourReadable(design.bandColour) ? design.bandColour.toLowerCase() : BADGE_BAND_FALLBACK;
}

/**
 * A role's band colour: its own when it is a hex that reads at AA (a stored colour is checked again, so a
 * row written by hand never prints unreadable words), else the club's orange.
 */
export function badgeRoleColour(colour: string | null | undefined): string {
  return isHex(colour) && badgeColourReadable(colour) ? colour.toLowerCase() : BADGE_ROLE_FALLBACK;
}

// --- Words -----------------------------------------------------------------------------------

export type BadgeLocale = "ro" | "en";

/** The platform's words, in the badge's language, when the club typed none: from the catalogue, by the caller. */
export type BadgeDefaultWords = { label: string; name: string; phoneLabel: string };

/** What one badge prints, words only: everything the renderers need besides the design's look. */
export type BadgeWords = {
  /** The event's short title, or null when the design hides it or there is none. */
  title: string | null;
  /** «VOLUNTAR» — the club's, else the platform's. */
  label: string;
  /** «Nume:», the writing area's label. */
  name: string;
  /** «Coordonator: 07xx xxx xxx», or null while the tick is off or no valid number was typed. */
  phone: string | null;
  /** The telephone's label in the badge's language — the club's, else the platform's — kept so a role's own number can take it (`badgePhoneLine`). */
  phoneLabel?: string;
};

/**
 * The words of the badges of one language: the club's short title in it (else the event's title), its
 * «VOLUNTAR» (else the platform's), and the coordinator's line. The two languages of a club text are
 * both or neither (§352): the save refuses one alone, so a stored pair is read as it stands.
 */
export function badgeWords(design: BadgeDesign, locale: BadgeLocale, eventTitle: string, defaults: BadgeDefaultWords): BadgeWords {
  const pick = (ro: string, en: string) => (locale === "en" ? en : ro);
  const title = design.showTitle ? pick(design.titleRo, design.titleEn) || bibFooterText(eventTitle, 120) || null : null;
  const label = pick(design.labelRo, design.labelEn) || defaults.label;
  const phoneLabel = pick(design.phoneLabelRo, design.phoneLabelEn) || defaults.phoneLabel;
  const phone = design.showPhone && design.phone ? (phoneLabel ? `${phoneLabel}: ${design.phone}` : design.phone) : null;
  return { title, label, name: defaults.name, phone, phoneLabel };
}

/**
 * The coordinator's line of one role's badge (§774; the owner, 2026-10-14: «trebuie să fie o persoană de contact pentru voluntari»):
 * the design's own number when the club typed one — the same for every role —, else, while «Telefonul coordonatorului» is ticked and
 * the design leaves the number empty, the telephone of the contact person of the role's category, with the same label; none when the
 * role sits under no category or its category has no valid number. Never anything while the tick is off.
 */
export function badgePhoneLine(design: Pick<BadgeDesign, "showPhone" | "phone">, words: Pick<BadgeWords, "phone" | "phoneLabel">, categoryPhone: string | null | undefined): string | null {
  // The design's own number, already worded with its label (`badgeWords`, null while the tick is off); else the category's.
  if (words.phone !== null) return words.phone;
  if (!design.showPhone) return null;
  // Read as a person reads it («+40 712 345 678»), as the public page does; the design's own number is printed as the club typed it.
  const number = categoryPhone ? formatPhone(bibEmergencyPhone(categoryPhone)) : "";
  if (number === "") return null;
  return words.phoneLabel ? `${words.phoneLabel}: ${number}` : number;
}

/** A role's name as the band prints it: one line the font can draw, in capitals in the badge's language (ș stays ș). */
export function badgeRoleText(name: string, locale: BadgeLocale): string {
  return bibFooterText(name, 80).toLocaleUpperCase(locale);
}

/** «VOLUNTAR» as printed: in capitals, in the badge's language's own casing. */
export function badgeLabelText(label: string, locale: BadgeLocale): string {
  return bibFooterText(label, BADGE_LABEL_MAX).toLocaleUpperCase(locale);
}

// --- The stamp -------------------------------------------------------------------------------

/**
 * The version of the badge's drawing: raised whenever the renderers draw the same design differently,
 * so every stamped address changes with it — the bib's `BIB_DRAWING_VERSION`, for the badge.
 */
export const BADGE_DRAWING_VERSION = 1;

/**
 * A short, stable stamp of what a badge's picture is drawn from (the bib's §748): the design, the role's
 * name and colour, the title — in the address (`v=`), so a change is a new address and the browser's
 * hour of cache never shows the old badge. A change detector, no security claim.
 */
export function badgePictureStamp(parts: unknown): string {
  return fnv1a(JSON.stringify([BADGE_DRAWING_VERSION, parts]) ?? "");
}
