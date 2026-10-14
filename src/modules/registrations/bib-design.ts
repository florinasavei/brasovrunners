import { z } from "zod";
import { imageCropSchema, meaningfulCrop } from "@/modules/content/rich-text/domain/schema";
import { contrastRatio, MIN_TEXT_CONTRAST } from "@/modules/appearance/domain/tint-contrast";
import { COLOR, GRADIENT } from "@/theme/brand";
import { isPhoneNumberShaped } from "@/modules/contact/domain/public-phone";
import { bibDesignValuesFromQuery } from "./bib-design-query";
import { bibFooterText } from "./bib-footer";
import { BIB_MEMBER_MARKS } from "./bib-member-mark";
import { RACE_NUMBER_FORMATS } from "./domain/race-number";

/**
 * What a race number looks like, decided once for both renderers (`DECISIONS.md` §173, §180).
 *
 * There are two of them — `bibs-pdf.ts` draws the A5 bibs two to an A4 page with pdfkit,
 * `bib-image.tsx` draws the 990×700 picture of one with `next/og` — and they must agree, because
 * the picture is the club's preview of the paper. Anything that is a *decision* rather than a
 * drawing instruction lives here so the two cannot drift: which colour the header band is when
 * the event names none, and what the club chose to print. What the footer says and how it breaks
 * into lines is `bib-footer.ts`, the same kind of decision with a font table of its own (§317);
 * where everything sits on the A5 paper is `bib-geometry.ts` (§338).
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
 * `numberScaleFactor` is, and it is why the preview on the screen is the paper. Since the bib
 * became an A5 sheet (§338) the picture's base sizes are the sheet's, in points, times
 * `BIB_IMAGE_SCALE` (`bib-geometry.ts`), so the two multiply the same numbers.
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

/**
 * The part of a picture a place shows (§560): §241's four fractions of the photograph — the same
 * crop a picture in a text and a card of «Echipa» store — or null for none. Stored as an object;
 * posted by the form and carried by the preview's address as its JSON, read the same here. The
 * whole photograph is no crop (`meaningfulCrop`), and anything malformed reads as none, never a
 * bib that fails to print.
 */
const storedCrop = z
  .preprocess((value) => {
    if (typeof value !== "string") return value;
    if (value.trim() === "") return null;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }, imageCropSchema.nullable())
  .transform((crop) => meaningfulCrop(crop))
  .catch(null);

/**
 * The members' race number (§664; the owner, 2026-10-04: «I want BVR members to have an optional
 * special BiBs, with a special design»).
 *
 * The same bib in every other way — the number from the same band in the same order (§173), the
 * name, the number's size, the small print, the sponsors, the cut marks: the event's one design —
 * with its own header and one short line on it. The header is a band colour or a stored picture
 * with its crop, exactly the choices the main header offers (§249, §560); with neither, the event's
 * band colour. The label is plain text like the footer's own line (§317), at most
 * `BIB_MEMBER_LABEL_MAX` characters; empty prints the platform's words in the sheet's language
 * («Membru {club}», `Admin.bibs.memberLabelDefault`).
 *
 * Who wears it is not decided here: a registration that asked for it and whose address is a member
 * account's (`bibs.ts#listBibs`). Stored inside `events.bib_design`, so no migration; a design
 * saved before this key existed reads as off and prints as it did.
 */
export const BIB_MEMBER_LABEL_MAX = 24;

/** A colour for the members' header: a hex triplet, or null for "none of its own". */
const memberColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i)
  .transform((value) => value.toLowerCase())
  .nullable()
  .catch(null);

/**
 * How a member's bib differs (§NNN, amending §664; the owner, 2026-10-10: «I do not like the BIB
 * designer of the BVR members, I need a different design for them, different background»):
 *
 * - `band` — «Același fundal ca restul numerelor — doar antet propriu»: §664's look, the members' header and a small label on it.
 * - `card` — «Tot numărul»: the whole card above the small print is the members' background — a
 *   photograph under the navy veil, one of the bib colours that carries white at AA, or the club
 *   kit's gradient — with the number, the name, the race and the lockup in white and the label a
 *   stripe in the kit's orange (`bibMemberCard`).
 *
 * A design saved before this key existed reads as `band` and prints as it did; the editor offers
 * `card` first to a club that has not switched the members' bib on yet.
 */
export const BIB_MEMBER_STYLES = ["card", "band"] as const;
export type BibMemberStyle = (typeof BIB_MEMBER_STYLES)[number];

