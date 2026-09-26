import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-050-03 criterion 22 (`DECISIONS.md` §414) — «Înaltă» in the text editor: a picture and a
 * film's poster go up at the chosen quality, larger than «Normală» keeps, the person is told what
 * each became, and the public page offers every stored width with the browser taking the one it
 * needs. Found by re-review: the first version tested «Înaltă» only in an album, never in the
 * editor, never for a poster, and never with a picture larger than «Normală»'s 2400 pixels —
 * which is the one thing that made «Înaltă» sharper.
 *
 * A standing page rather than an event: it carries a body with pictures and films and nothing
 * else, and it is its own fixture — created here, published, never shared with another spec.
 */

/** A poster: a flat field and lettering, 3600 pixels wide — above «Normală»'s 2400. */
async function poster(width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="#0b3d91"/>
    <text x="${width / 20}" y="${height / 3}" font-family="Arial" font-weight="700" font-size="${height / 8}" fill="#fff">CROSUL 2026</text>
    <text x="${width / 20}" y="${height / 2}" font-family="Arial" font-size="${height / 24}" fill="#ffd166">Sâmbătă, 21 noiembrie · ora 10:00 · Parcul Central</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Upload through the button a person presses, not by reaching past it for the input. */
async function chooseFile(page: Page, press: () => Promise<void>, name: string, buffer: Buffer) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), press()]);
  await chooser.setFiles({ name, mimeType: "image/png", buffer });
}

/** Every candidate of a `srcset`, with its width. */
function candidates(srcset: string): { url: string; width: number }[] {
  return srcset.split(", ").map((entry) => {
    const [url, width] = entry.split(" ");
    return { url, width: Number(width.slice(0, -1)) };
  });
}

