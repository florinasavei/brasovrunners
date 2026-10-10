import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { type ShopProduct, type ShopProductPicture, shopOrders, shopProductPictures, shopProducts, shopProductVariants } from "@/db/schema/shop";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { mediaAssetKeyPrefix } from "@/modules/content/team/repository";
import { canManageShop, type StaffActor } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { PICTURES_MAX, stockToSave, variantKey } from "./domain";
import { type PictureFields, pictureFieldsSchema, type ProductFields, productFieldsSchema } from "./fields";

/**
 * «Magazin»'s catalogue (§683, §NNN): add, write, move, delete or archive a product, and keep its
 * pictures. Every write is `canManageShop`'s — the Administrator and the Superadministrator by rank,
 * a colleague given «Gestionează magazinul» (§687) — asserted here whatever the screen offered
 * (BR-REQ-060-01), and leaves an audit row with the product's id — never its words.
 * Nothing here expires the public cache: the shop is on no public page.
 */

type Actor = Pick<StaffUser, "id"> & StaffActor;

function parseOrThrow(value: unknown): ProductFields {
  const parsed = productFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))],
    );
  }
  return parsed.data;
}

function parsePictureOrThrow(value: unknown): PictureFields {
  const parsed = pictureFieldsSchema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", parsed.error.issues.map((issue) => issue.message).join("; "), ["photoAssetId"]);
  }
  return parsed.data;
}

function assertMayManage(actor: Actor): void {
  if (!canManageShop(actor)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not manage the members' shop`);
}

function assertId(id: string, what: string): void {
  if (!isUuid(id)) throw new DomainError("NOT_FOUND", `no such ${what}`);
}

/** A picture's id must name a stored picture, never a film's poster (§485) — «Echipa»'s rule (§459). */
async function assertStoredPicture<T extends Record<string, unknown>>(db: Database<T>, assetId: string): Promise<void> {
  const keyPrefix = await mediaAssetKeyPrefix(db, assetId);
  if (keyPrefix === null || keyPrefix.startsWith("yt-")) {
    throw new DomainError("VALIDATION_ERROR", "the picture is not a stored picture", ["photoAssetId"]);
  }
}

/**
 * The variants as the form resolved them, written against the rows that exist: matched by label
 * (without regard to case), a kept one updated in place — its stock left as it stands unless the
 * Administrator changed the number the form loaded (`stockToSave`), so an order placed meanwhile is
 * never undone — a new one added, and one no longer listed deleted. **A size unticked that has any
 * order, cancelled ones included, is refused** (§NNN, `SHOP_SIZE_HAS_ORDERS`): the order keeps its own
 * copy of the label, but its variant id would dangle and its stock would have nowhere to go back to.
 */
async function writeVariants<T extends Record<string, unknown>>(tx: Transaction<T>, productId: string, fields: ProductFields, now: Date): Promise<void> {
  const existing = await tx
    .select()
    .from(shopProductVariants)
    .where(eq(shopProductVariants.productId, productId))
    .for("update");
  const byKey = new Map(existing.map((row) => [variantKey(row.label), row]));
  const kept = new Set<string>();
  for (const [index, variant] of fields.variants.entries()) {
    const key = variantKey(variant.label);
    const row = byKey.get(key);
    if (row) {
      kept.add(row.id);
      await tx
        .update(shopProductVariants)
        .set({ label: variant.label, stock: stockToSave(variant.stock, fields.variantsLoaded[key], row.stock), position: index + 1, updatedAt: now })
        .where(eq(shopProductVariants.id, row.id));
    } else {
      await tx.insert(shopProductVariants).values({ productId, label: variant.label, stock: variant.stock, position: index + 1, createdAt: now, updatedAt: now });
    }
  }
  for (const row of existing) {
    if (kept.has(row.id)) continue;
    const [orders] = await tx.select({ n: count() }).from(shopOrders).where(eq(shopOrders.variantId, row.id));
    if (Number(orders?.n ?? 0) > 0) {
      throw new DomainError("SHOP_SIZE_HAS_ORDERS", `the size ${row.label ?? "(one size)"} has orders and cannot be removed`, [row.label === null ? "stock" : "sizes"]);
    }
    await tx.delete(shopProductVariants).where(eq(shopProductVariants.id, row.id));
  }
}

/** The product's columns a create and a save both write from the form. */
function productColumns(fields: ProductFields) {
  return {
    titleRo: fields.titleRo,
    titleEn: fields.titleEn,
    descriptionRo: fields.descriptionRo,
    descriptionEn: fields.descriptionEn,
    descriptionRoJson: fields.descriptionRoJson,
    descriptionEnJson: fields.descriptionEnJson,
    priceBani: fields.priceBani,
    // The currency may change after orders exist: each order keeps the one it was placed in (§686).
    currency: fields.currency,
    sizeChart: fields.sizeChart,
    visible: fields.visible,
  };
}

/** Add a product at the end of the list. Hidden unless «Vizibil în magazin» was ticked; its pictures come after, one by one. */
export async function createProduct<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<ShopProduct> {
  assertMayManage(input.actor);
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [last] = await tx.select({ position: sql<number>`coalesce(max(${shopProducts.position}), 0)`.mapWith(Number) }).from(shopProducts);
    const [row] = await tx
      .insert(shopProducts)
      .values({
        ...productColumns(fields),
        position: (last?.position ?? 0) + 1,
        createdByStaffUserId: input.actor.id,
        updatedByStaffUserId: input.actor.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await writeVariants(tx, row.id, { ...fields, variantsLoaded: {} }, now);
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "shop.product.created",
      entityType: "shop_product",
      entityId: row.id,
      metadata: { visible: row.visible, currency: row.currency, variants: fields.variants.length, sizeChart: fields.sizeChart !== null },
      now,
    });
    return row;
  });
}

