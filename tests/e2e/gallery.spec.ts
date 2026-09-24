import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { fillDateField, signIn } from "./support/featured-event";

/**
 * BR-REQ-054-01 — an album from the backoffice to the public site, through the browser.
 *
 * The one thing the unit and integration suites cannot see: the uploader. It runs in the
 * browser — decodes the photo, shrinks it on a canvas, posts the result — so it is exercised
 * here with a real image made on the fly by sharp, at both viewports. Local storage mode: the
 * end-to-end server runs with `APP_ENV=local`, so the objects land under `.media/` and are
 * served back by `/api/media/…`.
 */
let slug = "";
let editorUrl = "";

test.describe.serial("BR-REQ-054-01 the photo gallery", () => {
  test("creates an album, uploads a photo from the browser, and publishes it", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `album-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/gallery/new");

    const field = (name: string) => page.locator(`[name="${name}"]`);
    await fillDateField(page, "Data fotografiilor", "2026-09-13");
    await field("translations.ro.title").fill(`Alergarea de duminică ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await field("translations.ro.description").fill("Pozele de la start.");
    // Tabs since §259, here as in every other editor: the English panel is hidden until asked for.
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`Sunday run ${suffix}`);
    await field("translations.en.slug").fill(`sunday-${suffix}`);
    // The description in both languages or neither (§NNN, bilingual everywhere).
    await field("translations.en.description").fill("Photos from the start.");
    await page.getByRole("button", { name: "Album nou" }).click();
    await expect(page).toHaveURL(/\/admin\/gallery\/[0-9a-f-]{36}/);
    editorUrl = page.url();

    // Not publishable yet: no photo.
    await expect(page.getByText("Albumul nu are nicio fotografie")).toBeVisible();

    // A 1600×1200 JPEG made here, handed to the file input; the uploader shrinks and posts it.
    const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#2255ee" } }).jpeg().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(page.getByText("1 fotografii încărcate.")).toBeVisible({ timeout: 20_000 });
    // The page re-rendered with the photo in its grid, served from the local store.
    const thumb = page.locator("main img[src*='/api/media/']").first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("shows the album on the public site, in the nav, and the photo opens", async ({ page }) => {
    await page.goto(`/ro/galerie/${slug}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Alergarea de duminică");
    // The thumbnail is a WebP the site made, and the link around it is the larger variant.
    const link = page.locator("main a[href$='web.webp']").first();
    await expect(link).toBeVisible();
    expect(await link.locator("img").getAttribute("src")).toMatch(/thumb\.webp$/);
    const response = await page.request.get((await link.getAttribute("href")) as string);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");

    // The section appears in the header once an album is published — on the row or in the
    // menu, depending on the width (SiteNav folds what does not fit).
    const nav = page.getByRole("navigation", { name: "Navigare principală" });
    const onRow = nav.getByRole("link", { name: "Galerie" });
    if (!(await onRow.isVisible())) {
      await nav.getByRole("button", { name: "Meniu" }).click();
      await expect(page.getByRole("menuitem", { name: "Galerie" })).toBeVisible();
      await page.keyboard.press("Escape");
    }

    // The listing, with the album's cover.
    await page.goto("/ro/galerie");
    await expect(page.getByRole("link", { name: /Alergarea de duminică/ }).first()).toBeVisible();

    // No sideways scroll at 320px with a grid of photos (BR-REQ-041-01 criterion 1).
    await page.goto(`/ro/galerie/${slug}`);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  });

  test("removes the album and its photo from the site and the store", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto(editorUrl);
    const thumbSrc = (await page.locator("main img[src*='/api/media/']").first().getAttribute("src")) as string;

    await page.getByRole("button", { name: "Șterge albumul" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Șterge albumul" }).click();
    await page.waitForURL(/\/admin\/gallery\?saved=deleted/);

    expect((await page.goto(`/ro/galerie/${slug}`))?.status()).toBe(404);
    expect((await page.request.get(thumbSrc)).status()).toBe(404);
  });
});