test.describe.serial("BR-REQ-050-03 «Înaltă» in the text editor (§414)", () => {
  test("a picture and a film's poster go up at «Înaltă», say what they became, and the page offers their widths", async ({ page, browser }) => {
    test.setTimeout(180_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    const slug = `afis-${suffix}`;

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/pages/new");
    const field = (name: string) => page.locator(`[name="${name}"]`);
    await field("translations.ro.title").fill(`Afișul crosului ${suffix}`);
    await field("translations.ro.slug").fill(slug);

    const roEditor = page.locator('[data-rich-text="translations.ro.body"]');
    await roEditor.locator("[data-field]").click();
    await page.keyboard.type("Afișul crosului, cu regulamentul.");

    // The toolbar's picture control opens the bar: the quality first, then the file.
    await roEditor.getByRole("button", { name: "Imagine (încarcă din telefon sau calculator)" }).click();
    const bar = roEditor.getByTestId("rich-text-image-bar");
    await expect(bar.getByRole("radio", { name: "Medie (recomandat)" })).toBeChecked();
    // The help says what each choice keeps, from the same numbers the server resizes to.
    await expect(bar).toContainText("până la 2400 px");
    await expect(bar).toContainText("până la 4000 px");
    // Four levels (§NNN), and the help says what the new two keep.
    for (const name of ["Minimă (fișier mic)", "Medie (recomandat)", "Mare", "Originală (fișier mare)"]) {
      await expect(bar.getByRole("radio", { name, exact: true })).toBeVisible();
    }
    await expect(bar).toContainText("1280 px");
    await expect(bar).toContainText("până la 6000 px");
    await bar.getByRole("radio", { name: "Mare", exact: true }).check();
    await chooseFile(page, () => bar.getByRole("button", { name: "Alege imaginea" }).click(), "afis.png", await poster(3600, 2400));
    await expect(roEditor.locator("img[src*='/api/media/']")).toHaveCount(1, { timeout: 30_000 });
    // 3600 pixels kept, not 2400: «Înaltă» is more pixels, not only another encoder.
    await expect(roEditor.getByTestId("rich-text-image-stored")).toContainText("3600 × 2400 px, calitate mare", { timeout: 30_000 });
    // What was chosen, said as soon as it was read (§NNN): sent as it is at «Mare», so no second sentence.
    await expect(roEditor.getByTestId("rich-text-image-chosen")).toHaveText(/^Fișierul ales: afis\.png, 3600 × 2400 px, \d+(,\d)? (KB|MB)\.$/);
    // The picture's own panel opened on it (§73); say what it shows and close it.
    const pictureWords = page.getByRole("tooltip").filter({ has: page.getByRole("button", { name: "Gata" }) });
    // The selected picture's stored size, in its panel (§NNN).
    await expect(pictureWords.getByTestId("rich-text-image-pixels")).toHaveText("Imaginea stocată: 3600 × 2400 px.");
    await pictureWords.getByLabel("Ce arată imaginea (text alternativ)").fill("Afișul crosului");
    await pictureWords.getByRole("button", { name: "Gata" }).click();

    // A film, and the club's own poster for it — at the same remembered choice.
    await roEditor.getByRole("button", { name: "Adaugă un film de pe YouTube" }).click();
    await roEditor.getByLabel("Adresa filmului (YouTube)").fill("https://youtu.be/dQw4w9WgXcQ");
    await roEditor.getByRole("button", { name: "Adaugă filmul" }).click();
    const film = roEditor.locator('[data-youtube="dQw4w9WgXcQ"]');
    await expect(film).toBeVisible();
    await film.click();
    const filmPanel = page.getByTestId("rich-text-youtube-panel");
    await expect(filmPanel).toBeVisible();
    await expect(filmPanel.getByRole("radio", { name: "Mare", exact: true })).toBeChecked();
    await chooseFile(page, () => filmPanel.getByRole("button", { name: "Alege un thumbnail" }).click(), "poster.png", await poster(1920, 1080));
    await expect(filmPanel.getByTestId("rich-text-poster-stored")).toContainText("1920 × 1080 px, calitate mare", { timeout: 30_000 });
    await expect(filmPanel.getByTestId("rich-text-poster-chosen")).toContainText("Fișierul ales: poster.png, 1920 × 1080 px");
    await expect(film.locator("img")).toHaveAttribute("src", /\/api\/media\/.+\/web\.webp$/);
    await filmPanel.getByRole("button", { name: "Gata" }).click();

    await page.getByRole("tab", { name: /English/ }).click();
    await field("translations.en.title").fill(`The race poster ${suffix}`);
    await field("translations.en.slug").fill(`poster-${suffix}`);
    await page.locator('[data-rich-text="translations.en.body"]').locator("[data-field]").click();
    await page.keyboard.type("The race poster, with the rules.");
    await page.getByRole("tab", { name: /Română/ }).click();

    await page.getByRole("button", { name: "Pagină nouă" }).click();
    await expect(page).toHaveURL(/\/admin\/pages\/[0-9a-f-]{36}/);
    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);

    // The page: the picture names its rungs, the 2400 one among them, and then its 3600 master.
    await page.goto(`/ro/pagini/${slug}`);
    const picture = page.getByRole("img", { name: "Afișul crosului" });
    await expect(picture).toBeVisible();
    const pictureSet = (await picture.getAttribute("srcset")) as string;
    expect(pictureSet).toMatch(/\/1920w\.webp 1920w, \S+\/2400w\.webp 2400w, \S+\/web\.webp 3600w$/);
    for (const candidate of candidates(pictureSet)) {
      const answer = await page.request.get(candidate.url);
      expect(answer.status(), candidate.url).toBe(200);
      expect((await sharp(await answer.body()).metadata()).width, candidate.url).toBe(candidate.width);
    }

    // The poster, before the click: the club's upload, drawn from its ladder like any picture.
    const posterImage = page.getByRole("button", { name: "Redă filmul" }).locator("img");
    const posterSet = (await posterImage.getAttribute("srcset")) as string;
    expect(posterSet).toMatch(/\/480w\.webp 480w, .*\/1600w\.webp 1600w, \S+\/web\.webp 1920w$/);
    expect(await posterImage.getAttribute("sizes")).toMatch(/calc\(100vw - 32px\)$/);

    // Measured on a 390-pixel phone at 3×: the column is 358 CSS pixels, 1074 physical, and the
    // browser takes the 1280 rung — not the 3600-pixel master the page names last.
    const phone = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
    });
    try {
      const phonePage = await phone.newPage();
      await phonePage.goto(`/ro/pagini/${slug}`);
      const phonePicture = phonePage.getByRole("img", { name: "Afișul crosului" });
      await phonePicture.scrollIntoViewIfNeeded();
      await expect.poll(() => phonePicture.evaluate((img: HTMLImageElement) => img.currentSrc), { timeout: 15_000 }).toMatch(/\/1280w\.webp$/);
      const taken = await phonePicture.evaluate((img: HTMLImageElement) => img.currentSrc);
      const master = pictureSet.split(", ").pop()?.split(" ")[0] as string;
      const [takenBytes, masterBytes] = await Promise.all([
        phonePage.request.get(taken).then(async (answer) => (await answer.body()).byteLength),
        phonePage.request.get(new URL(master, phonePage.url()).href).then(async (answer) => (await answer.body()).byteLength),
      ]);
      test.info().annotations.push({ type: "390px@3x", description: `1280 rung ${takenBytes} B; master ${masterBytes} B` });
      expect(takenBytes).toBeLessThan(masterBytes);
    } finally {
      await phone.close();
    }
  });
});