/** Save a product against the version it was loaded with: a colleague's save in between is a CONFLICT (AGENTS.md §11.5). */
export async function saveProduct<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; expectedVersion: number; fields: unknown; now?: Date },
): Promise<ShopProduct> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  const fields = parseOrThrow(input.fields);
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(shopProducts)
      .set({
        ...productColumns(fields),
        updatedByStaffUserId: input.actor.id,
        version: input.expectedVersion + 1,
        updatedAt: now,
      })
      .where(and(eq(shopProducts.id, input.productId), eq(shopProducts.version, input.expectedVersion), isNull(shopProducts.archivedAt)))
      .returning();
    if (!updated) return undefined;
    await writeVariants(tx, updated.id, fields, now);
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "shop.product.saved",
      entityType: "shop_product",
      entityId: updated.id,
      metadata: { version: updated.version, visible: updated.visible, currency: updated.currency, variants: fields.variants.length, sizeChart: fields.sizeChart !== null },
      now,
    });
    return updated;
  });
  if (row) return row;
  const [current] = await db
    .select({ version: shopProducts.version, archivedAt: shopProducts.archivedAt })
    .from(shopProducts)
    .where(eq(shopProducts.id, input.productId))
    .limit(1);
  if (!current || current.archivedAt) throw new DomainError("NOT_FOUND", "no such product");
  throw new DomainError("CONFLICT", `this product was saved by someone else: you loaded version ${input.expectedVersion}, the current version is ${current.version}`);
}

/** One place up or down, the whole list renumbered from the order on screen (`moveDiscountCode`'s rule). */
export async function moveProduct<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    const ordered = await tx
      .select({ id: shopProducts.id })
      .from(shopProducts)
      .where(isNull(shopProducts.archivedAt))
      .orderBy(asc(shopProducts.position), asc(shopProducts.createdAt));
    const index = ordered.findIndex((row) => row.id === input.productId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such product");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    for (const [position, row] of moved.entries()) {
      await tx.update(shopProducts).set({ position: position + 1 }).where(eq(shopProducts.id, row.id));
    }
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "shop.product.moved",
      entityType: "shop_product",
      entityId: input.productId,
      metadata: { direction: input.direction, position: target + 1 },
      now,
    });
  });
}

