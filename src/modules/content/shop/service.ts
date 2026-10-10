import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { type ShopProduct, shopOrders, shopProducts, shopProductVariants } from "@/db/schema/shop";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database, Transaction } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { mediaAssetKeyPrefix } from "@/modules/content/team/repository";
import { canManageShop } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { stockToSave, variantKey } from "./domain";
import { type ProductFields, productFieldsSchema } from "./fields";

/**
 * «Magazin»'s catalogue (§683): add, write, move, delete or archive a product. Every write is the
 * Administrator's and the Superadministrator's (`canManageShop`), asserted here whatever the screen
 * offered (BR-REQ-060-01), and leaves an audit row with the product's id — never its words.
 * Nothing here expires the public cache: the shop is on no public page.
 */

type Actor = Pick<StaffUser, "id" | "role">;

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

function assertMayManage(actor: Actor): void {
  if (!canManageShop(actor.role)) throw new DomainError("FORBIDDEN", `role ${actor.role} may not manage the members' shop`);
}

function assertProductId(productId: string): void {
  if (!isUuid(productId)) throw new DomainError("NOT_FOUND", "no such product");
}

/** A photo id must name a stored picture, never a film's poster (§485) — «Echipa»'s rule (§459). */
async function assertPhoto<T extends Record<string, unknown>>(db: Database<T>, fields: ProductFields): Promise<void> {
  if (!fields.photoAssetId) return;
  const keyPrefix = await mediaAssetKeyPrefix(db, fields.photoAssetId);
  if (keyPrefix === null || keyPrefix.startsWith("yt-")) {
    throw new DomainError("VALIDATION_ERROR", "the photo is not a stored picture", ["photoAssetId"]);
  }
}

/**
 * The variants as typed, written against the rows that exist: matched by label (without regard to
 * case), a kept one updated in place — its stock left as it stands unless the Administrator changed
 * the number the form loaded (`stockToSave`), so an order placed meanwhile is never undone — a new
 * one added, and one no longer listed deleted (an order keeps its own copy of the label).
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
    if (!kept.has(row.id)) await tx.delete(shopProductVariants).where(eq(shopProductVariants.id, row.id));
  }
}

/** Add a product at the end of the list. Hidden unless «Vizibil în magazin» was ticked. */
export async function createProduct<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; fields: unknown; now?: Date },
): Promise<ShopProduct> {
  assertMayManage(input.actor);
  const fields = parseOrThrow(input.fields);
  await assertPhoto(db, fields);
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [last] = await tx.select({ position: sql<number>`coalesce(max(${shopProducts.position}), 0)`.mapWith(Number) }).from(shopProducts);
    const [row] = await tx
      .insert(shopProducts)
      .values({
        titleRo: fields.titleRo,
        titleEn: fields.titleEn,
        descriptionRo: fields.descriptionRo,
        descriptionEn: fields.descriptionEn,
        priceBani: fields.priceBani,
        photoMediaAssetId: fields.photoAssetId,
        photoCrop: fields.photoCrop,
        visible: fields.visible,
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
      metadata: { visible: row.visible, variants: fields.variants.length, photo: fields.photoAssetId !== null },
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
  assertProductId(input.productId);
  const fields = parseOrThrow(input.fields);
  await assertPhoto(db, fields);
  const now = input.now ?? new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(shopProducts)
      .set({
        titleRo: fields.titleRo,
        titleEn: fields.titleEn,
        descriptionRo: fields.descriptionRo,
        descriptionEn: fields.descriptionEn,
        priceBani: fields.priceBani,
        photoMediaAssetId: fields.photoAssetId,
        photoCrop: fields.photoCrop,
        visible: fields.visible,
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
      metadata: { version: updated.version, visible: updated.visible, variants: fields.variants.length },
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
  assertProductId(input.productId);
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
  assertProductId(input.productId);
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
