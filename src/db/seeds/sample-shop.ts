import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { shopProductVariants, shopProducts } from "@/db/schema/shop";

/**
 * The members' shop's one sample product: hidden, made up, three sizes — so the product's page in the
 * backoffice can be walked on a fresh database (the e2e sweep opens it). Only into an empty table;
 * refuses production (AGENTS.md §7.7).
 */
export async function seedSampleShop(): Promise<number> {
  if ((process.env.APP_ENV ?? "local") === "production") {
    throw new Error("Refusing to seed the shop on production. AGENTS.md §7.7: production is never auto-seeded.");
  }
  const db = getDb();
  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(shopProducts);
  if ((existing?.count ?? 0) > 0) return 0;

  const [product] = await db
    .insert(shopProducts)
    .values({
      titleRo: "Tricou de probă",
      titleEn: "Sample T-shirt",
      descriptionRo: "Un produs de exemplu, ascuns în magazin.",
      descriptionEn: "A sample product, hidden from the shop.",
      priceBani: 4500,
      currency: "RON",
      visible: false,
      position: 1,
    })
    .returning({ id: shopProducts.id });

  await db
    .insert(shopProductVariants)
    .values(["S", "M", "L"].map((label, index) => ({ productId: product.id, label, position: index + 1 })));
  return 1;
}
