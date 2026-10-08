import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { fillDateField, signIn } from "./support/featured-event";

/**
 * «Înlocuiește» on an album's photo (§673; BR-REQ-054-01) — through the browser, at both viewports.
 *
 * What the integration suite cannot see: the button's file input, the browser's shrink at the
 * remembered quality, the post to the album's upload route, and the page re-rendered with the new
 * picture in the same place. The first photo is the cover, so replacing it also proves the cover
 * follows it to the public gallery. Local storage mode (`APP_ENV=local`): the objects are served
 * back by `/api/media/…`, and the old picture's address answers 404 once it is replaced.
 */
test.describe.serial("§673 «Înlocuiește» on an album's photo", () => {
  let slug = "";
  let editorUrl = "";

  test("replaces the cover photo in place, and the public album and its card show the new picture", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `inlocuieste-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/gallery/new");
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await fillDateField(page, "Data fotografiilor", "2026-10-04");
    await field("translations.ro.title").fill(`Înlocuiește ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Replace ${suffix}`);
    await field("translations.en.slug").fill(`replace-${suffix}`);
    await page.getByRole("button", { name: "Album nou" }).click();
    await expect(page).toHaveURL(/\/admin\/gallery\/[0-9a-f-]{36}/);
    editorUrl = page.url();

    // Two photos, the first of them the cover.
    const blue = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#2255ee" } }).jpeg().toBuffer();
    const green = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#22aa44" } }).jpeg().toBuffer();
    await page.locator("#photo-upload").setInputFiles([
      { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: blue },
      { name: "IMG_0002.jpg", mimeType: "image/jpeg", buffer: green },
    ]);
    await expect(page.getByText("2 fotografii încărcate.")).toBeVisible({ timeout: 30_000 });

    const tiles = page.locator("main ul > li").filter({ has: page.locator("img[src*='/api/media/']") });
    await expect(tiles).toHaveCount(2, { timeout: 20_000 });
    const firstThumb = tiles.nth(0).locator("img");
    const secondThumb = tiles.nth(1).locator("img");
    const oldFirst = (await firstThumb.getAttribute("src")) as string;
    const oldSecond = (await secondThumb.getAttribute("src")) as string;

    // Beside «Șterge», a thumb's target (BR-REQ-041-01 criterion 6).
    const replace = tiles.nth(0).getByTestId("photo-replace");
    await expect(replace).toHaveText("Înlocuiește");
    expect((await replace.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(tiles.nth(0).getByRole("button", { name: "Șterge" })).toBeVisible();

    // A portrait, so the new picture is plainly another photograph.
    const portrait = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#ee5522" } }).jpeg().toBuffer();
    await tiles.nth(0).locator('input[type="file"]').setInputFiles({ name: "IMG_0003.jpg", mimeType: "image/jpeg", buffer: portrait });
    await expect(tiles.nth(0).getByTestId("photo-replace-note")).toHaveText("Fotografia a fost înlocuită.", { timeout: 30_000 });

    // The same place, a new address; the other photo untouched; the old picture gone from the store.
    await expect.poll(() => firstThumb.getAttribute("src"), { timeout: 20_000 }).not.toBe(oldFirst);
    const newFirst = (await firstThumb.getAttribute("src")) as string;
    expect(await firstThumb.getAttribute("width")).toBe("900");
    expect(await secondThumb.getAttribute("src")).toBe(oldSecond);
    expect((await page.request.get(oldFirst)).status()).toBe(404);
    expect((await page.request.get(newFirst)).status()).toBe(200);
    const newPrefix = newFirst.split("/").at(-2) as string;

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);

    // The public album: the new picture first, where the old one was.
    await page.goto(`/ro/galerie/${slug}`);
    const links = page.locator("main a[href$='web.webp']");
    await expect(links).toHaveCount(2);
    expect(await links.nth(0).getAttribute("href")).toContain(`/${newPrefix}/`);
    // And the album's card on the gallery: the cover followed the photo.
    await page.goto("/ro/galerie");
    const card = page.getByRole("link", { name: new RegExp(`Înlocuiește ${suffix}`) }).first();
    await expect(card.locator(`img[src*='/${newPrefix}/']`)).toHaveCount(1);
  });

  test("removes the album afterwards", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Șterge albumul" }).click();
    await confirmDialog(page);
    await page.waitForURL(/\/admin\/gallery\?saved=deleted/);
    expect((await page.goto(`/ro/galerie/${slug}`))?.status()).toBe(404);
  });
});
