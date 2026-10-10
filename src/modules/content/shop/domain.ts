import type { ShopOrderStatus } from "@/db/schema/shop";

/**
 * The members' shop (§683), pure: the price in words, an order's total, what an order does to a
 * stock, and which status may follow which. No database, no request — the service asserts each of
 * these again on the server, under the row's lock (`orders.ts`), and the screens only read them.
 */

/** At most five of one product in one order; a member who wants more orders twice. */
export const ORDER_QUANTITY_MAX = 5;
/** What a member may write with an order. */
export const ORDER_NOTE_MAX = 300;
/**
 * How long an identical order — the same member, variant, quantity and note, not cancelled — counts as
 * the same press (§683): a double tap, or a form sent again, answers with the order already placed and
 * takes nothing twice. A member who wants the same thing twice orders again after this.
 */
export const ORDER_REPEAT_WINDOW_MS = 10_000;
/**
 * The currencies a shop price may be in (§NNN; the owner, 2026-10-10: the supplier prices the
 * shirts in euro, and members read «EUR, shown as EUR»): lei or euro, chosen per product, shown as
 * such everywhere, never converted — no rate, no sum charged (§683). An order copies the product's
 * currency with its unit price. The database keeps the same two letters, under a CHECK.
 */
export const SHOP_CURRENCIES = ["RON", "EUR"] as const;
export type ShopCurrency = (typeof SHOP_CURRENCIES)[number];
/** A price above this is a typo, not a t-shirt: 100 000 lei or euro, in the minor unit. */
export const PRICE_BANI_MAX = 10_000_000;
/** The most variants a product offers, and the longest label one has. */
export const VARIANTS_MAX = 20;
export const VARIANT_LABEL_MAX = 20;
/** The largest stock a box takes. */
export const STOCK_MAX = 100_000;

/**
 * A price as people read it, in its own currency (§NNN), the minor part only when there is one:
 * in lei «45 lei», «45,50 lei» (ro) and «45.50 lei» (en); in euro «30 €», «30,25 €» (ro, a no-break
 * space before the sign) and «€30», «€30.25» (en). The whole part is grouped the locale's way. The
 * one place a currency symbol is written: nothing else formats a shop price.
 */
export function formatPrice(minor: number, currency: ShopCurrency, locale: string): string {
  const en = locale === "en";
  const whole = new Intl.NumberFormat(en ? "en-GB" : "ro-RO", { maximumFractionDigits: 0, useGrouping: true }).format(Math.trunc(minor / 100));
  const rest = Math.abs(minor % 100);
  const amount = rest === 0 ? whole : `${whole}${en ? "." : ","}${String(rest).padStart(2, "0")}`;
  if (currency === "EUR") return en ? `€${amount}` : `${amount}\u00A0€`;
  return `${amount} lei`;
}

/**
 * The price typed in the editor, back into the minor unit: «45», «45,5», «45.50», «45 lei», «30.25 €»,
 * «30 eur». A trailing currency word is dropped whatever it says — the currency is the select's, not
 * the box's. Null for anything else.
 */
export function parsePriceToMinor(typed: string): number | null {
  const cleaned = typed
    .trim()
    .replace(/\s*(?:lei|euro|eur|€)$/i, "")
    .replace(/\s+/g, "");
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return minor <= PRICE_BANI_MAX ? minor : null;
}

/** The price as the editor's box shows it again: «45» or «45,50», whatever the currency. */
export function minorAsTyped(minor: number): string {
  const rest = minor % 100;
  return rest === 0 ? String(minor / 100) : `${Math.trunc(minor / 100)},${String(rest).padStart(2, "0")}`;
}

/** An order's total, in the minor unit of the order's currency: the unit price copied at the order, times the quantity. */
export function orderTotalBani(order: { unitPriceBani: number; quantity: number }): number {
  return order.unitPriceBani * order.quantity;
}

/**
 * What an order of `quantity` leaves of a variant's stock: the new count; `null` when the variant
 * has no limit (nothing is taken); or `"insufficient"` when fewer are left than asked — the order is
 * refused whole, never filled in part.
 */
export function stockAfterOrder(stock: number | null, quantity: number): number | null | "insufficient" {
  if (stock === null) return null;
  return stock >= quantity ? stock - quantity : "insufficient";
}

/** Who acts on an order: the member who placed it, or the club (an Administrator). */
export type OrderActor = "MEMBER" | "CLUB";

/** The three verbs after an order is placed. */
export type OrderVerb = "pay" | "handOver" | "cancel";

