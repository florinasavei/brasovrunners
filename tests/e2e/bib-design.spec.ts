import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { ensureRegistrationIsOpen, hydrated, signIn } from "./support/featured-event";
import { openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-038-01, `DECISIONS.md` §301 and §317 — the bib's footer is the club's to compose, and
 * the preview in the design panel follows every box before anything is saved.
 *
 * Nothing here saves: the panel's preview is a picture whose address carries the unsaved design,
 * so what is asserted is that address — the email switch turning `showEmail` off in it, the
 * club's line arriving in it — and that the route draws it. A read-only spec, so it cannot
 * disturb the featured event the registration specs configure.
 */
test.describe("§317 the footer, composed in the designer", () => {
  test("switching the email off redraws the preview without it, and the club's line joins it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    // Registration on the site, which is where race numbers exist (§350): converges, never saves
    // when another spec already did.
    await ensureRegistrationIsOpen(page);
    await page.reload();
    await hydrated(page);

    // The editor renders at all: the first version of this panel failed the whole page on the
    // client (a shared `sx` object, see `BibDesignPanel`), which no unit test could see. It is
    // a card inside a card now: Participare și înscrieri › Numere de concurs (BIB) › this.
    await openEditorBox(page, "Participare și înscrieri");
    await openEditorBox(page, "Numere de concurs (BIB)");
    const panel = page.getByTestId("bib-design");
    await openFold(panel);
    const preview = page.getByTestId("bib-design-preview").locator("img");
    await expect(preview).toHaveAttribute("src", /[?&]showEmail=1(&|$)/);

    const footer = page.getByTestId("bib-design-footer");
    const email = footer.getByRole("checkbox", { name: /Adresa de email a clubului/ });
    // A thumb's target, like every other box in the panel (BR-REQ-041-01 criterion 6).
    expect((await email.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await email.uncheck();
    await expect(preview).toHaveAttribute("src", /[?&]showEmail=0(&|$)/, { timeout: 10_000 });

    const line = footer.getByRole("textbox", { name: "Rândul clubului" });
    await line.fill("Cronometraj: StartTime");
    await expect(page.getByTestId("bib-footer-text-count")).toHaveText("22/120");
    await expect(preview).toHaveAttribute("src", /[?&]footerText=Cronometraj/, { timeout: 10_000 });

    // The address the panel built is one the route draws: the same renderer as the paper.
    const src = (await preview.getAttribute("src")) as string;
    const picture = await page.request.get(src);
    expect(picture.status()).toBe(200);
    expect(picture.headers()["content-type"]).toBe("image/png");
  });
});

/**
 * §560 (amending §249 and §485) — the sponsors' band is the backoffice's own picture control: an
 * upload (or «Din galerie»), then the crop box held to the band's one shape, and the preview
 * redrawn with the unsaved picture and crop. Nothing is saved: the upload is a picture nobody
 * keeps, swept after a week (§73).
 */
test.describe("§560 the sponsors' band: upload, crop, preview", () => {
  test("an uploaded picture opens the crop box in the band's shape and the preview draws it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await ensureRegistrationIsOpen(page);
    await page.reload();
    await hydrated(page);

    await openEditorBox(page, "Participare și înscrieri");
    await openEditorBox(page, "Numere de concurs (BIB)");
    const panel = page.getByTestId("bib-design");
    await openFold(panel);
    const preview = page.getByTestId("bib-design-preview").locator("img");

    const band = page.getByTestId("bib-picture-sponsors");
    // The three ways, each a thumb's target with its glyph (BR-REQ-041-01 criterion 6, §521).
    const upload = band.getByText("Încarcă o imagine");
    await expect(upload).toBeVisible();
    await expect(band.getByRole("button", { name: /Din galerie/ })).toBeVisible();
    expect((await band.getByRole("button", { name: /Din galerie/ }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // A 10 : 1 strip of logos, made on the fly; the band is 22 : 1. At least 200 pixels on each
    // side, the upload's own floor for any picture (`media/limits.ts`).
    const strip = await sharp({ create: { width: 2400, height: 240, channels: 3, background: "#2255ee" } }).jpeg().toBuffer();
    await band.locator('input[type="file"]').setInputFiles({ name: "sponsori.jpg", mimeType: "image/jpeg", buffer: strip });

    // The crop box, in the band's one shape and nothing else to choose.
    await expect(page.getByTestId("bib-picture-sponsors-crop-surface")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("bib-picture-sponsors-crop-surface-shape")).toContainText("22 la 1");
    await expect(band.getByTestId("rich-text-crop-presets")).toHaveCount(0);

    // The preview follows the unsaved picture and its crop at once.
    await expect(preview).toHaveAttribute("src", /[?&]sponsorImageSrc=/, { timeout: 10_000 });
    await expect(preview).toHaveAttribute("src", /[?&]sponsorImageCrop=/, { timeout: 10_000 });

    // «Toată imaginea»: no crop, the whole strip fitted — the crop leaves the address.
    await band.getByRole("button", { name: "Toată imaginea" }).click();
    await expect(preview).not.toHaveAttribute("src", /[?&]sponsorImageCrop=/, { timeout: 10_000 });
    await expect(preview).toHaveAttribute("src", /[?&]sponsorImageSrc=/);

    const drawn = await page.request.get((await preview.getAttribute("src")) as string);
    expect(drawn.status()).toBe(200);
    expect(drawn.headers()["content-type"]).toBe("image/png");

    // «Fără imagine» empties the place, and the preview draws no band.
    await band.getByRole("button", { name: "Fără imagine" }).click();
    await expect(preview).not.toHaveAttribute("src", /[?&]sponsorImageSrc=/, { timeout: 10_000 });
    // The band was really drawn: the stored WebP reaches the renderer as a PNG (§560). The whole
    // blue strip is fitted in the middle of the band, which sits on the one-line footer: 353 to
    // 377 points down the A5 paper's 421, 1.663 pixels to the point (`bib-geometry.ts`).
    const { data, info } = await sharp(await drawn.body()).raw().toBuffer({ resolveWithObject: true });
    const at = (Math.round(606) * info.width + Math.round(info.width / 2)) * info.channels;
    expect({ r: data[at] < 90, b: data[at + 2] > 180 }).toEqual({ r: true, b: true });
  });
});
