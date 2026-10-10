import { and, asc, count, desc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { mediaAssets } from "@/db/schema/gallery";
import { type ShopOrderStatus, shopOrders, shopOrderStatus, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { ImageCrop } from "@/modules/content/rich-text/domain/schema";
import { storedTeamPhotoCrop } from "@/modules/content/team/photo-crop";
import { getStorage, objectKey } from "@/modules/media/storage";
import { isUuid } from "@/shared/ids";

/**
 * The members' shop (§NNN), read. The catalogue and the orders are read by the backoffice
 * («Pagini» → «Membri» → «Magazin», behind `canReadShop`) and by the members' zone, behind the
 * account (`canOpenMembersZone`) — never by a public page, the public cache, a feed or a sitemap.
 */

export type ShopPhoto = { webUrl: string; thumbUrl: string; width: number; height: number; crop: ImageCrop | null };

export type ShopVariantRow = { id: string; label: string | null; stock: number | null; position: number };

export type AdminShopProduct = {
  id: string;
  titleRo: string;
  titleEn: string;
  descriptionRo: string | null;
  descriptionEn: string | null;
  priceBani: number;
  photoAssetId: string | null;
  photo: ShopPhoto | null;
  visible: boolean;
  position: number;
  version: number;
  variants: ShopVariantRow[];
  /** Orders that name it, cancelled ones included: with any, a delete archives instead (the orders keep their copy). */
  orders: number;
};

function photoOf(row: { keyPrefix: string | null; width: number | null; height: number | null; crop: unknown }): ShopPhoto | null {
  if (!row.keyPrefix || !row.width || !row.height) return null;
  const storage = getStorage();
  return {
    webUrl: storage.publicUrl(objectKey(row.keyPrefix, "web")),
    thumbUrl: storage.publicUrl(objectKey(row.keyPrefix, "thumb")),
    width: row.width,
    height: row.height,
    crop: storedTeamPhotoCrop(row.crop),
  };
}

async function variantsOf<T extends Record<string, unknown>>(db: Database<T>, productIds: string[]): Promise<Map<string, ShopVariantRow[]>> {
  const byProduct = new Map<string, ShopVariantRow[]>();
  if (productIds.length === 0) return byProduct;
  const rows = await db
    .select({ id: shopProductVariants.id, productId: shopProductVariants.productId, label: shopProductVariants.label, stock: shopProductVariants.stock, position: shopProductVariants.position })
    .from(shopProductVariants)
    .where(inArray(shopProductVariants.productId, productIds))
    .orderBy(asc(shopProductVariants.position), asc(shopProductVariants.createdAt));
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push({ id: row.id, label: row.label, stock: row.stock, position: row.position });
    byProduct.set(row.productId, list);
  }
  return byProduct;
}

const PRODUCT_COLUMNS = {
  id: shopProducts.id,
  titleRo: shopProducts.titleRo,
  titleEn: shopProducts.titleEn,
  descriptionRo: shopProducts.descriptionRo,
  descriptionEn: shopProducts.descriptionEn,
  priceBani: shopProducts.priceBani,
  photoAssetId: shopProducts.photoMediaAssetId,
  keyPrefix: mediaAssets.keyPrefix,
  width: mediaAssets.width,
  height: mediaAssets.height,
  crop: shopProducts.photoCrop,
  visible: shopProducts.visible,
  position: shopProducts.position,
  version: shopProducts.version,
};

/** Every product not archived, in the list's order, with its variants and how many live orders it has. */
export async function listProductsForAdmin<T extends Record<string, unknown>>(db: Database<T>): Promise<AdminShopProduct[]> {
  const rows = await db
    .select(PRODUCT_COLUMNS)
    .from(shopProducts)
    .leftJoin(mediaAssets, eq(mediaAssets.id, shopProducts.photoMediaAssetId))
    .where(isNull(shopProducts.archivedAt))
    .orderBy(asc(shopProducts.position), asc(shopProducts.createdAt));
  const ids = rows.map((row) => row.id);
  const variants = await variantsOf(db, ids);
  const counts = ids.length
    ? await db
        .select({ productId: shopOrders.productId, n: count() })
        .from(shopOrders)
        .where(inArray(shopOrders.productId, ids))
        .groupBy(shopOrders.productId)
    : [];
  const ordersOf = new Map(counts.map((row) => [row.productId, Number(row.n)]));
  return rows.map((row) => ({
    id: row.id,
    titleRo: row.titleRo,
    titleEn: row.titleEn,
    descriptionRo: row.descriptionRo,
    descriptionEn: row.descriptionEn,
    priceBani: row.priceBani,
    photoAssetId: row.photoAssetId,
    photo: photoOf(row),
    visible: row.visible,
    position: row.position,
    version: row.version,
    variants: variants.get(row.id) ?? [],
    orders: ordersOf.get(row.id) ?? 0,
  }));
}

/** Every product's id and both titles, archived ones included: the orders list's filter names them all. */
export async function listProductNames<T extends Record<string, unknown>>(db: Database<T>) {
  return db
    .select({ id: shopProducts.id, titleRo: shopProducts.titleRo, titleEn: shopProducts.titleEn, archived: shopProducts.archivedAt })
    .from(shopProducts)
    .orderBy(asc(shopProducts.position), asc(shopProducts.createdAt));
}

/** How many products members see now — what `/admin/tasks`' row `shopNotice` waits on. */
export async function countVisibleProducts<T extends Record<string, unknown>>(db: Database<T>): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(shopProducts)
    .where(and(eq(shopProducts.visible, true), isNull(shopProducts.archivedAt)));
  return Number(row?.n ?? 0);
}

