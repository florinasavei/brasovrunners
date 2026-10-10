import { z } from "zod";
import { readTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { refuseOneLanguage } from "@/shared/forms/both-languages";
import { isUuid } from "@/shared/ids";
import { ORDER_NOTE_MAX, ORDER_QUANTITY_MAX, parsePriceToMinor, parseVariantLines, SHOP_CURRENCIES, type VariantLine, variantKey } from "./domain";

/**
 * What the club types for a product of «Magazin» (§683), and what a member posts with an order.
 *
 * A product: the title in Romanian **and** English — both required at every save, a product with no
 * name in one language is not a product the other half of the site can show (§28, §352) — the
 * description both or neither, a price with its currency — lei or euro, «Moneda», never converted
 * (§NNN); absent from the post it is lei — the photo of «Echipa»'s card (§541's crop), the
 * variants and their stock (`domain.ts#parseVariantLines`), and «Vizibil în magazin». A refusal names
 * its box, the rest comes back as typed (§315).
 */

export const PRODUCT_TITLE_MAX = 80;
export const PRODUCT_DESCRIPTION_MAX = 600;
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

export const productFieldsSchema = z
  .object({
    titleRo: oneLine(PRODUCT_TITLE_MAX),
    titleEn: oneLine(PRODUCT_TITLE_MAX),
    descriptionRo: fewLines(PRODUCT_DESCRIPTION_MAX),
    descriptionEn: fewLines(PRODUCT_DESCRIPTION_MAX),
    price: z.string().optional().default(""),
    /** «Moneda»: one of `SHOP_CURRENCIES`; empty or absent (an older form, a test) is lei. */
    currency: z
      .union([z.enum(SHOP_CURRENCIES), z.literal("")])
      .optional()
      .default("RON")
      .transform((value) => (value === "" ? "RON" : value)),
    variants: z.string().optional().default(""),
    stock: z.string().optional().default(""),
    variantsLoaded: loadedStock,
    visible: z.union([z.boolean(), z.string()]).optional().transform((value) => value === true || value === "on" || value === "true"),
    photoAssetId: z
      .string()
      .optional()
      .default("")
      .transform((value) => value.trim())
      .refine((value) => value === "" || isUuid(value), "not a picture id")
      .transform((value) => (value === "" ? null : value.toLowerCase())),
    photoCrop: z.union([z.string(), z.record(z.string(), z.unknown()), z.null()]).optional(),
  })
  .transform((fields, ctx) => {
    refuseOneLanguage(ctx, { ro: fields.descriptionRo, en: fields.descriptionEn }, { ro: ["descriptionRo"], en: ["descriptionEn"] }, "the description");
    const priceBani = parsePriceToMinor(fields.price);
    if (priceBani === null) ctx.addIssue({ code: "custom", path: ["price"], message: "a price like 45 or 45,50" });
    const variants = parseVariantLines(fields.variants, fields.stock);
    if (!variants.ok) {
      // The empty variants box reads the «Stoc» box: its refusal is on that box.
      const path = fields.variants.trim() === "" ? "stock" : "variants";
      ctx.addIssue({ code: "custom", path: [path], message: `the variants: ${variants.error}` });
    }
    const crop = readTeamPhotoCrop(fields.photoCrop);
    if (crop === "invalid") ctx.addIssue({ code: "custom", path: ["photoAssetId"], message: "not a crop of the photo" });
    return {
      titleRo: fields.titleRo,
      titleEn: fields.titleEn,
      descriptionRo: fields.descriptionRo,
      descriptionEn: fields.descriptionEn,
      priceBani: priceBani ?? 0,
      currency: fields.currency,
      variants: variants.ok ? variants.variants : ([] as VariantLine[]),
      variantsLoaded: fields.variantsLoaded,
      visible: fields.visible,
      photoAssetId: fields.photoAssetId,
      photoCrop: fields.photoAssetId && crop !== "invalid" ? crop : null,
    };
  });

export type ProductFields = z.output<typeof productFieldsSchema>;

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
