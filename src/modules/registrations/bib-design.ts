import { COLOR } from "@/theme/brand";

/**
 * What a race number looks like, decided once for both renderers (`DECISIONS.md` §173, §180).
 *
 * There are two of them — `bibs-pdf.ts` draws the A4 sheet with pdfkit, `bib-image.tsx` draws
 * the 900×600 picture with `next/og` — and they must agree, because the picture is the club's
 * preview of the paper. Anything that is a *decision* rather than a drawing instruction lives
 * here so the two cannot drift: which colour the header band is when the event names none, and
 * what the footer line says.
 *
 * Pure, and importing nothing but the palette: no `node:` builtin, no pdfkit, no React. That
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
 * The thin line along the bottom: who is putting the race on, and where to write.
 *
 * The partners' names as the club listed them (§168), then the mailbox every email already
 * says to reply to. Names only — a bib is worn in public, and a URL is unreadable at that
 * size anyway.
 *
 * Deliberately **no telephone number**: not the participant's, and above all not their
 * emergency contact. That number is called in an emergency and the privacy notice says so
 * (`AGENTS.md` §19.2); printing it on a garment worn through a town centre publishes it to
 * everyone who passes. There is no organizer hotline field on an event either, so nothing is
 * being left out here that the club has ever entered.
 */
export function bibFooterLine(partners: readonly string[], replyTo?: string | null): string {
  return [...partners.map((name) => name.trim()).filter(Boolean), replyTo?.trim()]
    .filter((part): part is string => Boolean(part))
    .join("  ·  ");
}