export const bibMemberSchema = z
  .object({
    /** «Membrii primesc un număr cu design propriu». */
    enabled: z.boolean().catch(false),
    /** «Fundalul»: the whole card, or the header alone (§NNN). */
    style: z.enum(BIB_MEMBER_STYLES).catch("band"),
    /** The members' band colour, or null for the event's. */
    bandColour: memberColour,
    /** A picture across the top instead of a band, one this site stored (§249). */
    headerImageSrc: storedPicture,
    /** Its crop in the header's shape (§560); none without a picture. */
    headerImageCrop: storedCrop,
    /** «Tot numărul»'s photograph (§NNN), one this site stored, under the navy veil. */
    cardImageSrc: storedPicture,
    /** Its crop in the card's shape (`bib-picture-frame.ts`, `memberCard`); none without a picture. */
    cardImageCrop: storedCrop,
    /** «Eticheta»: the short line on the member's band; empty is the platform's own words. */
    label: z
      .string()
      .transform((value) => bibFooterText(value, BIB_MEMBER_LABEL_MAX))
      .catch(""),
    /** «Semn de membru pe număr» (§750): a mark on every member's number; off until the club ticks it. */
    mark: z.boolean().catch(false),
    /**
     * «Semnul de membru» (§NNN, amending §750): which mark — «Steluță» by default, the club's logo, or one
     * of the registry's glyphs (`bib-member-mark.ts`). A design saved before this key existed reads `star`:
     * a member's number that carried §750's ring and check carries a star now (`BIB_DRAWING_VERSION` 3).
     */
    markShape: z.enum(BIB_MEMBER_MARKS).catch("star"),
  })
  .strict()
  // A crop belongs to its picture (§560), here as in the main header.
  .transform((member) => ({
    ...member,
    headerImageCrop: member.headerImageSrc ? member.headerImageCrop : null,
    cardImageCrop: member.cardImageSrc ? member.cardImageCrop : null,
  }));

export type BibMemberDesign = z.infer<typeof bibMemberSchema>;

export const DEFAULT_BIB_MEMBER_DESIGN: BibMemberDesign = {
  enabled: false,
  style: "band",
  bandColour: null,
  headerImageSrc: null,
  headerImageCrop: null,
  cardImageSrc: null,
  cardImageCrop: null,
  label: "",
  mark: false,
  markShape: "star",
};

/**
 * The members' object as stored or posted, never a throw: only the keys this release knows are
 * read (a later release's key is ignored, as `readBibDesign` does for the whole design, §317), each
 * falls back on its own, and anything that is not an object reads as off.
 */
export function readBibMemberDesign(value: unknown): BibMemberDesign {
  const stored: Record<string, unknown> = typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
  const known = Object.fromEntries(Object.keys(DEFAULT_BIB_MEMBER_DESIGN).filter((key) => key in stored).map((key) => [key, stored[key]]));
  const parsed = bibMemberSchema.safeParse({ ...DEFAULT_BIB_MEMBER_DESIGN, ...known });
  return parsed.success ? parsed.data : DEFAULT_BIB_MEMBER_DESIGN;
}

/** Absent — every design saved before §664 — or malformed, the members' bib is off. */
const bibMemberSchemaWithDefault = z.unknown().optional().transform((value) => readBibMemberDesign(value));

/** The line printed on a member's band: the club's, or the platform's words when it typed none. */
export function bibMemberLabel(member: BibMemberDesign, fallback: string): string {
  return member.label || bibFooterText(fallback, BIB_MEMBER_LABEL_MAX);
}

/**
 * The band colour of a member's bib when no members' picture is drawn (§664): the members' own
 * colour, else the event's band — never the event's picture, so a member's bib never passes for
 * the ordinary one, and a members' picture that could not be fetched never fails the sheet.
 */
export function bibMemberBandColour(member: BibMemberDesign, eventColour: string | null | undefined): string {
  return member.bandColour ?? bibBandColour(eventColour);
}

/**
 * «Tot numărul»'s fixed parts (§NNN): what the club cannot change, so every members' card is the
 * club's whatever the event. The words on the background are white (`COLOR.surface`); the stripe is
 * the kit's orange with the body ink on it (6.2 : 1); the photograph lies under the kit's deepest
 * navy at `veil` opacity — at 0.7 white still reads at 6 : 1 over a pure-white photograph, which
 * `member-bib-card.test.ts` computes rather than trusts. The gradient is the kit's own ramp
 * (`GRADIENT`, `theme/brand.ts`), its first two stops, top to bottom, the way the shirt is worn: the
 * third, the cyan by the hem, carries white at under 3 : 1, so the number never stands on it.
 */
