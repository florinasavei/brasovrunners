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
 * The currencies a shop price may be in (§686; the owner, 2026-10-10: the supplier prices the
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
 * A price as people read it, in its own currency (§686), the minor part only when there is one:
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
 * The currency word the price box carries, when it carries one (§686): a trailing «lei», «eur»,
 * «euro» or «€», or a leading «€» («€30», «€ 30»). The box's word is read for one thing only —
 * refusing a price that contradicts «Moneda» beside it («45 lei» with euro chosen) — and never to
 * choose the currency: that is the select's. Null when the box is a bare number.
 */
export function currencyWordOf(typed: string): ShopCurrency | null {
  const trimmed = typed.trim();
  if (/^€/.test(trimmed)) return "EUR";
  const trailing = /(lei|euro|eur|€)$/i.exec(trimmed);
  if (!trailing) return null;
  return trailing[1].toLowerCase() === "lei" ? "RON" : "EUR";
}

/**
 * The price typed in the editor, back into the minor unit: «45», «45,5», «45.50», «45 lei», «30.25 €»,
 * «€30», «30 eur». A currency word — trailing, or a leading «€» (§686) — is dropped whatever it says:
 * the currency is the select's, not the box's (`fields.ts` refuses the contradiction). Null for anything else.
 */
export function parsePriceToMinor(typed: string): number | null {
  const cleaned = typed
    .trim()
    .replace(/^€\s*/, "")
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

// --- «Mărimile» (§NNN) ---------------------------------------------------------------------------

/**
 * The sizes the editor offers as ticks, in the order the shop shows them (§NNN; the owner's sheet:
 * nine sizes XXS–4XL for the shirts, one size for the buff). A size is a variant row (`label`), so
 * the stock, the locks and the orders of §683 are untouched: ticking «M» is the row «M».
 */
export const STANDARD_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"] as const;
export type StandardSize = (typeof STANDARD_SIZES)[number];
/** «Mărime unică»: the one-variant product of §683 — the variant row with no label. */
export const ONE_SIZE_LABEL = null;
/** The most pictures a product carries (§NNN): a strip, not an album. */
export const PICTURES_MAX = 8;
/** «Tabelul de mărimi»: at most four measured columns — chest, length, sleeve, hip — and a column name's length. */
export const SIZE_CHART_COLUMNS_MAX = 4;
export const SIZE_CHART_COLUMN_MAX = 40;

/** The canonical spelling of a standard size, or null for a label that is none («m» is «M»). */
export function standardSizeOf(label: string | null): StandardSize | null {
  if (label === null) return null;
  const key = label.trim().toLocaleLowerCase("ro");
  return STANDARD_SIZES.find((size) => size.toLocaleLowerCase("ro") === key) ?? null;
}

/**
 * What «Mărimile» posts: the ticked standard sizes (`sizes[]`), each one's stock (`sizeStock[<label>]`),
 * «Mărime unică» with the «Stoc» box, and the free labels one per line («Albastru», «Copii: 5»).
 */
export type SizesForm = {
  sizes: readonly string[];
  sizeStock: Readonly<Record<string, string>>;
  oneSize: boolean;
  stock: string;
  extraVariants: string;
};

export type SizesFormError = { path: "sizes" | "stock" | "extraVariants"; error: VariantLinesError | "unknownSize" | "standardAsExtra" };

/**
 * The sizes form as variants, in the fixed order: the standard sizes as `STANDARD_SIZES` lists
 * them, then «Mărime unică», then the free labels as typed. Nothing ticked and nothing typed is the
 * one-variant product with the «Stoc» box's number, as §683's empty box was. A free label that
 * spells a standard size is refused (tick it instead); the whole list is at most `VARIANTS_MAX`.
 */
export function variantsFromSizes(form: SizesForm): { ok: true; variants: VariantLine[] } | { ok: false } & SizesFormError {
  const ticked = new Set<StandardSize>();
  for (const posted of form.sizes) {
    const size = standardSizeOf(posted);
    if (size === null) return { ok: false, path: "sizes", error: "unknownSize" };
    ticked.add(size);
  }
  const variants: VariantLine[] = [];
  for (const size of STANDARD_SIZES) {
    if (!ticked.has(size)) continue;
    const stock = readStock(form.sizeStock[size] ?? "");
    if (stock === "invalid") return { ok: false, path: "sizes", error: "stock" };
    variants.push({ label: size, stock });
  }
  const extra = form.extraVariants.trim() === "" ? { ok: true as const, variants: [] as VariantLine[] } : parseVariantLines(form.extraVariants, "");
  if (!extra.ok) return { ok: false, path: "extraVariants", error: extra.error };
  if (extra.variants.some((variant) => standardSizeOf(variant.label) !== null)) return { ok: false, path: "extraVariants", error: "standardAsExtra" };
  if (form.oneSize || (variants.length === 0 && extra.variants.length === 0)) {
    const stock = readStock(form.stock);
    if (stock === "invalid") return { ok: false, path: "stock", error: "stock" };
    variants.push({ label: ONE_SIZE_LABEL, stock });
  }
  variants.push(...extra.variants);
  if (variants.length > VARIANTS_MAX) return { ok: false, path: "extraVariants", error: "tooMany" };
  return { ok: true, variants };
}

/** The stored variants back as the form opens them: which sizes are ticked, each stock, «Mărime unică», the free labels. */
export function sizesAsForm(variants: readonly VariantLine[]): { sizes: StandardSize[]; sizeStock: Record<string, string>; oneSize: boolean; stock: string; extraVariants: string } {
  const sizes: StandardSize[] = [];
  const sizeStock: Record<string, string> = {};
  const extra: VariantLine[] = [];
  let oneSize = false;
  let stock = "";
  for (const variant of variants) {
    if (variant.label === null) {
      oneSize = true;
      stock = variant.stock === null ? "" : String(variant.stock);
      continue;
    }
    const size = standardSizeOf(variant.label);
    if (size === null) {
      extra.push(variant);
      continue;
    }
    sizes.push(size);
    sizeStock[size] = variant.stock === null ? "" : String(variant.stock);
  }
  return { sizes, sizeStock, oneSize, stock, extraVariants: variantLinesAsTyped(extra.length ? extra : []).lines };
}

// --- «Tabelul de mărimi» (§NNN) ------------------------------------------------------------------

export type SizeChartColumn = { ro: string; en: string };
/** As stored: the measured columns in both languages, and one row of numbers (or null) per size label. */
export type SizeChart = { columns: SizeChartColumn[]; rows: Record<string, (number | null)[]> };

/** What the editor posts: a column's two names (`chartColumns[<i>][ro|en]`) and a cell per size and column (`chartCells[<label>][<i>]`). */
export type SizeChartForm = { columns: readonly { ro: string; en: string }[]; cells: Readonly<Record<string, readonly string[]>> };

export type SizeChartError = "tooMany" | "oneLanguage" | "column" | "cell";

function readMeasure(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) return "invalid";
  return Number(`${match[1]}.${match[2] ?? "0"}`);
}

/**
 * The chart as posted, kept only where it says something: a column with neither name is dropped
 * with its cells, a column with one name is refused (§352), a cell is a number («48», «66,5») or
 * empty, a row is kept only for a label among the product's variants and only when a cell is filled.
 * No column left is no chart (null).
 */
export function parseSizeChart(form: SizeChartForm, labels: readonly (string | null)[]): { ok: true; chart: SizeChart | null } | { ok: false; error: SizeChartError } {
  const kept: { index: number; column: SizeChartColumn }[] = [];
  form.columns.forEach((column, index) => {
    const ro = column.ro.replace(/\s+/g, " ").trim();
    const en = column.en.replace(/\s+/g, " ").trim();
    if (ro === "" && en === "") return;
    kept.push({ index, column: { ro, en } });
  });
  if (kept.length > SIZE_CHART_COLUMNS_MAX) return { ok: false, error: "tooMany" };
  for (const { column } of kept) {
    if (column.ro === "" || column.en === "") return { ok: false, error: "oneLanguage" };
    if (column.ro.length > SIZE_CHART_COLUMN_MAX || column.en.length > SIZE_CHART_COLUMN_MAX) return { ok: false, error: "column" };
  }
  if (kept.length === 0) return { ok: true, chart: null };
  const known = new Map(labels.filter((label): label is string => label !== null).map((label) => [variantKey(label), label]));
  const rows: Record<string, (number | null)[]> = {};
  for (const [posted, cells] of Object.entries(form.cells)) {
    const label = known.get(variantKey(posted));
    if (label === undefined) continue;
    const row: (number | null)[] = [];
    for (const { index } of kept) {
      const measure = readMeasure(cells[index] ?? "");
      if (measure === "invalid") return { ok: false, error: "cell" };
      row.push(measure);
    }
    if (row.some((cell) => cell !== null)) rows[label] = row;
  }
  return { ok: true, chart: { columns: kept.map((entry) => entry.column), rows } };
}

/** A stored chart read leniently: a malformed row is no chart, never a broken page. */
export function readSizeChart(value: unknown): SizeChart | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { columns, rows } = value as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(columns) || !rows || typeof rows !== "object" || Array.isArray(rows)) return null;
  const cols: SizeChartColumn[] = [];
  for (const column of columns) {
    if (!column || typeof column !== "object") return null;
    const { ro, en } = column as { ro?: unknown; en?: unknown };
    if (typeof ro !== "string" || typeof en !== "string") return null;
    cols.push({ ro, en });
  }
  if (cols.length === 0 || cols.length > SIZE_CHART_COLUMNS_MAX) return null;
  const out: Record<string, (number | null)[]> = {};
  for (const [label, cells] of Object.entries(rows as Record<string, unknown>)) {
    if (!Array.isArray(cells)) return null;
    const row = cells.slice(0, cols.length).map((cell) => (typeof cell === "number" && Number.isFinite(cell) ? cell : null));
    while (row.length < cols.length) row.push(null);
    out[label] = row;
  }
  return { columns: cols, rows: out };
}

/** The chart's rows in the variants' order, for the one language the page reads — nothing for a variant without a row. */
export function sizeChartRows(chart: SizeChart, variants: readonly { label: string | null }[]): { label: string; cells: (number | null)[] }[] {
  const byKey = new Map(Object.entries(chart.rows).map(([label, cells]) => [variantKey(label), { label, cells }]));
  const rows: { label: string; cells: (number | null)[] }[] = [];
  for (const variant of variants) {
    if (variant.label === null) continue;
    const row = byKey.get(variantKey(variant.label));
    if (row) rows.push({ label: variant.label, cells: row.cells });
  }
  return rows;
}

/** A measure as people read it: «66,5» in Romanian, «66.5» in English, whole numbers bare. */
export function formatMeasure(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "ro-RO", { maximumFractionDigits: 2 }).format(value);
}

/** A measure as the editor's box shows it again: «48», «66,5». */
export function measureAsTyped(value: number | null): string {
  return value === null ? "" : String(value).replace(".", ",");
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
