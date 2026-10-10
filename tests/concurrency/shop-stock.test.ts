import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { shopOrders, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { cancelOwnOrder, moveOrderByClub, placeOrder } from "@/modules/content/shop/orders";
import { createProduct, saveProduct } from "@/modules/content/shop/service";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * §683 — the members' shop never oversells, proven with real connections racing.
 *
 * A variant with a stock of one and ten members pressing «Comandă» at the same moment, each on its
 * own connection: the variant row is locked (`SELECT … FOR UPDATE`) in the order's own transaction,
 * so the ten queue on it, the first takes the one, and the nine after it read a stock of nothing and
 * are refused whole (CONFLICT). Then the stock comes back exactly once when that order is cancelled
 * twice at once. A member's double tap — the same order twice at once — is one order (§683), and a
 * cancellation racing a save that deletes the order's variant takes the locks in the same order as the
 * save (product, variant, order) and so never deadlocks. PGlite, one connection, cannot show any of it
 * (`tests/helpers/db.ts`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§683 ten members order the last one at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-10-10T09:00:00.000Z");
  const stamp = Date.now();
  let admin: StaffUser;
  let members: StaffUser[] = [];
  let productId: string | undefined;
  const otherProducts: string[] = [];

  beforeAll(async () => {
    [admin] = await db.insert(staffUsers).values({ email: `shop.admin.${stamp}@example.org`, displayName: "Admin", role: "ADMIN" }).returning();
    members = await db
      .insert(staffUsers)
      .values(Array.from({ length: 10 }, (_, index) => ({ email: `shop.member.${stamp}.${index}@example.org`, displayName: `Membru ${index}`, role: "MEMBER" as const })))
      .returning();
    const product = await createProduct(db, {
      actor: admin,
      fields: { titleRo: "Buff exemplu", titleEn: "Sample buff", price: "20", variants: "", stock: "1", visible: true },
      now: NOW,
    });
    productId = product.id;
  });

  afterAll(async () => {
    for (const id of [productId, ...otherProducts]) {
      if (!id) continue;
      const orders = await db.select({ id: shopOrders.id }).from(shopOrders).where(eq(shopOrders.productId, id));
      const ids = orders.map((row) => row.id);
      if (ids.length > 0) await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids));
      await db.delete(shopOrders).where(eq(shopOrders.productId, id));
      await db.delete(auditLogs).where(eq(auditLogs.entityId, id));
      await db.delete(shopProducts).where(eq(shopProducts.id, id));
    }
    const people = [admin, ...members].filter(Boolean);
    await db.delete(emailOutbox).where(inArray(emailOutbox.recipientEmail, people.map((person) => person.email)));
    await db.delete(staffUsers).where(inArray(staffUsers.id, people.map((person) => person.id)));
    await pool.end();
  });

  it("exactly one order is taken, nine are refused whole, and the stock never goes below zero", async () => {
    const [variant] = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, productId!));
    const results = await Promise.allSettled(
      members.map((member) =>
        placeOrder(db, { account: member, locale: "ro", noticeDescribes: true, fields: { productId, variantId: variant.id, quantity: "1", note: "" }, now: NOW }),
      ),
    );
    const taken = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(taken).toHaveLength(1);
    expect(refused).toHaveLength(9);
    for (const result of refused) expect(isDomainError(result.reason) && result.reason.code).toBe("CONFLICT");
    const [after] = await db.select({ stock: shopProductVariants.stock }).from(shopProductVariants).where(eq(shopProductVariants.id, variant.id));
    expect(after.stock).toBe(0);
    expect(await db.select().from(shopOrders).where(eq(shopOrders.productId, productId!))).toHaveLength(1);
  });

  it("two cancellations of that order at once give the stock back once", async () => {
    const [placed] = await db.select().from(shopOrders).where(eq(shopOrders.productId, productId!));
    const owner = members.find((member) => member.id === placed.memberStaffUserId)!;
    const results = await Promise.allSettled([
      cancelOwnOrder(db, { account: owner, orderId: placed.id, now: NOW }),
      cancelOwnOrder(db, { account: owner, orderId: placed.id, now: NOW }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [after] = await db.select({ stock: shopProductVariants.stock }).from(shopProductVariants).where(eq(shopProductVariants.productId, productId!));
    expect(after.stock).toBe(1);
  });

  it("a double tap — the same order twice at once — is one order, taking the stock once", async () => {
    const product = await createProduct(db, {
      actor: admin,
      fields: { titleRo: "Tricou dublu", titleEn: "Double t-shirt", price: "45", variants: "", stock: "5", visible: true },
      now: NOW,
    });
    otherProducts.push(product.id);
    const [variant] = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, product.id));
    const press = () =>
      placeOrder(db, { account: members[0], locale: "ro", noticeDescribes: true, fields: { productId: product.id, variantId: variant.id, quantity: "2", note: "" }, now: new Date() });
    const [first, second] = await Promise.all([press(), press()]);
    expect(second.id).toBe(first.id);
    const [after] = await db.select({ stock: shopProductVariants.stock }).from(shopProductVariants).where(eq(shopProductVariants.id, variant.id));
    expect(after.stock).toBe(3);
    expect(await db.select().from(shopOrders).where(eq(shopOrders.productId, product.id))).toHaveLength(1);
  });

  it("a cancellation racing a save that removes the order's size never deadlocks: the save is refused (§700), the stock comes back once", async () => {
    const fields = { titleRo: "Buff cu mărimi", titleEn: "Sized buff", price: "20", variants: "S: 5\nM: 5", stock: "", visible: true };
    for (let round = 0; round < 25; round++) {
      const product = await createProduct(db, { actor: admin, fields, now: NOW });
      otherProducts.push(product.id);
      const [small] = await db.select().from(shopProductVariants).where(and(eq(shopProductVariants.productId, product.id), eq(shopProductVariants.label, "S")));
      const placed = await placeOrder(db, {
        account: members[(round % 9) + 1],
        locale: "ro",
        noticeDescribes: true,
        fields: { productId: product.id, variantId: small.id, quantity: "1", note: "" },
        now: NOW,
      });
      const [cancelled, saved] = await Promise.allSettled([
        moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "cancel", now: NOW }),
        saveProduct(db, { actor: admin, productId: product.id, expectedVersion: product.version, fields: { ...fields, variants: "M: 5" }, now: NOW }),
      ]);
      // The cancellation always completes; a deadlock (40P01) would reject it or the save with a database error.
      if (cancelled.status === "rejected") throw cancelled.reason;
      expect(saved.status).toBe("rejected");
      const refusal = (saved as PromiseRejectedResult).reason;
      expect(isDomainError(refusal) && refusal.code).toBe("SHOP_SIZE_HAS_ORDERS");
      expect(refusal.fields).toEqual(["sizes"]);
      const [after] = await db.select().from(shopOrders).where(eq(shopOrders.id, placed.id));
      expect(after).toMatchObject({ status: "CANCELLED", variantId: small.id, stockTaken: false });
      const [variant] = await db.select().from(shopProductVariants).where(eq(shopProductVariants.id, small.id));
      expect(variant.stock).toBe(5);
    }
  });

  it("a cancellation racing a save that removes another, order-free size never deadlocks, and both complete", async () => {
    const fields = { titleRo: "Buff două mărimi", titleEn: "Two-size buff", price: "20", variants: "S: 5\nM: 5", stock: "", visible: true };
    for (let round = 0; round < 25; round++) {
      const product = await createProduct(db, { actor: admin, fields, now: NOW });
      otherProducts.push(product.id);
      const [medium] = await db.select().from(shopProductVariants).where(and(eq(shopProductVariants.productId, product.id), eq(shopProductVariants.label, "M")));
      const placed = await placeOrder(db, {
        account: members[(round % 9) + 1],
        locale: "ro",
        noticeDescribes: true,
        fields: { productId: product.id, variantId: medium.id, quantity: "1", note: "" },
        now: NOW,
      });
      const results = await Promise.allSettled([
        moveOrderByClub(db, { actor: admin, orderId: placed.id, verb: "cancel", now: NOW }),
        saveProduct(db, { actor: admin, productId: product.id, expectedVersion: product.version, fields: { ...fields, variants: "M: 5" }, now: NOW }),
      ]);
      for (const result of results) {
        if (result.status === "rejected") throw result.reason;
      }
      const rows = await db.select().from(shopProductVariants).where(eq(shopProductVariants.productId, product.id));
      expect(rows.map((row) => row.label)).toEqual(["M"]);
      const [after] = await db.select().from(shopOrders).where(eq(shopOrders.id, placed.id));
      expect(after).toMatchObject({ status: "CANCELLED", variantId: medium.id, stockTaken: false });
    }
  });
});
