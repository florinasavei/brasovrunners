import { z } from "zod";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";

/**
 * What the club types for one card of «Echipa» (§NNN).
 *
 * A name, required. What the person does for the club, and a few words about them — each
 * Romanian **and** English, or neither (§352): one side written and the other empty is refused
 * on the empty box, every other box kept (§315). A photograph, by the id of the picture the
 * upload stored (`/api/admin/media`), or none.
 */

export const TEAM_NAME_MAX = 80;
export const TEAM_ROLE_MAX = 80;
export const TEAM_BIO_MAX = 800;
export const TEAM_LINK_MAX = 300;

/**
 * The one link a card may carry (a Strava profile, an Instagram page): an `https://` address with
 * a host, or nothing. Anything else — `http:`, `javascript:`, a bare word — is refused on the box,
 * so the public card never renders an address the browser would run or downgrade.
 */
export function isHttpsLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * A box's text as the card keeps it: trimmed, Windows line breaks made one, and never more than
 * one empty line in a row — a short paragraph or two, not a layout. Done before the limit is
 * counted, so a textarea the browser allowed at `maxLength` (it counts a line break as one
 * character, and posts two) is never refused over the difference (§352's reasoning).
 */
export function normalizeTeamText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const optionalText = (max: number) =>
  z
    .string()
    .transform(normalizeTeamText)
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

export const teamMemberFieldsSchema = z
  .object({
    name: z.string().transform(normalizeTeamText).pipe(z.string().min(1).max(TEAM_NAME_MAX).regex(/^[^\n]*$/)),
    roleRo: optionalText(TEAM_ROLE_MAX),
    roleEn: optionalText(TEAM_ROLE_MAX),
    bioRo: optionalText(TEAM_BIO_MAX),
    bioEn: optionalText(TEAM_BIO_MAX),
    /** One optional `https://` link — Strava, Instagram — the same in both languages. */
    link: z
      .string()
      // Absent reads as empty: a form that predates the box, or a test, posts no link at all.
      .default("")
      .transform((value) => value.trim())
      .pipe(z.string()
      .max(TEAM_LINK_MAX)
      .refine((value) => value === "" || isHttpsLink(value), "not an https link"))
      .transform((value) => (value === "" ? null : value)),
    /** The stored picture's id, or empty for a card without a photo. */
    photoAssetId: z
      .string()
      .trim()
      .refine((value) => value === "" || isUuid(value), "not a picture id")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
  })
  .superRefine((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.roleRo, en: fields.roleEn }, { ro: ["roleRo"], en: ["roleEn"] }, "the role");
    refuseOneLanguage(ctx, { ro: fields.bioRo, en: fields.bioEn }, { ro: ["bioRo"], en: ["bioEn"] }, "the description");
  });

export type TeamMemberFields = z.infer<typeof teamMemberFieldsSchema>;

/** The field names the form posts, in the order the refusal summary lists them. */
export const TEAM_MEMBER_FIELDS = ["name", "roleRo", "roleEn", "bioRo", "bioEn", "link", "photoAssetId"] as const;
