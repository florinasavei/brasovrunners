import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * `DECISIONS.md` §485 — «Din galerie», through the browser. The route and the pure filter are
 * covered below this (`tests/integration/cms/gallery-picker-route.test.ts`,
 * `tests/unit/media/pictures-from-the-gallery.test.ts`); what only a browser shows is the picker
 * itself: that a picture stored by one page is found by its name from another, accents and case
 * ignored, that it goes into the text as the same stored file (linked, never copied), that an
 * editor's picker opens on its own place, and that an album takes a stored picture once and says
 * so the second time.
 *
 * Every place that takes a picture is walked (§485): a page's text; an event's summary, with the
 * card's shapes and centre after the pick (§454); its description, whose picker opens on «Acest
 * eveniment»; a film's poster, with its 16∶9 crop; a card of «Echipa»; an album. And the list's own
 * request: `?for=event:<id>&source=here` answers that event's pictures only, a malformed id names
 * no place at all.
 *
 * Its own fixtures — a standing page with one picture, a second page, a draft event, a hidden
 * «Echipa» card (deleted again), a free album — created here with a suffix per project, so the
 * mobile and desktop runs never meet on one database.
 */

/** One stored picture as `GET /api/admin/media` lists it — the fields these checks read. */
type Listed = { id: string; src: string; thumb: string; name: string; uses: string[]; here?: boolean };

/** The list's answer, as the signed-in page asks for it. */
async function listed(page: Page, query: Record<string, string>): Promise<Listed[]> {
  const answer = await page.request.get(`/api/admin/media?${new URLSearchParams(query).toString()}`);
  expect(answer.status()).toBe(200);
  return ((await answer.json()) as { assets: Listed[] }).assets;
}

/** Say what the picture shows, then leave its panel by «Gata», which puts the caret after it (§73). */
async function describePicture(page: Page, alt: string) {
  const panel = page.getByTestId("rich-text-image-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Ce arată imaginea (text alternativ)").fill(alt);
  await panel.getByRole("button", { name: "Gata" }).click();
  await expect(panel).toHaveCount(0);
}