export type MembersShopProduct = {
  id: string;
  title: string;
  description: string | null;
  priceBani: number;
  photo: ShopPhoto | null;
  /** Each variant and whether any is left: a sold-out variant is shown and not offered. */
  variants: { id: string; label: string | null; soldOut: boolean }[];
};

/**
 * What a member sees in «Magazinul clubului»: visible products, not archived, in this language — the
 * description only when both languages are written (§352) — and each variant with whether it is sold
 * out. Never a stock number: how many the club holds is the club's.
 */
export async function listProductsForMembers<T extends Record<string, unknown>>(db: Database<T>, locale: string): Promise<MembersShopProduct[]> {
  const rows = await db
    .select(PRODUCT_COLUMNS)
    .from(shopProducts)
    .leftJoin(mediaAssets, eq(mediaAssets.id, shopProducts.photoMediaAssetId))
    .where(and(eq(shopProducts.visible, true), isNull(shopProducts.archivedAt)))
    .orderBy(asc(shopProducts.position), asc(shopProducts.createdAt));
  const variants = await variantsOf(db, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    title: locale === "en" ? row.titleEn : row.titleRo,
    description: row.descriptionRo && row.descriptionEn ? (locale === "en" ? row.descriptionEn : row.descriptionRo) : null,
    priceBani: row.priceBani,
    photo: photoOf(row),
    variants: (variants.get(row.id) ?? []).map((variant) => ({ id: variant.id, label: variant.label, soldOut: variant.stock !== null && variant.stock <= 0 })),
  }));
}

/** A member's own orders, newest first — «Comenzile mele». */
export async function listOrdersOfMember<T extends Record<string, unknown>>(db: Database<T>, memberId: string) {
  return db
    .select({
      id: shopOrders.id,
      number: shopOrders.number,
      productTitleRo: shopOrders.productTitleRo,
      productTitleEn: shopOrders.productTitleEn,
      variantLabel: shopOrders.variantLabel,
      quantity: shopOrders.quantity,
      unitPriceBani: shopOrders.unitPriceBani,
      note: shopOrders.note,
      status: shopOrders.status,
      createdAt: shopOrders.createdAt,
    })
    .from(shopOrders)
    .where(eq(shopOrders.memberStaffUserId, memberId))
    .orderBy(desc(shopOrders.createdAt), desc(shopOrders.number));
}

export type MemberOrder = Awaited<ReturnType<typeof listOrdersOfMember>>[number];

/** The orders list's filter, read strictly from the address: anything unknown is «all». */
export type OrdersQuery = { status: ShopOrderStatus | null; productId: string | null };

export function parseOrdersQuery(params: Record<string, string | string[] | undefined>): OrdersQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const status = one(params.orderStatus);
  const product = one(params.orderProduct);
  return {
    status: (shopOrderStatus.enumValues as readonly string[]).includes(status) ? (status as ShopOrderStatus) : null,
    productId: isUuid(product) ? product.toLowerCase() : null,
  };
}

/** The orders under the filter, newest first, with the member's address when the account still exists. */
export async function listOrdersForAdmin<T extends Record<string, unknown>>(db: Database<T>, query: OrdersQuery, limit = 500) {
  const conditions: SQL[] = [];
  if (query.status) conditions.push(eq(shopOrders.status, query.status));
  if (query.productId) conditions.push(eq(shopOrders.productId, query.productId));
  return db
    .select({
      id: shopOrders.id,
      number: shopOrders.number,
      memberName: shopOrders.memberName,
      memberEmail: staffUsers.email,
      productId: shopOrders.productId,
      productTitleRo: shopOrders.productTitleRo,
      productTitleEn: shopOrders.productTitleEn,
      variantLabel: shopOrders.variantLabel,
      quantity: shopOrders.quantity,
      unitPriceBani: shopOrders.unitPriceBani,
      note: shopOrders.note,
      status: shopOrders.status,
      cancelledBy: shopOrders.cancelledBy,
      createdAt: shopOrders.createdAt,
      paidAt: shopOrders.paidAt,
      handedOverAt: shopOrders.handedOverAt,
      cancelledAt: shopOrders.cancelledAt,
    })
    .from(shopOrders)
    .leftJoin(staffUsers, eq(staffUsers.id, shopOrders.memberStaffUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(shopOrders.createdAt), desc(shopOrders.number))
    .limit(limit);
}

export type AdminOrder = Awaited<ReturnType<typeof listOrdersForAdmin>>[number];
