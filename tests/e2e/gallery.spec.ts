import { expect, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
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
    // The description in both languages or neither (§354, bilingual everywhere).
    await field("translations.en.description").fill("Photos from the start.");
    await page.getByRole("button", { name: "Album nou" }).click();
    await expect(page).toHaveURL(/\/admin\/gallery\/[0-9a-f-]{36}/);
    editorUrl = page.url();

    // Not publishable yet: no photo.
    await expect(page.getByText("Albumul nu are nicio fotografie")).toBeVisible();

    // The quality beside the button (§414, four levels since §NNN): the recommendation until
    // somebody chooses, then the choice — a thumb's target, like every control here.
    const quality = page.getByTestId("image-quality");
    const normal = quality.getByRole("radio", { name: "Medie (recomandat)" });
    const high = quality.getByRole("radio", { name: "Mare", exact: true });
    await expect(normal).toBeChecked();
    // `has` is resolved inside each label, so it names the radio alone, not the chain from the page.
    const highLabel = quality.locator("label").filter({ has: page.getByRole("radio", { name: "Mare", exact: true }) });
    expect((await highLabel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await high.check();

    // A 1600×1200 JPEG made here, handed to the file input; the uploader shrinks and posts it.
    const photo = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#2255ee" } }).jpeg().toBuffer();
    await page.locator('input[type="file"]').setInputFiles({ name: "IMG_0042.jpg", mimeType: "image/jpeg", buffer: photo });
    await expect(page.getByText("1 fotografii încărcate.")).toBeVisible({ timeout: 20_000 });
    // What the photo became, in words: its size and the quality it was stored at.
    await expect(page.getByTestId("photo-stored")).toContainText("1600 × 1200 px, calitate mare");
    // And what was chosen, before it went up (§NNN): the file's own pixels and weight.
    await expect(page.getByTestId("photo-chosen")).toContainText("Fotografia aleasă: IMG_0042.jpg, 1600 × 1200 px");
    // Remembered for the session: the page comes back with the same choice.
    await page.reload();
    await expect(page.getByTestId("image-quality").getByRole("radio", { name: "Mare", exact: true })).toBeChecked();
    // The page re-rendered with the photo in its grid, served from the local store.
    const thumb = page.locator("main img[src*='/api/media/']").first();
    await expect(thumb).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
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

    // The tile offers every stored width, and says how wide it is drawn (§414): a phone at 3×
    // takes a rung, not an enlarged thumbnail. Every width it names is really there.
    const tile = link.locator("img");
    const srcset = (await tile.getAttribute("srcset")) as string;
    expect(srcset).toMatch(/\/480w\.webp 480w, .*\/960w\.webp 960w, .*\/1280w\.webp 1280w, .*\/web\.webp 1600w$/);
    expect(await tile.getAttribute("sizes")).toMatch(/calc\(50vw - 20px\)$/);
    for (const candidate of srcset.split(", ").map((entry) => entry.split(" ")[0])) {
      const rung = await page.request.get(candidate);
      expect(rung.status(), candidate).toBe(200);
      expect(rung.headers()["content-type"]).toBe("image/webp");
    }
    // And the browser really took the smallest stored width that fills the tile at its density —
    // a rung, never the thumbnail enlarged nor the 1600-pixel master (§414).
    const drawn = await tile.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width * window.devicePixelRatio);
    const candidates = srcset.split(", ").map((entry) => ({ url: entry.split(" ")[0], width: Number(entry.split(" ")[1].slice(0, -1)) }));
    const expected = candidates.find((candidate) => candidate.width >= drawn) ?? candidates[candidates.length - 1];
    await expect.poll(() => tile.evaluate((img: HTMLImageElement) => img.currentSrc)).toContain(new URL(expected.url, page.url()).pathname);
    expect(expected.url).toMatch(/\/\d+w\.webp$/);

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
    // One of the ladder's rungs, beside the thumbnail (§414): it must go with the album too.
    const rungSrc = thumbSrc.replace(/thumb\.webp$/, "960w.webp");
    expect((await page.request.get(rungSrc)).status()).toBe(200);

    await page.getByRole("button", { name: "Șterge albumul" }).click();
    await confirmDialog(page);
    await page.waitForURL(/\/admin\/gallery\?saved=deleted/);

    expect((await page.goto(`/ro/galerie/${slug}`))?.status()).toBe(404);
    expect((await page.request.get(thumbSrc)).status()).toBe(404);
    expect((await page.request.get(rungSrc)).status()).toBe(404);
  });
});
