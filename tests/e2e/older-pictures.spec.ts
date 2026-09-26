import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-054-01 criterion 14, BR-REQ-050-03 criterion 23 (`DECISIONS.md` §NNN) — the one-off
 * button on the task board that gives the pictures stored before §414 their phone sizes.
 *
 * The older picture is the setup, not the subject, so it is written the way the site wrote one
 * before §414 — a version-4 prefix, a master and a thumbnail in the local store, a row, and a
 * published standing page whose body names it — straight into the database and the `.media`
 * directory the server reads (`STORAGE_MODE` is `local` under `.env.local`), as
 * `bulk-cancel-count.spec.ts` seeds its own event. What is tested is what a person does and sees:
 * the card on `/admin/tasks`, its question, the toast, and the public page asking for the
 * smaller files — with the old address still answering.
 *
 * Both projects run this at once and press the same button, which converts every older picture,
 * the other project's included. So a project whose picture the other already converted finds no
 * card and goes straight to the page: the outcome under test — this picture has its ladder, and
 * both its addresses answer — holds either way.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** The environment segment of every object key (`storage.ts#objectKey`). */
function appEnv(): string {
  databaseUrl();
  return process.env.APP_ENV ?? "local";
}

/** Every candidate of a `srcset`, with its width. */
function candidates(srcset: string): { url: string; width: number }[] {
  return srcset.split(", ").map((entry) => {
    const [url, width] = entry.split(" ");
    return { url, width: Number(width.slice(0, -1)) };
  });
}

test.describe.serial("BR-REQ-054-01 the older pictures get their phone sizes (§NNN)", () => {
  test("a picture from before the ladder, on a published page, gets its sizes from the task board; its old address still answers", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `poza-veche-${suffix}`;
    const alt = `Poza veche ${suffix}`;

    // A picture as the site stored one before §414.
    const oldPrefix = randomUUID();
    const master = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#2255ee" } }).webp({ quality: 88 }).toBuffer();
    const thumb = await sharp(master).resize({ width: 480 }).webp({ quality: 78 }).toBuffer();
    const directory = path.join(process.cwd(), ".media", appEnv(), oldPrefix);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "web.webp"), master);
    await writeFile(path.join(directory, "thumb.webp"), thumb);
    const oldSrc = `/api/media/${appEnv()}/${oldPrefix}/web.webp`;
    const body = (text: string) => ({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text }] },
        { type: "image", attrs: { src: oldSrc, alt, width: 1600, height: 1200 } },
      ],
    });
    const assetId = await withDatabase(async (client) => {
      const asset = await client.query<{ id: string }>(
        `INSERT INTO media_assets (key_prefix, original_filename, width, height, byte_size) VALUES ($1, 'veche.jpg', 1600, 1200, $2) RETURNING id`,
        [oldPrefix, master.byteLength],
      );
      const created = await client.query<{ id: string }>(
        `INSERT INTO pages (editorial_status, published_at, nav_order) VALUES ('PUBLISHED', now() - interval '1 day', 90) RETURNING id`,
      );
      await client.query(
        `INSERT INTO page_translations (page_id, locale, slug, title, body_json) VALUES ($1, 'ro', $2, $3, $4), ($1, 'en', $5, $6, $7)`,
        [created.rows[0].id, slug, `Poza veche ${suffix}`, body("O poză de dinainte."), `old-picture-${suffix}`, `Old picture ${suffix}`, body("A picture from before.")],
      );
      return asset.rows[0].id;
    });

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/tasks");
    const card = page.getByTestId("older-pictures");
    if (await card.isVisible()) {
      await expect(card.getByTestId("older-pictures-left")).toContainText("fără mărimi");
      await expect(card).toContainText("vechea adresă merge în continuare");
      await card.getByRole("button", { name: /^Fă mărimile pentru \d+/ }).click();
      await confirmDialog(page, "Faci mărimile pentru telefon?");
      await page.waitForURL(/saved=picturesLaddered/, { timeout: 60_000 });
      await expect(page.getByTestId("toast")).toContainText("mărimile pentru telefon", { timeout: 30_000 });
    }

    // The row moved to its laddered prefix — this press's, or the other project's.
    const newPrefix = await withDatabase(async (client) => (await client.query<{ key_prefix: string }>(`SELECT key_prefix FROM media_assets WHERE id = $1`, [assetId])).rows[0].key_prefix);
    expect(newPrefix).toBe(`${oldPrefix.slice(0, 14)}8${oldPrefix.slice(15)}`);

    // The public page now names the smaller files, every one of them there, then the same master.
    await page.goto(`/ro/pagini/${slug}`);
    const picture = page.getByRole("img", { name: alt });
    await expect(picture).toBeVisible();
    const pictureSet = (await picture.getAttribute("srcset")) as string;
    expect(pictureSet).toMatch(/\/480w\.webp 480w, .*\/1280w\.webp 1280w, \S+\/web\.webp 1600w$/);
    expect(pictureSet).toContain(newPrefix);
    for (const candidate of candidates(pictureSet)) {
      const answer = await page.request.get(candidate.url);
      expect(answer.status(), candidate.url).toBe(200);
      expect((await sharp(await answer.body()).metadata()).width, candidate.url).toBe(candidate.width);
    }
    const newMaster = await page.request.get(candidates(pictureSet).pop()!.url);
    expect(Buffer.from(await newMaster.body()).equals(master)).toBe(true);

    // The old address keeps answering with the same file: a link copied elsewhere does not break.
    const oldAnswer = await page.request.get(oldSrc);
    expect(oldAnswer.status()).toBe(200);
    expect(Buffer.from(await oldAnswer.body()).equals(master)).toBe(true);

    // And the card is gone once nothing is left to convert — judged only when nothing was left
    // on either side of the page's render, since the other project may be seeding its own.
    const left = () =>
      withDatabase(async (client) =>
        Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM media_assets WHERE key_prefix ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'`)).rows[0].n),
      );
    const before = await left();
    await page.goto("/ro/admin/tasks");
    await expect(page.getByRole("heading", { level: 1, name: "Ce mai este de făcut" })).toBeVisible();
    if (before === 0 && (await left()) === 0) await expect(page.getByTestId("older-pictures")).toHaveCount(0);
  });
});
