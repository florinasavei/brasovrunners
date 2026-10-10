import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration `0138_shop_product_editor` (`DECISIONS.md` §697), proven on real PostgreSQL (PGlite): a
 * product written by §683 with one photo and a crop keeps it as its first picture, position 1, the
 * crop copied; a product with no photo gets none; the backfill is safe to run twice.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0138_shop_product_editor";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let client: PGlite;
let folder: string;
const CROP = { x: 0.1, y: 0.2, w: 0.5, h: 0.5 };

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);

  folder = mkdtempSync(path.join(tmpdir(), "shop-pictures-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  await client.exec(`
    INSERT INTO media_assets (id, key_prefix, original_filename, width, height, byte_size)
      VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'shop/a', 'a.jpg', 1600, 1200, 1000);
    INSERT INTO shop_products (id, title_ro, title_en, price_bani, position, photo_media_asset_id, photo_crop) VALUES
      ('bbbbbbbb-0000-4000-8000-000000000001', 'Tricou', 'T-shirt', 5000, 1, 'aaaaaaaa-0000-4000-8000-000000000001', '${JSON.stringify(CROP)}'),
      ('bbbbbbbb-0000-4000-8000-000000000002', 'Fular', 'Buff', 2000, 2, NULL, NULL);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0138_shop_product_editor — the one photo becomes the first picture", () => {
  it("copies the photo and its crop to position 1, and gives a product without a photo none", async () => {
    const { rows } = await client.query<{ product_id: string; media_asset_id: string; crop: unknown; position: number }>(
      `SELECT product_id, media_asset_id, crop, position FROM shop_product_pictures ORDER BY product_id`,
    );
    expect(rows).toEqual([{ product_id: "bbbbbbbb-0000-4000-8000-000000000001", media_asset_id: "aaaaaaaa-0000-4000-8000-000000000001", crop: CROP, position: 1 }]);
  });

  it("is idempotent: running the backfill again adds nothing", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    const backfill = sql.split("--> statement-breakpoint").pop() ?? "";
    await client.exec(backfill);
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM shop_product_pictures`);
    expect(rows[0]?.n).toBe(1);
  });
});