export const BIB_MEMBER_CARD = {
  text: COLOR.surface,
  stripe: COLOR.orange,
  stripeText: COLOR.ink,
  veil: GRADIENT.deep,
  veilOpacity: 0.7,
  gradient: [GRADIENT.deep, GRADIENT.mid],
} as const;

/** Whether white reads at AA on a colour — what a members' card colour must do (§NNN). */
export function bibMemberCardColourReadable(colour: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(colour) && contrastRatio(BIB_MEMBER_CARD.text, colour) >= MIN_TEXT_CONTRAST;
}

/**
 * The background of a member's bib drawn «Tot numărul» (§NNN), in the order the club's choices win:
 * the photograph the renderer really holds; else the members' colour, when white reads on it at AA
 * (the green and the orange of the bib colours do not, and print the gradient instead — the editor
 * says so); else the kit's gradient, the default. Never the event's own band or picture: a member's
 * bib must not pass for the ordinary one.
 */
export type BibMemberCardBackground =
  | { kind: "picture" }
  | { kind: "colour"; colour: string }
  | { kind: "gradient"; stops: readonly [string, string] };

export function bibMemberCardBackground(member: BibMemberDesign, pictureDrawn: boolean): BibMemberCardBackground {
  if (pictureDrawn) return { kind: "picture" };
  if (member.bandColour && bibMemberCardColourReadable(member.bandColour)) return { kind: "colour", colour: member.bandColour };
  return { kind: "gradient", stops: BIB_MEMBER_CARD.gradient };
}

/** The stripe's words: the label in capitals, in the sheet's language's own casing (ș stays ș). */
export function bibMemberStripeText(label: string, locale = "ro"): string {
  return label.toLocaleUpperCase(locale);
}

/** «Locul benzii cu sponsori» (§750): under the small print, the number's last row, or above it as it was. */
export const BIB_SPONSOR_PLACES = ["bottom", "above"] as const;
export type BibSponsorPlace = (typeof BIB_SPONSOR_PLACES)[number];

/** The longest emergency phone the bib prints: the public phone's own ceiling (§565). */
export const BIB_EMERGENCY_PHONE_MAX = 30;

/**
 * The emergency phone as the bib keeps it (§750): trimmed, runs of spaces made one, and only a value
 * written like a telephone number (`isPhoneNumberShaped`, the check «Telefon public» applies) — anything
 * else reads as none, never a bib that fails to print, like every field here.
 */
export function bibEmergencyPhone(value: string): string {
  const typed = value.trim().replace(/\s+/g, " ");
  return typed.length <= BIB_EMERGENCY_PHONE_MAX && isPhoneNumberShaped(typed) ? typed : "";
}

/**
 * «Eticheta telefonului» (§NNN; the owner, 2026-10-13: «pentru telefon în caz de urgențe trebuie să
 * putem avea și un label»): the word before the numbers, at most this many characters — plain text on
 * one line like the club's footer line and the members' label (§317, §664), one text for every
 * language; empty prints the platform's word in the sheet's language («Urgențe» / "Emergency").
 */
export const BIB_EMERGENCY_LABEL_MAX = 40;

/** Each number's own label (§NNN) — a name or a role, «Coordonator», «Ambulanța traseului» — at most this many characters. */
export const BIB_EMERGENCY_NAME_MAX = 24;

/** The emergency line's words as the design keeps them (§NNN). Absent keys read as none: a design saved before them prints as it did. */
type BibEmergencyDesign = Pick<BibDesign, "showEmergency" | "emergencyPhone"> &
  Partial<Pick<BibDesign, "emergencyLabel" | "emergencyPhoneLabel" | "emergencyPhone2" | "emergencyPhone2Label">>;

/**
 * The line printed on every number (§750, amending it §NNN): «Urgențe: 07xx xxx xxx», or with the club's
 * label and two numbers, each with its own name, «Urgențe: Coordonator 07xx xxx xxx / Medic 07yy yyy yyy» — on
 * one line, as the owner's trail example prints it. `fallback` is the sheet's language's word, used when
 * the club typed no label. Null while the tick is off or no valid number was typed; a second number alone
 * prints alone. The club's organizers' numbers, typed here: never a participant's own emergency contact,
 * which is personal data on a visible bib that the privacy notice does not describe.
 */