/**
 * The status an order moves to, or null when the move is not allowed:
 *
 *     PLACED ──pay──▶ PAID ──handOver──▶ HANDED_OVER
 *        └──cancel──▶ CANCELLED ◀──cancel── (PAID, the club only)
 *
 * - **pay** and **handOver** are the club's alone; an order is handed over only once it is paid
 *   (cash at the run is two presses, «Marchează plătită» then «Marchează predată»);
 * - **cancel** by the member only while the order is only placed — once the club has money for it,
 *   the member writes to the club; by the club at any time before the hand-over;
 * - a handed-over or a cancelled order is closed: nothing follows either.
 */
export function nextOrderStatus(status: ShopOrderStatus, verb: OrderVerb, actor: OrderActor): ShopOrderStatus | null {
  if (verb === "pay") return actor === "CLUB" && status === "PLACED" ? "PAID" : null;
  if (verb === "handOver") return actor === "CLUB" && status === "PAID" ? "HANDED_OVER" : null;
  if (actor === "MEMBER") return status === "PLACED" ? "CANCELLED" : null;
  return status === "PLACED" || status === "PAID" ? "CANCELLED" : null;
}

/** The verbs the club may still press on an order in this status, in the row's order. */
export function clubVerbsFor(status: ShopOrderStatus): OrderVerb[] {
  return (["pay", "handOver", "cancel"] as const).filter((verb) => nextOrderStatus(status, verb, "CLUB") !== null);
}

/** A variant as the editor types it: a label (null for a product's one variant) and a stock (null: no limit). */
export type VariantLine = { label: string | null; stock: number | null };

/** Why a list of variants was refused, for the refusal's developer message. */
export type VariantLinesError = "format" | "label" | "stock" | "duplicate" | "tooMany";

function readStock(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,6}$/.test(trimmed)) return "invalid";
  const value = Number(trimmed);
  return value <= STOCK_MAX ? value : "invalid";
}

/**
 * The «Variante și stoc» box, one variant per line — «S», «M: 10», «XL: 0» — and, when the box is
 * empty, the product's one variant with the «Stoc» box's number. A line's stock after a colon; none
 * is no limit. Labels are unique without regard to case; at most `VARIANTS_MAX` lines.
 */
export function parseVariantLines(lines: string, singleStock: string): { ok: true; variants: VariantLine[] } | { ok: false; error: VariantLinesError } {
  const rows = lines
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (rows.length === 0) {
    const stock = readStock(singleStock);
    return stock === "invalid" ? { ok: false, error: "stock" } : { ok: true, variants: [{ label: null, stock }] };
  }
  if (rows.length > VARIANTS_MAX) return { ok: false, error: "tooMany" };
  const variants: VariantLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const [labelPart, stockPart, ...extra] = row.split(":");
    if (extra.length > 0) return { ok: false, error: "format" };
    const label = labelPart.replace(/\s+/g, " ").trim();
    if (label === "" || label.length > VARIANT_LABEL_MAX) return { ok: false, error: "label" };
    const key = label.toLocaleLowerCase("ro");
    if (seen.has(key)) return { ok: false, error: "duplicate" };
    seen.add(key);
    const stock = readStock(stockPart ?? "");
    if (stock === "invalid") return { ok: false, error: "stock" };
    variants.push({ label, stock });
  }
  return { ok: true, variants };
}

/** The variants back into the box's lines, as the editor opens them: «M: 10», «L». */
export function variantLinesAsTyped(variants: readonly VariantLine[]): { lines: string; singleStock: string } {
  if (variants.length === 1 && variants[0].label === null) return { lines: "", singleStock: variants[0].stock === null ? "" : String(variants[0].stock) };
  return {
    lines: variants.map((variant) => (variant.stock === null ? `${variant.label ?? ""}` : `${variant.label ?? ""}: ${variant.stock}`)).join("\n"),
    singleStock: "",
  };
}

/** The key a variant is matched by between the loaded form and the stored rows. */
export function variantKey(label: string | null): string {
  return label === null ? "" : label.toLocaleLowerCase("ro");
}

/**
 * The stock a save writes for a variant that already existed (§683): the typed number when the
 * Administrator changed it from what the form loaded, and otherwise the stock as it stands now — so
 * an order placed while the form was open is never undone by a save that did not touch the number.
 */
export function stockToSave(typed: number | null, loaded: number | null | undefined, current: number | null): number | null {
  if (loaded === undefined) return typed;
  return typed === loaded ? current : typed;
}
