import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { fillDateField, signIn } from "./support/featured-event";

/**
 * `DECISIONS.md` §485 — «Din galerie», through the browser. The route and the pure filter are
 * covered below this (`tests/integration/cms/gallery-picker-route.test.ts`,
 * `tests/unit/media/pictures-from-the-gallery.test.ts`); what only a browser shows is the picker
 * itself: that a picture stored by one page is found by its name from another, accents and case
 * ignored, that it goes into the text as the same stored file (linked, never copied), that an
 * editor's picker opens on its own place, and that an album takes a stored picture once and says
 * so the second time.
 *
 * Its own fixtures — a standing page with one picture, a second page, a free album — created here
 * with a suffix per project, so the mobile and desktop runs never meet on one database.
 */

/** A small picture with a flat field: nothing to wait for on the mobile shard (§477). */
async function map(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 400, channels: 3, background: "#1f7a4d" } }).png().toBuffer();
}

/** Upload through the button a person presses, not by reaching past it for the input. */
async function chooseFile(page: Page, press: () => Promise<void>, name: string, buffer: Buffer) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), press()]);
  await chooser.setFiles({ name, mimeType: "image/png", buffer });
}

test.describe.serial("§485 pictures from the gallery", () => {
  const suffix = () => test.info().project.name;
  /** The stored file's own name: an accent in it, so the search is proven to ignore one. */
  let fileName = "";
  let pageEditorUrl = "";
  let storedSrc = "";

  test("a page stores a picture, and another page's text finds it by name — accents and case ignored — and takes the same file", async ({ page }) => {
    test.setTimeout(120_000);
    const id = `${suffix()}-${Date.now().toString(36)}`;
    fileName = `hartă-traseu-${id}.png`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Harta traseului ${id}`);
    await field("translations.ro.slug").fill(`harta-${id}`);
    const roEditor = page.locator('[data-rich-text="translations.ro.body"]');
    await roEditor.locator("[data-field]").click();
    await page.keyboard.type("Harta traseului de duminică.");
    await roEditor.getByRole("button", { name: "Imagine (încarcă din telefon sau calculator)" }).click();
    const bar = roEditor.getByTestId("rich-text-image-bar");
    await chooseFile(page, () => bar.getByRole("button", { name: "Alege imaginea" }).click(), fileName, await map());
    const stored = roEditor.locator("img[src*='/api/media/']");
    await expect(stored).toHaveCount(1, { timeout: 30_000 });
    storedSrc = (await stored.getAttribute("src")) as string;
    const pictureWords = page.getByRole("tooltip").filter({ has: page.getByRole("button", { name: "Gata" }) });
    await pictureWords.getByLabel("Ce arată imaginea (text alternativ)").fill("Harta traseului");
    await pictureWords.getByRole("button", { name: "Gata" }).click();

    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`The route map ${id}`);
    await field("translations.en.slug").fill(`route-map-${id}`);
    await page.locator('[data-rich-text="translations.en.body"]').locator("[data-field]").click();
    await page.keyboard.type("The Sunday route map.");
    await page.getByRole("tab", { name: /Română/ }).click();
    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);
    pageEditorUrl = new URL(page.url()).pathname;

    // A second page, not yet saved: no place of its own, so no «Această pagină» chip.
    await page.goto("/ro/admin/pages/new");
    const other = page.locator('[data-rich-text="translations.ro.body"]');
    await other.locator("[data-field]").click();
    await page.keyboard.type("Traseul pe hartă: ");
    await other.getByRole("button", { name: "Alege o imagine deja încărcată" }).click();
    const picker = other.getByTestId("rich-text-gallery-list");
    const sources = picker.getByTestId("rich-text-gallery-list-sources");
    await expect(sources.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true");
    await expect(sources.getByRole("button", { name: "Această pagină" })).toHaveCount(0);

    // The name without its accent and in capitals finds the one picture: the server narrows
    // before its cap, so however many pictures other specs stored, this one is there.
    await picker.getByLabel("Caută după numele fișierului").fill(`HARTA-TRASEU-${id.toUpperCase()}`);
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    // Its name says the file, its stored size and its weight.
    expect(await items.first().getAttribute("aria-label")).toMatch(new RegExp(`^${fileName.replace(/[.]/g, "\\.")}, 640 × 400 · \\d+(,\\d)? (B|KB|MB)$`));
    // The size and weight under the thumbnail, read on a phone where a hover title never shows.
    await expect(picker.getByTestId("gallery-picker-item-facts")).toContainText("640 × 400");
    // A thumb's target (BR-REQ-041-01 criterion 6), the chips too.
    const box = await items.first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    for (const chip of await sources.getByRole("button").all()) {
      expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // «Folosită în»: the picture is a page's, so «Album» finds nothing and «Pagină» finds it.
    await sources.getByRole("button", { name: "Album", exact: true }).click();
    await expect(picker).toContainText("Nicio imagine nu se potrivește.", { timeout: 15_000 });
    await sources.getByRole("button", { name: "Pagină", exact: true }).click();
    await expect(items).toHaveCount(1, { timeout: 15_000 });

    // Taken: the same stored file, linked rather than copied, and said like an upload.
    await items.first().click();
    await expect(other.getByTestId("rich-text-gallery")).toHaveCount(0);
    const inserted = other.locator("img[src*='/api/media/']");
    await expect(inserted).toHaveCount(1);
    await expect(inserted).toHaveAttribute("src", storedSrc);
    await expect(other.getByTestId("rich-text-image-picked")).toHaveText(`Din galerie: ${fileName}, 640 × 400 px.`);
  });

  test("an editor's picker opens on its own place: «Această pagină», with the page's picture", async ({ page }) => {
    expect(pageEditorUrl, "the first part created the page").not.toBe("");
    await signIn(page, "Dev Administrator");
    await page.goto(pageEditorUrl);
    const roEditor = page.locator('[data-rich-text="translations.ro.body"]');
    await expect(roEditor.locator("img[src*='/api/media/']")).toHaveCount(1);
    await roEditor.getByRole("button", { name: "Alege o imagine deja încărcată" }).click();
    const picker = roEditor.getByTestId("rich-text-gallery-list");
    const sources = picker.getByTestId("rich-text-gallery-list-sources");
    await expect(sources.getByRole("button", { name: "Această pagină" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    // Only what this page uses: its one picture, whatever else the club stored.
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await expect(items.first().locator("img")).toBeVisible();
    expect(await items.first().getAttribute("aria-label")).toContain(fileName);
    // «Toate» is beside it, and pressing it lists more than the page's own.
    await sources.getByRole("button", { name: "Toate" }).click();
    await expect(sources.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true");
    // The picker closes on its own button, leaving the text as it was.
    await picker.getByRole("button", { name: "Renunță" }).click();
    await expect(roEditor.getByTestId("rich-text-gallery")).toHaveCount(0);
    await expect(roEditor.locator("img[src*='/api/media/']")).toHaveCount(1);
  });

  test("an album takes a stored picture once, and says so the second time; it opens on «Toate» with «Acest album» beside it", async ({ page }) => {
    test.setTimeout(90_000);
    expect(fileName, "the first part stored the picture").not.toBe("");
    const id = `${suffix()}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/gallery/new");
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await fillDateField(page, "Data fotografiilor", "2026-09-13");
    await field("translations.ro.title").fill(`Traseul pe hartă ${id}`);
    await field("translations.ro.slug").fill(`traseu-${id}`);
    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`The route on a map ${id}`);
    await field("translations.en.slug").fill(`route-${id}`);
    await page.getByRole("button", { name: "Album nou" }).click();
    await expect(page).toHaveURL(/\/admin\/gallery\/[0-9a-f-]{36}/);

    await page.getByRole("button", { name: "Din galerie" }).click();
    const picker = page.getByTestId("album-gallery-picker");
    const sources = picker.getByTestId("album-gallery-picker-sources");
    await expect(sources.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(sources.getByRole("button", { name: "Acest album" })).toBeVisible();
    await picker.getByLabel("Caută după numele fișierului").fill(fileName.replace("ă", "a"));
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });

    const note = page.getByTestId("album-gallery-note");
    await items.first().click();
    await expect(note).toHaveText(`${fileName} e acum în album.`, { timeout: 15_000 });
    // Marked as chosen in this sitting, and the album shows it from the same store.
    await expect(items.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`main img[src*='/api/media/']`).first()).toBeVisible({ timeout: 15_000 });
    // Pressed again: nothing added, and it says so.
    await items.first().click();
    await expect(note).toHaveText(`${fileName} era deja în album.`, { timeout: 15_000 });
    await expect(page.getByText("Fotografii (1)")).toBeVisible();
  });

  test("the list is refused to a volunteer, whose backoffice is the desk (BR-REQ-060-01)", async ({ page }) => {
    await signIn(page, "Dev Contributor");
    const refused = await page.request.get("/api/admin/media");
    expect(refused.status()).toBe(403);
    // Signed out first: a signed-in volunteer is sent from the sign-in page to the desk.
    await page.context().clearCookies();
    await signIn(page, "Dev Copywriter");
    const allowed = await page.request.get("/api/admin/media");
    expect(allowed.status()).toBe(200);
    expect(Array.isArray(((await allowed.json()) as { assets: unknown[] }).assets)).toBe(true);
  });
});
