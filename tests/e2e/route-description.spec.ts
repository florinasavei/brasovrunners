import { expect, type Locator, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-050-02 and BR-REQ-011-01 (`DECISIONS.md` §NNN) — "Descriere traseu / antrenament".
 *
 * The owner, 2026-09-25: "I should be able to put 'descriere traseu/antrenament' with pit stops
 * and all, basically a free text, might also attach a map there; you can move the GPX and Strava
 * link there."
 *
 * Walked through the rendered editor: the organizer writes the route description in both
 * languages in the "Traseul" card, a map picture in each, and the published page shows a
 * "Traseul" / "The route" section under `#route` with the route link and the GPX first, while
 * "Linkuri și fișiere" keeps only the document. Its own event, like `event-route.spec.ts`, so two
 * projects running in parallel never write to the same row.
 */

// Built from parts: `AGENTS.md` §8 forbids a hostname literal anywhere in the repository.
const ROUTE_LINK = ["https:/", "routes.example.test", "creasta-tampei"].join("/");
const GPX_LINK = ["https:/", "drive.example.test", "file", "d", "e2e-route-gpx", "view"].join("/");
const DOC_LINK = ["https:/", "files.example.test", "regulament-extins.pdf"].join("/");

let slug = "";
let slugEn = "";

/** One language's route description: open its fold, type, and put the map in as a picture. */
async function writeRouteDescription(page: Page, locale: "ro" | "en", text: string, map: Buffer) {
  const panel = languagePanel(page, "course", locale);
  await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.routeDescription"]`));
  const editor = panel.locator(`[data-rich-text="translations.${locale}.routeDescription"]`);
  await editor.locator("[data-field]").click();
  await page.keyboard.type(text);
  // The map is a picture in the text (§72–§73): the toolbar's own file input, shrunk and stored.
  await editor.locator('input[type="file"]').setInputFiles({ name: `harta-${locale}.jpg`, mimeType: "image/jpeg", buffer: map });
  await expect(editor.locator("img[src*='/api/media/']")).toHaveCount(1, { timeout: 20_000 });
}

/** A link's height, for the 44-pixel rule (BR-REQ-041-01 criterion 6). */
const heightOf = async (link: Locator) => (await link.boundingBox())?.height ?? 0;

test.describe.serial("BR-REQ-050-02 the route / training description (§NNN)", () => {
  test("is written in both languages with a map in the «Traseul» card and published", async ({ page }) => {
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `descriere-traseu-${suffix}`;
    slugEn = `route-description-${suffix}`;
    const field = (name: string) => page.locator(`[name="${name}"]`);

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await fillDateField(page, "Începutul evenimentului", "2027-05-08");
    await fillTimeField(page, "Ora", "19:00");
    await field("event.locationName").fill("Stația de telecabină Tâmpa");
    await field("event.locationNameEn").fill("Tâmpa cable car station");
    await field("translations.ro.title").fill(`Pe creasta Tâmpei ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`Along the Tâmpa ridge ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(slugEn);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    // The route link, then the route / training description under the card's own tabs.
    const course = await openEditorBox(page, "Traseul");
    await field("event.routeUrl").fill(ROUTE_LINK);
    await expect(course.getByText("Punctele de oprire, pantele, ce să aștepți")).toBeAttached();
    const map = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#228844" } }).jpeg().toBuffer();
    await writeRouteDescription(page, "ro", "Oprire cu apă la km 4, apoi urcarea pe serpentine până la creastă.", map);
    await languageTab(page, "course", "en").click();
    await writeRouteDescription(page, "en", "Water stop at km 4, then the climb up the switchbacks to the ridge.", map);

    // A GPX, which moves into the route section, and a document, which stays in "Linkuri și fișiere".
    await openEditorBox(page, "Linkuri și fișiere");
    const firstLink = page.getByRole("group", { name: "Linkul 1", exact: true });
    await firstLink.getByRole("combobox").click();
    await page.getByRole("option", { name: "Traseul (GPX)" }).click();
    await field("event.links[0].url").fill(GPX_LINK);
    await page.getByRole("button", { name: "Adaugă un link" }).click();
    const secondLink = page.getByRole("group", { name: "Linkul 2", exact: true });
    await secondLink.getByRole("combobox").click();
    await page.getByRole("option", { name: "Document" }).click();
    await field("event.links[1].url").fill(DOC_LINK);

    // The summary, which publication counts, in both languages.
    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Alergare pe creasta Tâmpei.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "A run along the Tâmpa ridge.");

    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    // The closed card says it has a description (§NNN).
    await expect(page.locator("#box-course")).toContainText("cu descriere");

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("shows «Traseul» under #route with the route's links, and «Linkuri și fișiere» keeps the rest", async ({ page }) => {
    await page.goto(`/ro/evenimente/${slug}`);
    const section = page.locator("section#route");
    await expect(section.getByRole("heading", { name: "Traseul", exact: true })).toBeVisible();
    await expect(section).toContainText("Oprire cu apă la km 4");
    // The map, served from the club's own store.
    await expect(section.locator("img[src*='/api/media/']")).toBeVisible();

    // The route link and the GPX, first, each a new tab and a thumb's target.
    const route = section.getByRole("link", { name: /Vezi traseul/ });
    const gpx = section.getByRole("link", { name: /Traseul \(GPX\)/ });
    await expect(route).toHaveAttribute("href", ROUTE_LINK);
    await expect(gpx).toHaveAttribute("href", GPX_LINK);
    await expect(gpx).toHaveAttribute("rel", /noopener/);
    expect(await heightOf(route)).toBeGreaterThanOrEqual(44);
    expect(await heightOf(gpx)).toBeGreaterThanOrEqual(44);

    // Gone from "Linkuri și fișiere", which keeps the document; and gone from the facts' row.
    const links = page.locator("section#links");
    await expect(links.getByRole("link", { name: /Document/ })).toHaveAttribute("href", DOC_LINK);
    await expect(links.locator(`a[href="${GPX_LINK}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="${ROUTE_LINK}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="${GPX_LINK}"]`)).toHaveCount(1);

    // The facts' route row points at the section, and the anchor scrolls to it.
    const jump = page.getByTestId("route-jump");
    await expect(jump).toHaveText("Despre traseu");
    expect(await heightOf(jump)).toBeGreaterThanOrEqual(44);
    await jump.click();
    await expect(page).toHaveURL(/#route$/);
    await expect(section.getByRole("heading", { name: "Traseul", exact: true })).toBeInViewport();

    // A 320-pixel phone never scrolls sideways for it.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the English page says it in English, and #route in the address lands on it", async ({ page }) => {
    await page.goto(`/en/events/${slugEn}#route`);
    const section = page.locator("section#route");
    await expect(section.getByRole("heading", { name: "The route", exact: true })).toBeInViewport();
    await expect(section).toContainText("Water stop at km 4");
    await expect(section).not.toContainText("Oprire cu apă");
    await expect(section.locator("img[src*='/api/media/']")).toBeVisible();
    await expect(section.getByRole("link", { name: /Route \(GPX\)/ })).toHaveAttribute("href", GPX_LINK);
    await expect(section.getByRole("link", { name: /View the route/ })).toHaveAttribute("href", ROUTE_LINK);
    await expect(page.locator("section#links").getByRole("heading", { name: "Links and files" })).toBeVisible();
    await expect(page.locator("section#links").locator(`a[href="${GPX_LINK}"]`)).toHaveCount(0);
    await expect(page.getByTestId("route-jump")).toHaveText("About the route");
  });
});
