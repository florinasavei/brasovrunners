import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";

/**
 * What the privacy notice's `{{membersShop}}` becomes (§683): the shop section's own name in the
 * members' zone, quoted, in that language — „Magazinul clubului” / “The club's shop” — read from the
 * catalogue the section's heading reads (`Members.shop.title`), so the approved sentence names what a
 * member sees. Outside a request, like `feedback/notice-words.ts`, for the legal pages, the declaration
 * and the token legend.
 */
export function membersShopClause(locale: string): string {
  return locale === "en" ? `“${en.Members.shop.title}”` : `„${ro.Members.shop.title}”`;
}

/** The notice's merge value, beside the feedback forms' on the legal pages. */
export function membersShopMergeValues(locale: string): { membersShop: string } {
  return { membersShop: membersShopClause(locale) };
}
