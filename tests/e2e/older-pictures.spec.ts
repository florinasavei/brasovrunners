import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-054-01 criterion 14, BR-REQ-090-05 criterion 14 (`DECISIONS.md` §NNN) — the one-off
 * button on the task board that gives the pictures stored before §414 their phone sizes.
 *
 * The older picture is the setup, not the subject, so it is written the way the site wrote one
 * before §414 — a version-4 prefix, a master and a thumbnail, a row, and a published standing
 * page whose body names it — straight into the database and the `.media` directory, as
 * `bulk-cancel-count.spec.ts` seeds its own event. Under `.env.local` the server's store is that
 * directory (`STORAGE_MODE` `local`); under CI's `APP_ENV=test` it is a Map inside the server,
 * and `E2E_FAKE_MEDIA_FROM_DISK` (set by `playwright.config.ts`) lets a miss there read the same
 * directory — so the spec seeds one way and the server finds the picture in both. What is tested
 * is what a person does and sees: the card on `/admin/tasks` and its count, its question, the
 * toast, the count going down, the public page asking for the smaller files — with the old
 * address still answering.
 *
 * The two projects press the same button, which converts every older picture, the other
 * project's included; so the whole test — seed, press, look — holds an advisory lock the other
 * project waits on, and each project presses for its own picture every time.
 */

/** This spec's own key for PostgreSQL's advisory locks. */
const LOCK_KEY = 414_000_901;

/** A version-4 prefix — what the button converts (`ladder.ts`, `FORMER_KEY_PREFIX_PATTERN`). */
const OLDER = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
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

/** One press, answered: the numbers the action put in the address (`giveOlderPicturesLadderAction`). */
async function press(page: Page, left: number): Promise<{ saved: string; count: number; left: number; failed: number }> {
  await page.goto("/ro/admin/tasks");
  const card = page.getByTestId("older-pictures");
  // The card says the count the database says — before anything is pressed.
  await expect(card.getByTestId("older-pictures-left")).toContainText(`${left} `);
  await expect(card.getByTestId("older-pictures-left")).toContainText("fără mărimi");
  await expect(card).toContainText("vechea adresă merge în continuare");
  await card.getByRole("button", { name: /^Fă mărimile pentru \d+/ }).click();
  await confirmDialog(page, "Faci mărimile pentru telefon?");
  // Anchored: `picturesLadderedFailed` is a different answer, and must not pass for this one.
  await page.waitForURL(/[?&]saved=picturesLaddered(Failed)?&count=\d+&left=\d+&failed=\d+/, { timeout: 60_000 });
  const url = new URL(page.url());
  const answer = {
    saved: url.searchParams.get("saved") as string,
    count: Number(url.searchParams.get("count")),
    left: Number(url.searchParams.get("left")),
    failed: Number(url.searchParams.get("failed")),
  };
  await expect(page.getByTestId("toast")).toContainText("mărimile pentru telefon", { timeout: 30_000 });
  return answer;
}

test.describe("BR-REQ-054-01 the older pictures get their phone sizes (§NNN)", () => {
  test("a picture from before the ladder, on a published page, gets its sizes from the task board; its old address still answers", async ({ page }) => {
    // Long, because the second project waits on the lock for the first.
    test.setTimeout(240_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `poza-veche-${suffix}`;
    const alt = `Poza veche ${suffix}`;

    const db = new pg.Client({ connectionString: databaseUrl() });
    await db.connect();
    await db.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    try {
      const waiting = async () => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM media_assets WHERE key_prefix ~ $1`, [OLDER])).rows[0].n);
      // What was waiting before this spec seeded anything: nothing on CI's fresh database; a
      // developer's may hold older pictures of its own, or one whose file is gone.
      const already = await waiting();

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
      const asset = await db.query<{ id: string }>(
        `INSERT INTO media_assets (key_prefix, original_filename, width, height, byte_size) VALUES ($1, 'veche.jpg', 1600, 1200, $2) RETURNING id`,
        [oldPrefix, master.byteLength],
      );
      const assetId = asset.rows[0].id;
      const created = await db.query<{ id: string }>(
        `INSERT INTO pages (editorial_status, published_at, nav_order) VALUES ('PUBLISHED', now() - interval '1 day', 90) RETURNING id`,
      );
      await db.query(
        `INSERT INTO page_translations (page_id, locale, slug, title, body_json) VALUES ($1, 'ro', $2, $3, $4), ($1, 'en', $5, $6, $7)`,
        [created.rows[0].id, slug, `Poza veche ${suffix}`, body("O poză de dinainte."), `old-picture-${suffix}`, `Old picture ${suffix}`, body("A picture from before.")],
      );
      const keyPrefix = async () => (await db.query<{ key_prefix: string }>(`SELECT key_prefix FROM media_assets WHERE id = $1`, [assetId])).rows[0].key_prefix;

      await signIn(page, "Dev Administrator");
      if (already === 0) {
        // The exact outcome: this picture alone was waiting, and one press converts it.
        const answer = await press(page, 1);
        expect(answer).toEqual({ saved: "picturesLaddered", count: 1, left: 0, failed: 0 });
        // Nothing is left, so the card is gone.
        await expect(page.getByRole("heading", { level: 1, name: "Ce mai este de făcut" })).toBeVisible();
        await expect(page.getByTestId("older-pictures")).toHaveCount(0);
      } else {
        // A database with older pictures of its own: press until this one is converted, each
        // press converting at least one and the count going down, a failure only for a picture
        // that was there before this spec (a file gone from a developer's disk).
        for (let presses = 0; (await keyPrefix()) === oldPrefix; presses += 1) {
          expect(presses, "the button never reached this spec's picture").toBeLessThan(10);
          const before = await waiting();
          const answer = await press(page, before);
          expect(answer.count + answer.failed).toBeGreaterThanOrEqual(1);
          expect(answer.failed).toBeLessThanOrEqual(already);
          expect(answer.left).toBe(before - answer.count);
          expect(answer.saved).toBe(answer.failed > 0 ? "picturesLadderedFailed" : "picturesLaddered");
          if (answer.left === 0) await expect(page.getByTestId("older-pictures")).toHaveCount(0);
          else await expect(page.getByTestId("older-pictures-left")).toContainText(`${answer.left} `);
        }
      }

      // The row moved to its laddered prefix.
      const newPrefix = await keyPrefix();
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
    } finally {
      await db.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
      await db.end();
    }
  });
});
