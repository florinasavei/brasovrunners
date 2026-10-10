/**
 * What the members' zone says after «Comandă» or «Anulează comanda» (§683): one code in the address
 * (`?shop=`), a closed set read strictly — anything else is nothing — and turned into a sentence by
 * the page (`Members.shop.outcome.<code>`). Never a name, a note or a number in the URL.
 */
export const SHOP_OUTCOMES = ["placed", "cancelled", "NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "FORBIDDEN"] as const;
export type ShopOutcome = (typeof SHOP_OUTCOMES)[number];

export function readShopOutcome(value: string | string[] | undefined): ShopOutcome | null {
  const one = Array.isArray(value) ? value[0] : value;
  return (SHOP_OUTCOMES as readonly string[]).includes(one ?? "") ? (one as ShopOutcome) : null;
}

/** Whether the answer belongs in «Comenzile mele» (`?shopAt=orders`): a placed order, or any answer to a cancel. */
export function readShopOutcomeAtOrders(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "orders";
}
