import { createTranslator } from "next-intl";
import { CLUB_NAME } from "@/theme/brand";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * The register form's own box, in that language, with the club's name filled in from the one
 * constant the site's name comes from (`CLUB_NAME`, §215) — «Vreau să primesc oferte și beneficii
 * de la Brașov Runners și partenerii săi.» (§562; the owner's words, 2026-09-29 16:12). Outside a
 * request, like `calendar-labels.ts`: the same message resolution the form's `t()` makes.
 */
export function promotionalMaterialsLabel(locale: string, club: string = CLUB_NAME): string {
  const words = createTranslator({ locale: locale === "en" ? "en" : "ro", messages: locale === "en" ? en : ro, namespace: "Registration" });
  return words("promo.label", { club });
}

/**
 * What the privacy notice's `{{promotionalMaterials}}` becomes (§562): the box's own label, quoted,
 * read from the catalogue the form reads, so the approved sentence names exactly the box a person
 * ticks. Outside a request, like `list-socials-words.ts`, for the legal pages, the declaration and
 * the signed PDF. `club` is the constant everywhere but the legal editor's token legend, whose
 * examples never name the club (§369): it passes a plain «club».
 */
export function promotionalMaterialsClause(locale: string, club: string = CLUB_NAME): string {
  const label = promotionalMaterialsLabel(locale, club);
  return locale === "en" ? `“${label}”` : `„${label}”`;
}

/**
 * What the privacy notice's `{{promotionalMaterialsShared}}` becomes (§NNN): the three data the
 * sponsor list gives a partner, in words — «prenumele, numele și adresa ta de e-mail» / “your first
 * name, last name and email address” — read from the catalogue beside the list's own columns
 * (`Registration.promo.sharedData`), so the approved sentence names exactly what the file carries.
 */
export function promotionalMaterialsSharedClause(locale: string): string {
  const words = createTranslator({ locale: locale === "en" ? "en" : "ro", messages: locale === "en" ? en : ro, namespace: "Registration" });
  return words("promo.sharedData");
}

/** The notice's merge values, beside the list's socials on the legal pages: the box, and what a partner may receive. */
export function promotionalMaterialsMergeValues(locale: string): { promotionalMaterials: string; promotionalMaterialsShared: string } {
  return { promotionalMaterials: promotionalMaterialsClause(locale), promotionalMaterialsShared: promotionalMaterialsSharedClause(locale) };
}