/**
 * Delete a product — or, when an order names it, archive it: out of the shop and the editor's list,
 * hidden, its row kept for the orders' filter; the orders keep their own copy of the title and the
 * price either way. Answers which of the two it did.
 */
export async function deleteProduct<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; now?: Date },
): Promise<"deleted" | "archived"> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [product] = await tx
      .select({ id: shopProducts.id, archivedAt: shopProducts.archivedAt })
      .from(shopProducts)
      .where(eq(shopProducts.id, input.productId))
      .for("update")
      .limit(1);
    if (!product || product.archivedAt) throw new DomainError("NOT_FOUND", "no such product");
    const [orders] = await tx.select({ n: count() }).from(shopOrders).where(eq(shopOrders.productId, input.productId));
    const ordered = Number(orders?.n ?? 0);
    if (ordered > 0) {
      await tx.update(shopProducts).set({ archivedAt: now, visible: false, updatedByStaffUserId: input.actor.id, updatedAt: now }).where(eq(shopProducts.id, input.productId));
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "shop.product.archived",
        entityType: "shop_product",
        entityId: input.productId,
        metadata: { orders: ordered },
        now,
      });
      return "archived";
    }
    await tx.delete(shopProducts).where(eq(shopProducts.id, input.productId));
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "shop.product.deleted",
      entityType: "shop_product",
      entityId: input.productId,
      metadata: {},
      now,
    });
    return "deleted";
  });
}

// --- The pictures (§NNN) --------------------------------------------------------------------------

/**
 * The product row locked for a change to its pictures — the writers' first lock (§683), so a
 * delete of the product and a change to its strip queue rather than cross — and refused for a
 * product that is gone or archived.
 */
async function lockProduct<T extends Record<string, unknown>>(tx: Transaction<T>, productId: string): Promise<void> {
  const [product] = await tx
    .select({ id: shopProducts.id, archivedAt: shopProducts.archivedAt })
    .from(shopProducts)
    .where(eq(shopProducts.id, productId))
    .for("update")
    .limit(1);
  if (!product || product.archivedAt) throw new DomainError("NOT_FOUND", "no such product");
}

/** The product's pictures in order, under the product's lock. */
async function picturesOf<T extends Record<string, unknown>>(tx: Transaction<T>, productId: string): Promise<ShopProductPicture[]> {
  return tx
    .select()
    .from(shopProductPictures)
    .where(eq(shopProductPictures.productId, productId))
    .orderBy(asc(shopProductPictures.position), asc(shopProductPictures.createdAt));
}

/**
 * After every change: the positions renumbered 1…n from the order given, the first picture
 * mirrored onto the product's photo columns (the cover; nothing reads them new, §NNN), the
 * product's `updated_at` moved — never its `version`, which guards the product form's boxes, so a
 * picture added while the form is open does not turn its save into a CONFLICT — and one audit row,
 * `shop.product.pictures_changed`, with the product's id and how many pictures it has now.
 */
async function settlePictures<T extends Record<string, unknown>>(
  tx: Transaction<T>,
  input: { actor: Actor; productId: string; ordered: readonly ShopProductPicture[]; change: "added" | "moved" | "removed" | "cropped" | "replaced"; now: Date },
): Promise<void> {
  for (const [index, picture] of input.ordered.entries()) {
    if (picture.position !== index + 1) {
      await tx.update(shopProductPictures).set({ position: index + 1, updatedAt: input.now }).where(eq(shopProductPictures.id, picture.id));
    }
  }
  const cover = input.ordered[0];
  await tx
    .update(shopProducts)
    .set({ photoMediaAssetId: cover?.mediaAssetId ?? null, photoCrop: cover?.crop ?? null, updatedByStaffUserId: input.actor.id, updatedAt: input.now })
    .where(eq(shopProducts.id, input.productId));
  await recordAuditEvent(tx, {
    actorStaffUserId: input.actor.id,
    action: "shop.product.pictures_changed",
    entityType: "shop_product",
    entityId: input.productId,
    metadata: { change: input.change, count: input.ordered.length },
    now: input.now,
  });
}

