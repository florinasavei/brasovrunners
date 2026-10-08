import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * «Înlocuiește» on a picture in a text (§NNN; BR-REQ-050-03) — through the browser, at both
 * viewports. What the unit tests cannot see: the button's hidden file input inside the picture's
 * panel, the panel staying with its picture across the file dialog and the upload, the node found
 * again and changed in place, and the English text's copy of the same picture changed with it,
 * keeping its own description and caption.
 *
 * A standing page of its own: a Romanian text with an uploaded picture, described, captioned and
 * cropped 16:9; the English text takes the same stored picture from «Alege o imagine deja
 * încărcată» with its own words. Replaced in Romanian with a portrait, both texts carry the new
 * picture; the crop is gone from the public page.
 */

/** A flat field: nothing to wait for on the mobile shard (§477). */
async function flat(width: number, height: number, background: string): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

/** Upload through the button a person presses, not by reaching past it for the input. */
async function chooseFile(page: Page, press: () => Promise<void>, name: string, buffer: Buffer) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), press()]);
  await chooser.setFiles({ name, mimeType: "image/png", buffer });
}

test.describe.serial("§NNN «Înlocuiește» on a picture in a text", () => {
  test("replaces the picture in its node, keeps its words, clears the crop, and changes the English copy too", async ({ page }) => {
    test.setTimeout(150_000);
    const id = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `inlocuieste-text-${id}`;
    const enSlug = `replace-text-${id}`;
    const fileName = `harta-inlocuire-${id}.png`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Harta înlocuită ${id}`);
    await field("translations.ro.slug").fill(slug);

    // Romanian: a landscape picture, described, captioned and cropped 16:9.
    const roEditor = page.locator('[data-rich-text="translations.ro.body"]');
    await roEditor.locator("[data-field]").click();
    await page.keyboard.type("Harta traseului de duminică.");
    await roEditor.getByRole("button", { name: "Imagine (încarcă din telefon sau calculator)" }).click();
    const bar = roEditor.getByTestId("rich-text-image-bar");
    await chooseFile(page, () => bar.getByRole("button", { name: "Alege imaginea" }).click(), fileName, await flat(1200, 800, "#1f7a4d"));
    const roPicture = roEditor.locator("img[src*='/api/media/']");
    await expect(roPicture).toHaveCount(1, { timeout: 30_000 });
    const oldSrc = (await roPicture.getAttribute("src")) as string;
    const panel = page.getByTestId("rich-text-image-panel");
    await expect(panel).toBeVisible();
    await panel.getByLabel("Ce arată imaginea (text alternativ)").fill("Harta traseului");
    await panel.getByLabel("Legendă (opțional, sub imagine)").fill("Bucla mare");
    await panel.getByTestId("rich-text-crop-presets").getByRole("button", { name: "16:9", exact: true }).click();
    await expect(roEditor.locator(".rt-crop")).toHaveCount(1);
    await expect(panel.getByTestId("rich-text-image-pixels")).toHaveText("Imaginea stocată: 1200 × 800 px.");

    // «Înlocuiește» in the same panel, with a portrait: a button a thumb can press.
    const replace = panel.getByTestId("rich-text-image-replace");
    await expect(replace).toHaveText("Înlocuiește");
    expect((await replace.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(panel).toContainText("Aceeași imagine din textul celeilalte limbi se schimbă și ea");
    await panel.getByRole("button", { name: "Gata" }).click();
    await expect(panel).toHaveCount(0);

    // English: the same stored picture from the gallery, with its own words.
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`The replaced map ${id}`);
    await field("translations.en.slug").fill(enSlug);
    const enEditor = page.locator('[data-rich-text="translations.en.body"]');
    await enEditor.locator("[data-field]").click();
    await page.keyboard.type("The Sunday route map.");
    await enEditor.getByRole("button", { name: "Alege o imagine deja încărcată" }).click();
    const picker = enEditor.getByTestId("rich-text-gallery-list");
    await picker.getByLabel("Caută după numele fișierului").fill(fileName);
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await items.first().click();
    const enPicture = enEditor.locator("img[src*='/api/media/']");
    await expect(enPicture).toHaveAttribute("src", oldSrc);
    await expect(panel).toBeVisible();
    await panel.getByLabel("Ce arată imaginea (text alternativ)").fill("The route map");
    await panel.getByLabel("Legendă (opțional, sub imagine)").fill("The long loop");
    await panel.getByRole("button", { name: "Gata" }).click();
    await expect(panel).toHaveCount(0);

    // Back in Romanian: select the picture, and replace it from its panel.
    await page.getByRole("tab", { name: /Română/ }).click();
    await roEditor.locator(".rt-crop").click();
    await expect(panel).toBeVisible();
    await chooseFile(page, () => panel.getByTestId("rich-text-image-replace").click(), "portret.png", await flat(900, 1200, "#ee5522"));
    // The panel stayed with its picture across the dialog and the upload: the new size, the same words.
    await expect(panel.getByTestId("rich-text-image-pixels")).toHaveText("Imaginea stocată: 900 × 1200 px.", { timeout: 30_000 });
    await expect(panel.getByLabel("Ce arată imaginea (text alternativ)")).toHaveValue("Harta traseului");
    await expect(panel.getByLabel("Legendă (opțional, sub imagine)")).toHaveValue("Bucla mare");
    // The same node, a new address; the crop cleared; still one picture, after the same paragraph.
    await expect(roPicture).toHaveCount(1);
    const newSrc = (await roPicture.getAttribute("src")) as string;
    expect(newSrc).not.toBe(oldSrc);
    await expect(roEditor.locator(".rt-crop")).toHaveCount(0);
    await expect(roEditor.locator("[data-field] > *").first()).toContainText("Harta traseului de duminică.");
    await panel.getByRole("button", { name: "Gata" }).click();

    // The English copy changed with it, and kept its own words.
    await expect(enPicture).toHaveAttribute("src", newSrc);
    await expect(enPicture).toHaveAttribute("alt", "The route map");

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);

    // The public pages: the new picture in both languages, each with its own words, and no crop.
    const newPrefix = newSrc.split("/").at(-2) as string;
    await page.goto(`/ro/pagini/${slug}`);
    const roPublic = page.getByRole("img", { name: "Harta traseului" });
    await expect(roPublic).toHaveAttribute("src", new RegExp(`/${newPrefix}/`));
    await expect(page.locator("main .rt-crop")).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Bucla mare");
    await page.goto(`/en/pages/${enSlug}`);
    const enPublic = page.getByRole("img", { name: "The route map" });
    await expect(enPublic).toHaveAttribute("src", new RegExp(`/${newPrefix}/`));
    await expect(page.locator("main")).toContainText("The long loop");
  });
});
