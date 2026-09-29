import { createTranslator } from "next-intl";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * The register form's own box, in that language, with the club's name filled in from the one
 * constant the site's name comes from (`CLUB_NAME`, §215) — «Vreau să primesc oferte și beneficii
 * de la Brașov Runners și partenerii săi.» (§NNN; the owner's words, 2026-09-29 16:12). Outside a
 * request, like `calendar-labels.ts`: the same message resolution the form's `t()` makes.
 */
export function promotionalMaterialsLabel(locale: string, club: string = CLUB_NAME): string {
  const words = createTranslator({ locale: locale === "en" ? "en" : "ro", messages: locale === "en" ? en : ro, namespace: "Registration" });
  return words("promo.label", { club });
}

/**
 * What the privacy notice's `{{promotionalMaterials}}` becomes (§NNN): the box's own label, quoted,
 * read from the catalogue the form reads, so the approved sentence names exactly the box a person
 * ticks. Outside a request, like `list-socials-words.ts`, for the legal pages, the declaration and
 * the signed PDF. `club` is the constant everywhere but the legal editor's token legend, whose
 * examples never name the club (§369): it passes a plain «club».
 */
export function promotionalMaterialsClause(locale: string, club: string = CLUB_NAME): string {
  const label = promotionalMaterialsLabel(locale, club);
  return locale === "en" ? `“${label}”` : `„${label}”`;
}

/** The notice's merge value, beside the list's socials on the legal pages. */
export function promotionalMaterialsMergeValues(locale: string): { promotionalMaterials: string } {
  return { promotionalMaterials: promotionalMaterialsClause(locale) };
}
