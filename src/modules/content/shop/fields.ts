import { z } from "zod";
import { resolveRichPair, richTextBox } from "@/modules/content/team/fields";
import { readTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
import {
  currencyWordOf,
  ORDER_NOTE_MAX,
  ORDER_QUANTITY_MAX,
  parsePriceToMinor,
  parseSizeChart,
  parseVariantLines,
  SHOP_CURRENCIES,
  type SizeChart,
  type VariantLine,
  variantKey,
  variantsFromSizes,
} from "./domain";

/**
 * What the club types for a product of «Magazin» (§683, §697), and what a member posts with an order.
 *
 * A product: the title in Romanian **and** English — both required at every save, a product with no
 * name in one language is not a product the other half of the site can show (§28, §352) — the
 * description both or neither, a rich text with its plain twin (§474: `descriptionRoBody` /
 * `descriptionEnBody` from the editor, or the plain boxes from an older form or a script), a price
 * with its currency — lei or euro, «Moneda», never converted (§686); absent from the post it is lei —
 * «Mărimile» (the ticked sizes with their stock, «Mărime unică», the free labels —
 * `domain.ts#variantsFromSizes`; or §683's one box of lines, `parseVariantLines`, from an older form),
 * «Tabelul de mărimi» (`parseSizeChart`) and «Vizibil în magazin». The pictures are their own rows and
 * their own forms (`pictureFieldsSchema`). A refusal names its box, the rest comes back as typed (§315).
 */

export const PRODUCT_TITLE_MAX = 80;
/** The description's plain words; a table or a picture in it counts for what it says, not for its JSON. */
export const PRODUCT_DESCRIPTION_MAX = 4000;
/** The club's payment words, each language. */
export const PAYMENT_WORDS_MAX = 600;

const oneLine = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

/** A few lines: trimmed, Windows line breaks made one, at most one empty line in a row; empty is null. */
export const fewLines = (max: number) =>
  z
    .string()
    .optional()
    .default("")
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/** What the form loaded for each variant's stock, by `variantKey`: a save leaves untouched stock as it stands now. */
const loadedStock = z
  .string()
  .optional()
  .default("")
  .transform((value): Record<string, number | null> => {
    if (value.trim() === "") return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const out: Record<string, number | null> = {};
      for (const [key, stock] of Object.entries(parsed as Record<string, unknown>)) {
        if (stock === null || (typeof stock === "number" && Number.isInteger(stock) && stock >= 0)) out[key] = stock as number | null;
      }
      return out;
    } catch {
      return {};
    }
  });

/** A string or a list of strings as a form posts a group of ticks (`sizes[]`); absent is none ticked. */
const tickList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value): string[] | undefined => (value === undefined ? undefined : Array.isArray(value) ? value : [value]));

/** A form's checkbox as it is posted: `on` ticked, absent or empty unticked; a boolean from a test. */
const ticked = z.union([z.boolean(), z.string()]).optional().transform((value) => value === true || value === "on" || value === "true");

const stringRecord = z.record(z.string(), z.string()).optional().default({});

