import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { emailOutbox } from "@/db/schema/email-outbox";
import { shopOrders, shopProducts, shopProductVariants } from "@/db/schema/shop";
import { type StaffUser, staffUsers } from "@/db/schema/staff-users";
import { cancelOwnOrder, placeOrder } from "@/modules/content/shop/orders";
import { createProduct } from "@/modules/content/shop/service";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * §NNN — the members' shop never oversells, proven with real connections racing.
 *
 * A variant with a stock of one and ten members pressing «Comandă» at the same moment, each on its
 * own connection: the variant row is locked (`SELECT … FOR UPDATE`) in the order's own transaction,
 * so the ten queue on it, the first takes the one, and the nine after it read a stock of nothing and
 * are refused whole (CONFLICT). Then the stock comes back exactly once when that order is cancelled
 * twice at once. PGlite, one connection, cannot show any of it (`tests/helpers/db.ts`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("tests/concurrency needs a real PostgreSQL: set DATABASE_URL and migrate first.");

describe("§NNN ten members order the last one at once", () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
  const db = drizzle(pool);
  const NOW = new Date("2026-10-10T09:00:00.000Z");
  const stamp = Date.now();
  let admin: StaffUser;
  let members: StaffUser[] = [];
  let productId: string | undefined;

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
    if (productId) {
      const orders = await db.select({ id: shopOrders.id }).from(shopOrders).where(eq(shopOrders.productId, productId));
      const ids = orders.map((row) => row.id);
      if (ids.length > 0) await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids));
      await db.delete(shopOrders).where(eq(shopOrders.productId, productId));
      await db.delete(auditLogs).where(eq(auditLogs.entityId, productId));
      await db.delete(shopProducts).where(eq(shopProducts.id, productId));
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
});