/** Add a picture at the end of the strip — the first one added is the cover. At most `PICTURES_MAX`. */
export async function addProductPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; fields: unknown; now?: Date },
): Promise<ShopProductPicture> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  const fields = parsePictureOrThrow(input.fields);
  await assertStoredPicture(db, fields.assetId);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    const existing = await picturesOf(tx, input.productId);
    if (existing.length >= PICTURES_MAX) throw new DomainError("VALIDATION_ERROR", `a product carries at most ${PICTURES_MAX} pictures`, ["photoAssetId"]);
    const [row] = await tx
      .insert(shopProductPictures)
      .values({ productId: input.productId, mediaAssetId: fields.assetId, crop: fields.crop, position: existing.length + 1, createdAt: now, updatedAt: now })
      .returning();
    await settlePictures(tx, { actor: input.actor, productId: input.productId, ordered: [...existing, row], change: "added", now });
    return row;
  });
}

/** One place up or down in the strip; moving the second to the first makes it the cover. */
export async function moveProductPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; pictureId: string; direction: "up" | "down"; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  assertId(input.pictureId, "picture");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    const ordered = await picturesOf(tx, input.productId);
    const index = ordered.findIndex((picture) => picture.id === input.pictureId);
    if (index === -1) throw new DomainError("NOT_FOUND", "no such picture");
    const target = input.direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return;
    const moved = [...ordered];
    [moved[index], moved[target]] = [moved[target], moved[index]];
    await settlePictures(tx, { actor: input.actor, productId: input.productId, ordered: moved, change: "moved", now });
  });
}

/** Take a picture off the strip (the stored file stays in the gallery, §73); the next one becomes the cover. */
export async function removeProductPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; pictureId: string; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  assertId(input.pictureId, "picture");
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    const ordered = await picturesOf(tx, input.productId);
    if (!ordered.some((picture) => picture.id === input.pictureId)) throw new DomainError("NOT_FOUND", "no such picture");
    await tx.delete(shopProductPictures).where(eq(shopProductPictures.id, input.pictureId));
    await settlePictures(tx, { actor: input.actor, productId: input.productId, ordered: ordered.filter((picture) => picture.id !== input.pictureId), change: "removed", now });
  });
}

/**
 * One picture of the strip changed in place: a new crop (§541's four fractions, or none — the file is
 * never touched), or another stored picture in the same place of the strip, the cover staying the
 * cover. Which it was is the audit row's `change`.
 */
export async function replaceProductPicture<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; productId: string; pictureId: string; fields: unknown; now?: Date },
): Promise<void> {
  assertMayManage(input.actor);
  assertId(input.productId, "product");
  assertId(input.pictureId, "picture");
  const fields = parsePictureOrThrow(input.fields);
  await assertStoredPicture(db, fields.assetId);
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await lockProduct(tx, input.productId);
    const ordered = await picturesOf(tx, input.productId);
    const current = ordered.find((picture) => picture.id === input.pictureId);
    if (!current) throw new DomainError("NOT_FOUND", "no such picture");
    const [updated] = await tx
      .update(shopProductPictures)
      .set({ mediaAssetId: fields.assetId, crop: fields.crop, updatedAt: now })
      .where(eq(shopProductPictures.id, current.id))
      .returning();
    await settlePictures(tx, {
      actor: input.actor,
      productId: input.productId,
      ordered: ordered.map((picture) => (picture.id === updated.id ? updated : picture)),
      change: current.mediaAssetId === fields.assetId ? "cropped" : "replaced",
      now,
    });
  });
}
