import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{promotionalMaterials}}` becomes (§NNN): the register form's own box,
 * quoted, in that language — „Vreau să primesc materiale promoționale de la club și de la partenerii
 * lui” — read from the catalogue the form reads, so the approved sentence names exactly the box a
 * person ticks. Outside a request, like `list-socials-words.ts`, for the legal pages, the
 * declaration, the signed PDF and the legal editor's token legend.
 */
export function promotionalMaterialsClause(locale: string): string {
  return locale === "en" ? `“${en.Registration.promo.label}”` : `„${ro.Registration.promo.label}”`;
}

/** The notice's merge value, beside the list's socials on the legal pages. */
export function promotionalMaterialsMergeValues(locale: string): { promotionalMaterials: string } {
  return { promotionalMaterials: promotionalMaterialsClause(locale) };
}