export const productFieldsSchema = z
  .object({
    titleRo: oneLine(PRODUCT_TITLE_MAX),
    titleEn: oneLine(PRODUCT_TITLE_MAX),
    /** The plain boxes (an older form, a script, a test); the editor posts `…Body` and these stay empty. */
    descriptionRo: fewLines(PRODUCT_DESCRIPTION_MAX),
    descriptionEn: fewLines(PRODUCT_DESCRIPTION_MAX),
    /** The editor's documents (§697), tables and pictures allowed. */
    descriptionRoBody: richTextBox,
    descriptionEnBody: richTextBox,
    price: z.string().optional().default(""),
    /** «Moneda»: one of `SHOP_CURRENCIES`; empty or absent (an older form, a test) is lei. */
    currency: z
      .union([z.enum(SHOP_CURRENCIES), z.literal("")])
      .optional()
      .default("RON")
      .transform((value) => (value === "" ? "RON" : value)),
    /** §683's box of lines — read only when «Mărimile» posted nothing (an older form, a script, a test). */
    variants: z.string().optional().default(""),
    /** The «Stoc» box: «Mărime unică»'s stock, and the one variant's when nothing else is ticked or typed. */
    stock: z.string().optional().default(""),
    /** «Mărimile» (§697): the ticked sizes, each one's stock, «Mărime unică», the free labels. */
    sizes: tickList,
    sizeStock: stringRecord,
    oneSize: ticked,
    extraVariants: z.string().optional().default(""),
    /** «Tabelul de mărimi» (§697): the columns' two names and a cell per size and column. */
    chartColumns: z.array(z.object({ ro: z.string().optional().default(""), en: z.string().optional().default("") })).optional().default([]),
    chartCells: z.record(z.string(), z.array(z.string())).optional().default({}),
    variantsLoaded: loadedStock,
    visible: z.union([z.boolean(), z.string()]).optional().transform((value) => value === true || value === "on" || value === "true"),
  })
  .transform((fields, ctx) => {
    // The description: the editor's documents when they were posted, else the plain boxes as paragraphs —
    // both languages or neither, the plain twin written from the document (§474, §352).
    const description = resolveRichPair(
      ctx,
      { ro: { plain: fields.descriptionRo ?? "", body: fields.descriptionRoBody }, en: { plain: fields.descriptionEn ?? "", body: fields.descriptionEnBody } },
      { ro: { plain: "descriptionRo", body: "descriptionRoBody" }, en: { plain: "descriptionEn", body: "descriptionEnBody" } },
      { max: PRODUCT_DESCRIPTION_MAX, tables: true, what: "the description" },
    );
    const priceBani = parsePriceToMinor(fields.price);
    if (priceBani === null) ctx.addIssue({ code: "custom", path: ["price"], message: "a price like 45 or 45,50" });
    // A word in the box that contradicts «Moneda» («45 lei» with euro chosen, «30 €» with lei) is a
    // slip somewhere — refused on the box, never settled for either side (§686).
    const word = currencyWordOf(fields.price);
    if (priceBani !== null && word !== null && word !== fields.currency) {
      ctx.addIssue({ code: "custom", path: ["price"], message: `the price says ${word}, «Moneda» says ${fields.currency}` });
    }
    // «Mărimile» when the form posted them; §683's lines otherwise. Nothing of either is the one variant.
    const sizesPosted = fields.sizes !== undefined || fields.oneSize || fields.extraVariants.trim() !== "" || Object.keys(fields.sizeStock).length > 0;
    let variants: VariantLine[] = [];
    if (sizesPosted || fields.variants.trim() === "") {
      const read = variantsFromSizes({ sizes: fields.sizes ?? [], sizeStock: fields.sizeStock, oneSize: fields.oneSize, stock: fields.stock, extraVariants: fields.extraVariants });
      if (read.ok) variants = read.variants;
      else ctx.addIssue({ code: "custom", path: [read.path], message: `the sizes: ${read.error}` });
    } else {
      const read = parseVariantLines(fields.variants, fields.stock);
      if (read.ok) variants = read.variants;
      else ctx.addIssue({ code: "custom", path: ["variants"], message: `the variants: ${read.error}` });
    }
    let sizeChart: SizeChart | null = null;
    const chart = parseSizeChart(
      { columns: fields.chartColumns, cells: fields.chartCells },
      variants.map((variant) => variant.label),
    );
    if (chart.ok) sizeChart = chart.chart;
    else ctx.addIssue({ code: "custom", path: ["chartColumns"], message: `the size chart: ${chart.error}` });
    return {
      titleRo: fields.titleRo,
      titleEn: fields.titleEn,
      descriptionRo: description.ro.plain,
      descriptionEn: description.en.plain,
      descriptionRoJson: description.ro.doc,
      descriptionEnJson: description.en.doc,
      priceBani: priceBani ?? 0,
      currency: fields.currency,
      variants,
      variantsLoaded: fields.variantsLoaded,
      sizeChart,
      visible: fields.visible,
    };
  });

