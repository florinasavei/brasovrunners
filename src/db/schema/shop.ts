import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { mediaAssets } from "./gallery";
import { locale } from "./locale";
import { staffUsers } from "./staff-users";

/**
 * «Magazin» — the members' shop (§683; the owner, 2026-10-08): the club's merchandise — t-shirts,
 * buffs, stickers — offered to its members inside the members' zone (§524), ordered there, and paid
 * outside the site, by bank transfer or cash; an Administrator marks an order paid. The owner,
 * 2026-10-09: «Payment is not on the site». No card, no payment provider, no amount charged: a
 * price here is a number the member reads, never a sum the platform takes.
 *
 * Three tables: the catalogue (`shop_products`), each product's variants with an optional stock
 * (`shop_product_variants`), and the orders (`shop_orders`), one product line each.
 */

/**
 * A product of the catalogue: a title and a description in Romanian **and** English (§352, checked
 * at the save in `content/shop/fields.ts`), a price in bani, one optional photo kept like «Echipa»'s
 * (§459, §541: the stored picture and the crop's four fractions), whether members see it, and its
 * place in the list. A product that already has orders is archived rather than deleted: the orders
 * keep their own copy of the title, the price and its currency, and the row stays for the list's filter.
 *
 * The price has a currency, lei or euro, chosen per product (§686; the owner, 2026-10-10: the
 * supplier prices the shirts in euro and members read «EUR, shown as EUR»). It is shown in that
 * currency everywhere, never converted: no rate, no sum charged (§683).
 */
export const shopProducts = pgTable(
  "shop_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    titleRo: text("title_ro").notNull(),
    titleEn: text("title_en").notNull(),
    /**
     * The description's plain words, both languages or neither — written by every save from the
     * rich document (§474's twin: what a search, a listing or an older reader gets).
     */
    descriptionRo: text("description_ro"),
    descriptionEn: text("description_en"),
    /**
     * The description as the editor keeps it (§NNN): a rich text under the allowlist of
     * `content/rich-text/domain/schema.ts`, tables and pictures allowed — the owner: «I need that
     * rich text editor so I can add table and pictures». Null for a product written before it or
     * with no description; `description_ro` / `description_en` are its plain twins.
     */
    descriptionRoJson: jsonb("description_ro_json"),
    descriptionEnJson: jsonb("description_en_json"),
    /**
     * «Tabelul de mărimi» (§NNN): `{ columns: [{ ro, en }], rows: { "S": [48, 66] } }` — at most four
     * measured columns, named in both languages, and one row of numbers (or null) per size. The CHECK
     * holds the shape; the save (`fields.ts`) holds the rest: each row's label is a variant's, each
     * cell a number or null, each column both languages or neither.
     */
    sizeChart: jsonb("size_chart"),
    /**
     * The price in the minor unit of `currency`: bani for RON («45 lei» is 4500), cents for EUR
     * («12,34 €» is 1234). An integer, so no sum is ever rounded. The column keeps its name from the
     * lei-only days (§683): a rename is a contract change (AGENTS.md §7.6).
     */
    priceBani: integer("price_bani").notNull(),
    /** «Moneda»: `RON` or `EUR` (`SHOP_CURRENCIES` in `content/shop/domain.ts`), never converted (§686). */
    currency: text("currency", { enum: ["RON", "EUR"] }).notNull().default("RON"),

    /**
     * The cover, mirrored from the first of `shop_product_pictures` by position (§NNN) every time
     * the pictures change; nothing reads it new — kept so code and rows from §683 keep working. It
     * was the product's one photo, kept as a card of «Echipa» keeps it (§459, §541).
     */
    photoMediaAssetId: uuid("photo_media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /** The cover's crop, `{ x, y, w, h }` fractions (§541), mirrored with it; null is the whole photo. */
    photoCrop: jsonb("photo_crop"),

    /** «Vizibil în magazin»: members see it and may order it. A new product starts hidden. */
    visible: boolean("visible").notNull().default(false),
    /** Where the product sits in the list, lowest first, moved with two arrows (§552's codes). */
    position: integer("position").notNull(),
    /** Set instead of a delete when the product has orders: out of the shop and of the editor's list. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),

    createdByStaffUserId: uuid("created_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    updatedByStaffUserId: uuid("updated_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** Optimistic concurrency, as the codes' (AGENTS.md §11.5). */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("shop_products_title_ro_present", sql`length(btrim(${t.titleRo})) > 0`),
    check("shop_products_title_en_present", sql`length(btrim(${t.titleEn})) > 0`),
    check("shop_products_price_not_negative", sql`${t.priceBani} >= 0`),
    check("shop_products_currency_known", sql`${t.currency} IN ('RON', 'EUR')`),
    check("shop_products_position_positive", sql`${t.position} >= 1`),
    check("shop_products_version_positive", sql`${t.version} >= 1`),
    check(
      "shop_products_size_chart_shape",
      sql`${t.sizeChart} IS NULL OR (jsonb_typeof(${t.sizeChart}) = 'object' AND jsonb_typeof(${t.sizeChart} -> 'columns') = 'array' AND jsonb_array_length(${t.sizeChart} -> 'columns') <= 4 AND jsonb_typeof(${t.sizeChart} -> 'rows') = 'object')`,
    ),
    index("shop_products_visible_position_idx").on(t.visible, t.position),
  ],
);

export type ShopProduct = typeof shopProducts.$inferSelect;

/**
 * A product's pictures (§NNN; the owner: «I need to be able to add multiple pictures of the
 * product»), in order: the first by `position` is the cover, mirrored onto
 * `shop_products.photo_media_asset_id` / `photo_crop`. Each is a stored picture of the gallery
 * (`media_assets`) with the crop box's four fractions (§541) or null for the whole picture. The
 * product's delete cascades; a picture removed from the store leaves the row without its asset,
 * which the pages skip.
 */