export function bibEmergencyLine(design: BibEmergencyDesign, fallback: string): string | null {
  if (!design.showEmergency) return null;
  const numbers = (
    [
      [design.emergencyPhoneLabel ?? "", design.emergencyPhone],
      [design.emergencyPhone2Label ?? "", design.emergencyPhone2 ?? ""],
    ] as const
  )
    .filter(([, phone]) => phone !== "")
    .map(([name, phone]) => (name ? `${name} ${phone}` : phone));
  if (numbers.length === 0) return null;
  const label = design.emergencyLabel || fallback;
  const joined = numbers.join(" / ");
  return label ? `${label}: ${joined}` : joined;
}

/**
 * «Profilul traseului» from where (§NNN; the owner, 2026-10-13: «la profilul traseului pe număr ar trebui
 * să pot alege dacă iau din Strava sau vreau poză»): `gpx` — «Desenat din traseul evenimentului (GPX)», the
 * strip drawn from the route's file (§750), the default — or `picture`, «O poză încărcată», a picture of
 * the profile the club uploads, fitted whole in the same strip. The checkpoints' marks (`bib-checkpoints.ts`) are drawn on
 * the GPX's line only: on a picture the club drew what it wanted.
 */
export const BIB_PROFILE_SOURCES = ["gpx", "picture"] as const;
export type BibProfileSource = (typeof BIB_PROFILE_SOURCES)[number];

/**
 * «Orientarea profilului» (§NNN; the owner: «I should also be able to rotate the race profile»): `normal`,
 * or `turned` — «Întors, ca să-l citească alergătorul», half a circle, with the figures beside it and, when
 * the phone is turned too, the phone with it as one block (`bib-geometry.ts#bibExtrasTurn`).
 */
export const BIB_PROFILE_ORIENTATIONS = ["normal", "turned"] as const;
export type BibProfileOrientation = (typeof BIB_PROFILE_ORIENTATIONS)[number];

/** A phone number's own label, as stored: the footer line's rules (§317), cut at `BIB_EMERGENCY_NAME_MAX`. */
const emergencyName = z
  .string()
  .transform((value) => bibFooterText(value, BIB_EMERGENCY_NAME_MAX))
  .catch("");

/**
 * The distance badge's words (§750; the owner's marathon example): the event's distance in whole
 * kilometres with a K — «21K» for a half marathon — or null when the event has none or it is under half
 * a kilometre. Typed by the club on the event, never read from the GPX: the badge says what the page says.
 */
export function bibDistanceBadge(distanceMeters: number | null | undefined): string | null {
  if (!distanceMeters || !(distanceMeters >= 500)) return null;
  return `${Math.round(distanceMeters / 1000)}K`;
}