/** The five shapes of §454, in the crop box's order, and the one pressed. */
async function expectShapes(scope: Locator, pressed: string) {
  const presets = scope.getByTestId("rich-text-crop-presets");
  for (const shape of ["Liber", "16:9", "4:3", "1:1", "4:5"]) {
    const button = presets.getByRole("button", { name: shape, exact: true });
    await expect(button).toHaveAttribute("aria-pressed", shape === pressed ? "true" : "false");
    // A thumb presses these on a phone (BR-REQ-041-01 criterion 6).
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
}

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
  let eventEditorUrl = "";
  let albumUrl = "";

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

  test("an event's summary takes a gallery picture in the card's shape, with the crop box, the five shapes and the card's centre (§454)", async ({ page }) => {
    test.setTimeout(120_000);
    expect(fileName, "the first part stored the picture").not.toBe("");
    const id = `${suffix()}-${Date.now().toString(36)}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);

    // A draft event of its own: created bare, so its editor knows its place before any picture.
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await fillDateField(page, "Începutul evenimentului", "2027-06-12");
    await fillTimeField(page, "Ora", "09:00");
    await field("event.locationName").fill("Parcul Tractorul");
    await field("event.locationNameEn").fill("Parcul Tractorul");
    await field("translations.ro.title").fill(`Harta crosului ${id}`);
    await field("translations.ro.slug").fill(`harta-crosului-${id}`);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`The race map ${id}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(`race-map-${id}`);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    eventEditorUrl = new URL(page.url()).pathname;
    await hydrated(page);

    await openEditorBox(page, "Titlu și rezumat");
    await languageTab(page, "title", "ro").click();
    const panel = languagePanel(page, "title", "ro");
    await openFold(panel.locator('[data-rich-text-fold="translations.ro.excerptBody"]'));
    const summary = panel.locator('[data-rich-text="translations.ro.excerptBody"]');
    await summary.locator("[data-field]").click();
    await page.keyboard.type("Harta crosului, pe card. ");
    await summary.getByRole("button", { name: "Alege o imagine deja încărcată" }).click();
    const picker = summary.getByTestId("rich-text-gallery-list");
    const sources = picker.getByTestId("rich-text-gallery-list-sources");
    // The event uses no picture yet: «Acest eveniment» is offered, and the picker opens on «Toate».
    await expect(sources.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await expect(sources.getByRole("button", { name: "Acest eveniment" })).toHaveAttribute("aria-pressed", "false");

    // The card's shape before the pick: the picture goes in cropped 16∶9 from its middle.
    await summary.getByTestId("rich-text-gallery-shape").getByRole("button", { name: "16:9", exact: true }).click();
    await picker.getByLabel("Caută după numele fișierului").fill(fileName);
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await items.first().click();

    // Linked, the same stored file, and said with its shape.
    await expect(summary.locator("img[src*='/api/media/']").first()).toHaveAttribute("src", storedSrc);
    await expect(summary.getByTestId("rich-text-image-picked")).toHaveText(
      `Din galerie: ${fileName}, 640 × 400 px. · decupat 16:9 din mijloc (fișierul rămâne întreg)`,
    );
    // The picture's panel: the crop box after a pick exactly as after an upload — the five shapes
    // with 16∶9 pressed, the rectangle the whole width and 90 % of the height (640 × 400 at 16∶9),
    // and, for a summary, the card's own choice of centre and its frame (§454).
    const pictureWords = page.getByTestId("rich-text-image-panel");
    await expect(pictureWords.getByTestId("rich-text-image-pixels")).toHaveText("Imaginea stocată: 640 × 400 px.");
    await expectShapes(pictureWords, "16:9");
    await expect(pictureWords.getByTestId("rich-text-crop-position")).toHaveText("100% × 90% din fotografie, de la stânga 0%, de sus 5%");
    const target = pictureWords.getByTestId("rich-text-crop-target");
    await expect(target.getByRole("button", { name: "Decupajul" })).toHaveAttribute("aria-pressed", "true");
    await expect(target.getByRole("button", { name: "Centrul pe card" })).toBeVisible();
    await expect(pictureWords.getByTestId("rich-text-card-frame")).toBeVisible();
    await describePicture(page, "Harta crosului");

    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
  });

  test("the description's picker opens on «Acest eveniment» with only that event's picture, and a film's poster from it takes the 16∶9 crop", async ({ page }) => {
    test.setTimeout(120_000);
    expect(eventEditorUrl, "the previous part created the event").not.toBe("");
    await signIn(page, "Dev Administrator");
    await page.goto(eventEditorUrl);
    await hydrated(page);

    await openEditorBox(page, "Descrierea evenimentului");
    const panel = languagePanel(page, "description", "ro");
    await openFold(panel.locator('[data-rich-text-fold="translations.ro.body"]'));
    const description = panel.locator('[data-rich-text="translations.ro.body"]');
    await description.locator("[data-field]").click();
    await page.keyboard.type("Traseul, pe hartă.");

    // The event's summary holds the picture now, so the picker opens on the event's own chip and
    // lists that one picture — whatever else the club stored (§485).
    await description.getByRole("button", { name: "Alege o imagine deja încărcată" }).click();
    const picker = description.getByTestId("rich-text-gallery-list");
    const sources = picker.getByTestId("rich-text-gallery-list-sources");
    await expect(sources.getByRole("button", { name: "Acest eveniment" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    expect(await items.first().getAttribute("aria-label")).toContain(fileName);

    // «Liber»: the whole photograph, and a description's picture has no card to centre.
    await description.getByTestId("rich-text-gallery-shape").getByRole("button", { name: "Liber", exact: true }).click();
    await items.first().click();
    await expect(description.locator("img[src*='/api/media/']")).toHaveAttribute("src", storedSrc);
    await expect(description.getByTestId("rich-text-image-picked")).toHaveText(`Din galerie: ${fileName}, 640 × 400 px.`);
    const pictureWords = page.getByTestId("rich-text-image-panel");
    await expectShapes(pictureWords, "Liber");
    await expect(pictureWords.getByTestId("rich-text-crop-target")).toHaveCount(0);
    await describePicture(page, "Harta traseului");

    // A film after it, and its poster from the gallery: the film's picker opens on the event too.
    await description.getByRole("button", { name: "Adaugă un film de pe YouTube" }).click();
    await description.getByLabel("Adresa filmului (YouTube)").fill("https://youtu.be/dQw4w9WgXcQ");
    await description.getByRole("button", { name: "Adaugă filmul" }).click();
    const film = description.locator('[data-youtube="dQw4w9WgXcQ"]');
    await expect(film).toBeVisible();
    const filmPanel = page.getByTestId("rich-text-youtube-panel");
    // On a 320-pixel phone the panel covers the film: clicked only when it is not already open.
    await filmPanel.waitFor({ timeout: 5_000 }).catch(() => film.click());
    await expect(filmPanel).toBeVisible();
    await filmPanel.getByRole("button", { name: "Din galerie" }).click();
    const posterPicker = filmPanel.getByTestId("rich-text-poster-gallery");
    await expect(
      posterPicker.getByTestId("rich-text-poster-gallery-sources").getByRole("button", { name: "Acest eveniment" }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    const posters = posterPicker.getByTestId("gallery-picker-item");
    await expect(posters).toHaveCount(1, { timeout: 15_000 });
    await posters.first().click();
    await expect(posterPicker).toHaveCount(0);

    // The poster is the same stored file, and its crop box holds the film's 16∶9 — pressed first,
    // the rectangle the largest 16∶9 part of the picture, from its middle.
    await expect(film.locator("img")).toHaveAttribute("src", storedSrc);
    await expect(filmPanel.getByTestId("rich-text-poster-crop")).toBeVisible();
    await expectShapes(filmPanel, "16:9");
    await expect(filmPanel.getByTestId("rich-text-crop-position")).toHaveText("100% × 90% din fotografie, de la stânga 0%, de sus 5%");
    await filmPanel.getByRole("button", { name: "Gata" }).click();

    // A description is both languages or neither (§352): the English words, and then the save.
    await languageTab(page, "description", "en").click();
    const english = languagePanel(page, "description", "en");
    await openFold(english.locator('[data-rich-text-fold="translations.en.body"]'));
    await english.locator('[data-rich-text="translations.en.body"] [data-field]').click();
    await page.keyboard.type("The route, on a map.");
    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
  });

  test("the list answers one event's pictures for ?for=event:<id>&source=here, and a malformed id names no place", async ({ page }) => {
    expect(eventEditorUrl, "the event parts ran").not.toBe("");
    const eventId = /\/admin\/events\/([0-9a-f-]{36})/.exec(eventEditorUrl)?.[1] as string;
    await signIn(page, "Dev Administrator");

    const [picture] = (await listed(page, { q: fileName })).filter((asset) => asset.name === fileName);
    expect(picture, "the stored picture is listed by its name").toBeDefined();
    // The summary, the description and the film's poster all use one stored file: the event's
    // own list is that file, each marked as used here — nothing another page or album stored.
    const here = await listed(page, { for: `event:${eventId}`, source: "here" });
    expect(here.map((asset) => asset.id)).toEqual([picture.id]);
    expect(here.every((asset) => asset.here === true)).toBe(true);
    expect(picture.uses).toEqual(expect.arrayContaining(["event", "page"]));
    // Another event, well formed, that uses nothing: its own list is empty.
    expect(await listed(page, { for: "event:00000000-0000-4000-8000-000000000000", source: "here", q: fileName })).toEqual([]);
    // `parsePickerScope` reads `for` strictly: a malformed id is no place, so «here» means
    // nothing and the answer is the unscoped list — no `here` on any picture, the picture found.
    for (const malformed of ["event:not-a-uuid", `event:${eventId}x`, `team:${eventId}`]) {
      const answer = await listed(page, { for: malformed, source: "here", q: fileName });
      expect(answer.map((asset) => asset.id), malformed).toEqual([picture.id]);
      expect(answer.some((asset) => "here" in asset), malformed).toBe(false);
    }
  });

  test("a card of «Echipa» takes a gallery picture by its id, and deleting the card leaves the picture the pages use", async ({ page }) => {
    test.setTimeout(90_000);
    expect(fileName, "the first part stored the picture").not.toBe("");
    const name = `Alergătoare ${suffix()}-${Date.now().toString(36)}`;
    await signIn(page, "Dev Administrator");
    const [picture] = (await listed(page, { q: fileName })).filter((asset) => asset.name === fileName);

    await page.goto("/ro/admin/pages/team");
    await openFold(page.locator("#team-new"));
    const form = page.getByTestId("team-create-form");
    await form.locator('[name="name"]').fill(name);
    const photo = form.getByRole("group", { name: "Fotografia" });
    await photo.getByRole("button", { name: "Din galerie" }).click();
    const picker = photo.getByTestId("team-photo-new-gallery");
    await picker.getByLabel("Caută după numele fișierului").fill(fileName.toUpperCase());
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await items.first().click();
    await expect(picker).toHaveCount(0);
    // The card keeps the stored picture's own id — linked, never copied — and shows its small file.
    await expect(form.locator('[name="photoAssetId"]')).toHaveValue(picture.id);
    await expect(photo.locator("img")).toHaveAttribute("src", picture.thumb);
    await form.getByRole("button", { name: "Adaugă cardul" }).click();

    const card = page.getByRole("list", { name: "Cardurile echipei, în ordinea de pe pagină" }).getByRole("listitem").filter({ hasText: name });
    await expect(card).toHaveCount(1, { timeout: 15_000 });
    // Hidden by default (§459), so the site's menu never gains «Echipa» from this spec.
    await expect(card.getByText("Ascuns", { exact: true })).toBeVisible();
    await expect(card.getByText("Fără fotografie", { exact: true })).toHaveCount(0);
    expect((await listed(page, { q: fileName })).find((asset) => asset.id === picture.id)?.uses).toContain("team");

    await card.getByRole("button", { name: "Șterge cardul" }).click();
    await confirmDialog(page);
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    // The pages and the event still use it: the picture stays, no longer a team's.
    const after = (await listed(page, { q: fileName })).find((asset) => asset.id === picture.id);
    expect(after?.uses).not.toContain("team");
    expect(after?.uses).toContain("page");
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
    albumUrl = new URL(page.url()).pathname;
  });

  test("a photo removed from the album leaves the stored picture a page still uses", async ({ page }) => {
    expect(albumUrl, "the album part ran").not.toBe("");
    await signIn(page, "Dev Administrator");
    await page.goto(albumUrl);
    await expect(page.getByText("Fotografii (1)")).toBeVisible();
    const photo = page.getByRole("listitem").filter({ has: page.getByRole("img", { name: /^Fotografia 1: / }) });
    await photo.getByRole("button", { name: "Șterge", exact: true }).click();
    await confirmDialog(page, "Ștergi fotografia?");
    await expect(page.getByText("Fotografii (1)")).toHaveCount(0, { timeout: 15_000 });

    // Still stored: listed under «Toate» and under «Pagină», no longer an album's.
    await page.getByRole("button", { name: "Din galerie" }).click();
    const picker = page.getByTestId("album-gallery-picker");
    const sources = picker.getByTestId("album-gallery-picker-sources");
    await expect(sources.getByRole("button", { name: "Toate" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await picker.getByLabel("Caută după numele fișierului").fill(fileName);
    const items = picker.getByTestId("gallery-picker-item");
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await sources.getByRole("button", { name: "Pagină", exact: true }).click();
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    const [picture] = (await listed(page, { q: fileName })).filter((asset) => asset.name === fileName);
    expect(picture.uses).not.toContain("album");
    expect(picture.uses).toContain("page");

    // And the page's text still draws it: the stored file answers.
    await page.goto(pageEditorUrl);
    const src = (await page.locator('[data-rich-text="translations.ro.body"] img[src*="/api/media/"]').getAttribute("src")) as string;
    expect(src).toBe(storedSrc);
    expect((await page.request.get(src)).status()).toBe(200);
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