export const shopProductPictures = pgTable(
  "shop_product_pictures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => shopProducts.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => mediaAssets.id, { onDelete: "set null" }),
    /** `{ x, y, w, h }` fractions of the picture (§541), or null for the whole of it. */
    crop: jsonb("crop"),
    /** Where the picture sits, lowest first; 1 is the cover. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("shop_product_pictures_position_positive", sql`${t.position} >= 1`), index("shop_product_pictures_product_idx").on(t.productId, t.position)],
);

export type ShopProductPicture = typeof shopProductPictures.$inferSelect;

/**
 * One way a product is ordered — «S», «M», «L», «XL» — or the product's only one, with no label.
 * Every product has at least one. `stock` is how many are left to order, or null for no limit; an
 * order takes from it under the row's lock, in the order's own transaction, and a cancellation gives
 * it back (`content/shop/orders.ts`). The check keeps it from going below zero whatever the code does.
 */
export const shopProductVariants = pgTable(
  "shop_product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => shopProducts.id, { onDelete: "cascade" }),
    /** A short label — «M», «Albastru» — or null for a product with one variant. Not translated: a size is a size. */
    label: text("label"),
    /** Left to order, or null: unlimited. */
    stock: integer("stock"),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("shop_product_variants_stock_not_negative", sql`${t.stock} IS NULL OR ${t.stock} >= 0`),
    check("shop_product_variants_label_present", sql`${t.label} IS NULL OR length(btrim(${t.label})) > 0`),
    index("shop_product_variants_product_idx").on(t.productId, t.position),
  ],
);

export type ShopProductVariant = typeof shopProductVariants.$inferSelect;

/**
 * Where an order stands: placed by the member, paid (outside the site, marked by an Administrator),
 * handed over in person — or cancelled, by the member while it is only placed, or by an
 * Administrator at any time before it is handed over.
 */
export const shopOrderStatus = pgEnum("shop_order_status", ["PLACED", "PAID", "HANDED_OVER", "CANCELLED"]);

export type ShopOrderStatus = (typeof shopOrderStatus.enumValues)[number];

/**
 * One order: one product, one variant, a quantity of one to five, by one member account (§524,
 * §662). What the member ordered is copied at the moment of the order — the titles, the variant's
 * label, the unit price and its currency (§686) — so an edited or archived product never changes an
 * order already placed.
 * The member's name is copied too: an order is an accounting record the club keeps after the
 * account is removed from «Echipa» (`member_staff_user_id` then goes null; the address with it).
 */
export const shopOrders = pgTable(
  "shop_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The order's number for people — «Comanda nr. 12» — never reused. */
    number: integer("number").notNull().generatedAlwaysAsIdentity(),

    memberStaffUserId: uuid("member_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    /** The member's name as it was when they ordered. */
    memberName: text("member_name").notNull(),
    /** The language the member ordered in: their emails read in it first. */
    locale: locale("locale").notNull().default("ro"),

    productId: uuid("product_id").references(() => shopProducts.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => shopProductVariants.id, { onDelete: "set null" }),
    productTitleRo: text("product_title_ro").notNull(),
    productTitleEn: text("product_title_en").notNull(),
    variantLabel: text("variant_label"),
    quantity: integer("quantity").notNull(),
    /** The unit price in the minor unit of `currency` — bani for RON, cents for EUR — as it was at the order. */
    unitPriceBani: integer("unit_price_bani").notNull(),
    /** The product's currency at the order, copied in the order's own transaction (§686); the product may change its own later. */
    currency: text("currency", { enum: ["RON", "EUR"] }).notNull().default("RON"),
    /** Whether the order took from a counted stock: a cancellation gives back exactly what was taken. */
    stockTaken: boolean("stock_taken").notNull().default(false),
    /** What the member wrote with the order, at most 300 characters, or null. */
    note: text("note"),

    /**
     * Who placed it (§690): `MEMBER` — the member themself, from the zone — or `CLUB`, an Administrator
     * on «Adaugă o comandă pentru un membru», through the same locks and stock rule, in the member's
     * name. Every row from before the column is a member's own order.
     */
    placedBy: text("placed_by", { enum: ["MEMBER", "CLUB"] }).notNull().default("MEMBER"),
    /** The colleague who placed it for the member; null for a member's own order. */
    placedByStaffUserId: uuid("placed_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    status: shopOrderStatus("status").notNull().default("PLACED"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Who cancelled: the member themself, or the club. */
    cancelledBy: text("cancelled_by"),
    /** The account that cancelled — the member's, or the Administrator's. */
    cancelledByStaffUserId: uuid("cancelled_by_staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("shop_orders_quantity_range", sql`${t.quantity} BETWEEN 1 AND 5`),
    check("shop_orders_unit_price_not_negative", sql`${t.unitPriceBani} >= 0`),
    check("shop_orders_currency_known", sql`${t.currency} IN ('RON', 'EUR')`),
    check("shop_orders_note_length", sql`${t.note} IS NULL OR length(${t.note}) <= 300`),
    check("shop_orders_cancelled_by_known", sql`${t.cancelledBy} IS NULL OR ${t.cancelledBy} IN ('MEMBER', 'CLUB')`),
    check("shop_orders_placed_by_known", sql`${t.placedBy} IN ('MEMBER', 'CLUB')`),
    index("shop_orders_status_idx").on(t.status),
    index("shop_orders_created_at_idx").on(t.createdAt),
    index("shop_orders_member_idx").on(t.memberStaffUserId),
    index("shop_orders_product_idx").on(t.productId),
  ],
);

export type ShopOrder = typeof shopOrders.$inferSelect;