export const bibDesignSchema = z
  .object({
    showName: z.boolean().catch(true),
    showEventTitle: z.boolean().catch(true),
    showDate: z.boolean().catch(true),
    showLogo: z.boolean().catch(true),
    numberScale: z.enum(BIB_NUMBER_SCALES).catch("medium"),
    /**
     * «Cum arată numărul» (§735): `plain` (7), `pad3` (007) or `pad4` (0007) — on the bib and
     * everywhere else the number is written (`race-number.ts#formatRaceNumber`). A design saved
     * before this key existed reads `plain` and prints as it did.
     */
    numberFormat: z.enum(RACE_NUMBER_FORMATS).catch("plain"),
    namePosition: z.enum(BIB_NAME_POSITIONS).catch("below"),
    /** A picture across the top instead of the coloured band, or null for the band (§249). */
    headerImageSrc: storedPicture,
    /** A strip of sponsors, or null; where it sits is `sponsorPlace`. */
    sponsorImageSrc: storedPicture,
    /**
     * «Locul benzii cu sponsori» (§750): `bottom` — «Jos de tot, în subsol», the number's last row under
     * the small print, the default for every event (the owner: «ar trebui normal jos de tot») — or
     * `above`, «Deasupra subsolului», where the strip sat until then.
     */
    sponsorPlace: z.enum(BIB_SPONSOR_PLACES).catch("bottom"),
    /**
     * The part of each picture the bib shows (§560), drawn in the place's own shape by
     * `bib-picture-frame.ts`; null draws the picture as every bib did before crops existed.
     */
    headerImageCrop: storedCrop,
    sponsorImageCrop: storedCrop,
    /** Solid guide rules at each end of the cut line, for a club that takes the sheet to a printer. */
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
    footerText: z.string().transform((value) => bibFooterText(value)).catch(""),
    /**
     * «Profilul traseului» (§750): the route's elevation over distance on every number, with the
     * distance and the gain; off by default, and only drawn when the event has a route GPX.
     */
    showProfile: z.boolean().catch(false),
    /** Where the profile comes from (§NNN): the route's GPX, drawn, or the club's picture of it. */
    profileSource: z.enum(BIB_PROFILE_SOURCES).catch("gpx"),
    /** «O poză încărcată»'s picture, one this site stored (§NNN); fitted whole, never cropped. */
    profileImageSrc: storedPicture,
    /**
     * «Arată distanța și diferența de nivel lângă profil» (§NNN): **on by default**, the figures at the
     * strip's right as §750 drew them; off, the chart or the picture takes the strip's whole width (the
     * owner: with his own picture «o să-mi apară mie ce vreau acolo»).
     */
    showProfileFigures: z.boolean().catch(true),
    /** «Orientarea profilului» (§NNN): normal, or turned half a circle for the runner. */
    profileOrientation: z.enum(BIB_PROFILE_ORIENTATIONS).catch("normal"),
    /**
     * «Punctele de control pe profil» (§757): a small mark at each checkpoint's kilometre on the
     * profile's strip, with its cut-off in small type where it fits (`bib-checkpoints.ts`). **On by
     * default**, whatever a design saved before this key says: it draws only when the strip itself is
     * drawn and the event has checkpoints, so ticking «Profilul traseului» on an event with
     * checkpoints shows them without a second tick.
     */
    showCheckpoints: z.boolean().catch(true),
    /**
     * «…cu orele limită» (§757): beside each checkpoint on the strip, its cut-off — «km 12 · 11:30» —
     * where **every** one fits (the crowding rule, `bib-checkpoints.ts`). Off by default: a time printed
     * on a number is a promise the club cannot change after the sheet is printed.
     */
    showCheckpointTimes: z.boolean().catch(false),
    /** «Telefon pentru urgențe» (§750): the tick, and the number the club types (`bibEmergencyPhone`). */
    showEmergency: z.boolean().catch(false),
    emergencyPhone: z.string().transform(bibEmergencyPhone).catch(""),
    /** «Eticheta telefonului» (§NNN): the word before the numbers; empty is the sheet's language's own. */
    emergencyLabel: z
      .string()
      .transform((value) => bibFooterText(value, BIB_EMERGENCY_LABEL_MAX))
      .catch(""),
    /** The first number's own label (§NNN), a name or a role; empty prints the number alone. */
    emergencyPhoneLabel: emergencyName,
    /** A second number (§NNN), checked as the first is, with its own label; empty prints one number. */
    emergencyPhone2: z.string().transform(bibEmergencyPhone).catch(""),
    emergencyPhone2Label: emergencyName,
    /** «Tipărit invers» (§750): the phone printed upside down, to be read looking down at the chest; on by default, the trail practice. */
    emergencyUpsideDown: z.boolean().catch(true),
    /** «Distanța pe număr» (§750): the event's distance as a badge in the header's right corner («21K»). */
    showDistance: z.boolean().catch(false),
    /** «Numărul și pe capete» (§750): the number again, small, at both ends of the sponsors' row — tear-off stubs. */
    numberStubs: z.boolean().catch(false),
    /** The members' race number (§664): off, or the members' own header and label. */
    member: bibMemberSchemaWithDefault,
  })
  .strict()
  // A crop belongs to its picture: none without one (§560), whether saved or read.
  .transform((design) => ({
    ...design,
    headerImageCrop: design.headerImageSrc ? design.headerImageCrop : null,
    sponsorImageCrop: design.sponsorImageSrc ? design.sponsorImageCrop : null,
  }));

export type BibDesign = z.infer<typeof bibDesignSchema>;

export const DEFAULT_BIB_DESIGN: BibDesign = {
  showName: true,
  showEventTitle: true,
  showDate: true,
  showLogo: true,
  numberScale: "medium",
  numberFormat: "plain",
  namePosition: "below",
  headerImageSrc: null,
  sponsorImageSrc: null,
  sponsorPlace: "bottom",
  headerImageCrop: null,
  sponsorImageCrop: null,
  cutMarks: false,
  showEmail: true,
  showPartners: true,
  showEventInFooter: false,
  showWebsite: false,
  footerText: "",
  showProfile: false,
  profileSource: "gpx",
  profileImageSrc: null,
  showProfileFigures: true,
  profileOrientation: "normal",
  showCheckpoints: true,
  showCheckpointTimes: false,
  showEmergency: false,
  emergencyPhone: "",
  emergencyLabel: "",
  emergencyPhoneLabel: "",
  emergencyPhone2: "",
  emergencyPhone2Label: "",
  emergencyUpsideDown: true,
  showDistance: false,
  numberStubs: false,
  member: DEFAULT_BIB_MEMBER_DESIGN,
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