export type ProductFields = z.output<typeof productFieldsSchema>;

/** A picture added to a product (§697): a stored picture's id and the crop box's fractions, as `TeamPhotoField` posts them. */
export const pictureFieldsSchema = z
  .object({
    photoAssetId: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim())
      .refine((value) => isUuid(value), "choose a picture")
      .transform((value) => value.toLowerCase()),
    photoCrop: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
  })
  .transform((fields, ctx) => {
    const crop = readTeamPhotoCrop(fields.photoCrop);
    if (crop === "invalid") ctx.addIssue({ code: "custom", path: ["photoAssetId"], message: "not a crop of the picture" });
    return { assetId: fields.photoAssetId, crop: crop === "invalid" ? null : crop };
  });

export type PictureFields = z.output<typeof pictureFieldsSchema>;

/** The form's loaded stock, as the hidden field carries it: `{ "": 10 }` or `{ "m": 4, "l": null }`. */
export function loadedStockJson(variants: readonly { label: string | null; stock: number | null }[]): string {
  return JSON.stringify(Object.fromEntries(variants.map((variant) => [variantKey(variant.label), variant.stock])));
}

/**
 * «Cum se plătește» and «Cine primește comenzile» (§683): the payment words both languages or neither
 * (§352), plain text — an IBAN, «sau cash la alergare» — and one address, or none.
 */
export const shopSettingsSchema = z
  .object({
    paymentRo: fewLines(PAYMENT_WORDS_MAX),
    paymentEn: fewLines(PAYMENT_WORDS_MAX),
    ordersTo: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.union([z.literal(""), z.email().max(320)]))
      .transform((value) => (value === "" ? null : value)),
  })
  .superRefine((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.paymentRo, en: fields.paymentEn }, { ro: ["paymentRo"], en: ["paymentEn"] }, "the payment words");
  });

export type ShopSettingsFields = z.output<typeof shopSettingsSchema>;

/** What a member posts with «Comandă»: the product, the variant, one to five, a note. */
export const orderFieldsSchema = z.object({
  productId: z.string().trim().refine(isUuid, "not a product"),
  variantId: z.string().trim().refine(isUuid, "not a variant"),
  quantity: z.coerce.number().int().min(1).max(ORDER_QUANTITY_MAX),
  note: fewLines(ORDER_NOTE_MAX),
});

export type OrderFields = z.output<typeof orderFieldsSchema>;

/**
 * What the club posts on «Adaugă o comandă pentru un membru» (§690): the member account, the product
 * and the variant as one choice («<productId>:<variantId>», the select's value), one to five, a note,
 * and the two ticks — whether the member is emailed, and whether the order is marked paid at once.
 * A refusal names its box.
 */
export const orderForMemberFieldsSchema = z
  .object({
    memberStaffUserId: z.string().trim().refine(isUuid, "not a member account"),
    item: z
      .string()
      .trim()
      .transform((value, ctx) => {
        const [productId, variantId, ...extra] = value.split(":");
        if (extra.length > 0 || !isUuid(productId ?? "") || !isUuid(variantId ?? "")) {
          ctx.addIssue({ code: "custom", message: "not a product and a variant" });
          return { productId: "", variantId: "" };
        }
        return { productId: productId.toLowerCase(), variantId: variantId.toLowerCase() };
      }),
    quantity: z.coerce.number().int().min(1).max(ORDER_QUANTITY_MAX),
    note: fewLines(ORDER_NOTE_MAX),
    emailMember: ticked,
    markPaid: ticked,
  })
  .transform((fields) => ({
    memberStaffUserId: fields.memberStaffUserId.toLowerCase(),
    productId: fields.item.productId,
    variantId: fields.item.variantId,
    quantity: fields.quantity,
    note: fields.note,
    emailMember: fields.emailMember,
    markPaid: fields.markPaid,
  }));

export type OrderForMemberFields = z.output<typeof orderForMemberFieldsSchema>;
