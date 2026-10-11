import { expect, type Locator, type Page, type Request, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { fillDateField, fillTimeField, hydrated, signIn } from "./support/featured-event";
import { languagePanel, languageTab, openEditorBox, openFold } from "./support/fold";

/**
 * BR-REQ-011-01 and BR-REQ-050-02 (§NNN) — «Traseul»'s Strava and Garmin Connect maps, behind one
 * press each, and the GPX file the club uploads.
 *
 * The owner, 2026-10-11: «so basically I need to put all: Garmin Connect embedded, Strava embedded,
 * Garmin Connect link, Strava link AND GPX file» — «Garmin Connect / Strava in tabs and GPX file at
 * the bottom of them».
 *
 * Walked through the rendered editor (the two embed codes pasted as the services give them, a GPX
 * uploaded) and the published page, where the browser's own request listener proves that nothing is
 * asked of Strava or Garmin before the visitor presses, and that one press loads that one map only.
 * The two services' hosts are answered by the test itself (`page.route`), so the run never reaches
 * them; every id and token is invented. Its own event, so the two projects never share a row.
 */

const STRAVA_ID = "1111222233334444555";
const GARMIN_ID = "987654321";
const TOKEN = "abc123def456abc123def456abc123def456abcd";
// Built from parts, like every address in the suite.
const STRAVA_EMBEDS = ["https:/", "strava-embeds.com", "embed.js"].join("/");
const GARMIN_EMBED_SRC = ["https:/", "connect.garmin.com", "embed", "course", GARMIN_ID].join("/");
const GARMIN_LINK = ["https:/", "connect.garmin.com", "modern", "course", GARMIN_ID].join("/");
const STRAVA_EMBED = `<div class="strava-embed-placeholder" data-embed-type="route" data-embed-id="${STRAVA_ID}" data-style="hybrid" data-map-hash="11.66/45.6375/25.5935" data-from-embed="false" data-token="${TOKEN}"></div><script src="${STRAVA_EMBEDS}"></script>`;
const GARMIN_EMBED = `<iframe src=${GARMIN_EMBED_SRC} width='465' height='548' title='Course Embed'></iframe>`;
const TRACK = Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Tâmpa</name><trkseg><trkpt lat="45.6375" lon="25.5935"><ele>600</ele></trkpt></trkseg></trk></gpx>\n`,
);

/** A request to either service: what must not happen before a press. */
const PROVIDER = /(^|\.)(strava-embeds\.com|strava\.com|garmin\.com)$/;
const PROVIDER_ROUTE = (url: URL) => PROVIDER.test(url.hostname);
const isProvider = (request: Request) => PROVIDER.test(new URL(request.url()).hostname);

let slug = "";
let slugEn = "";

const heightOf = async (target: Locator) => (await target.boundingBox())?.height ?? 0;

/** Answers both services' hosts locally and keeps every request made to them. */
async function watchProviders(page: Page): Promise<Request[]> {
  const seen: Request[] = [];
  page.on("request", (request) => {
    if (isProvider(request)) seen.push(request);
  });
  await page.route(PROVIDER_ROUTE, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>map</title><p>map</p>" }));
  return seen;
}

test.describe.serial("BR-REQ-011-01 «Traseul»'s maps and GPX (§NNN)", () => {
  test("are pasted in «Traseul», the file uploaded in «Linkuri și fișiere», and the event is published", async ({ page }) => {
    test.setTimeout(test.info().timeout + 60_000);
    const suffix = `${test.info().project.name}-${Date.now().toString(36)}`;
    slug = `harta-traseului-${suffix}`;
    slugEn = `route-map-${suffix}`;
    const field = (name: string) => page.locator(`textarea[name="${name}"], input[name="${name}"]`).first();

    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/events/new");
    await hydrated(page);
    await fillDateField(page, "Începutul evenimentului", "2027-05-15");
    await fillTimeField(page, "Ora", "19:00");
    await field("event.locationName").fill("Stația de telecabină Tâmpa");
    await field("event.locationNameEn").fill("Tâmpa cable car station");
    await field("translations.ro.title").fill(`Harta traseului ${suffix}`);
    await field("translations.ro.slug").fill(slug);
    await languageTab(page, "title", "en").click();
    await field("translations.en.title").fill(`The route's map ${suffix}`);
    await languageTab(page, "address", "en").click();
    await field("translations.en.slug").fill(slugEn);
    await page.getByRole("button", { name: "Creează evenimentul" }).click();
    await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}/);
    await hydrated(page);

    const course = await openEditorBox(page, "Traseul");
    await field("event.routeGarmin").fill(GARMIN_EMBED);
    await field("event.routeStrava").fill(STRAVA_EMBED);
    // The file is uploaded in «Linkuri și fișiere» (the owner looked for it on the GPX row), not in «Traseul».
    await expect(course.getByTestId("route-gpx-input")).toHaveCount(0);
    const links = await openEditorBox(page, "Linkuri și fișiere");
    await links.getByTestId("route-gpx-input").setInputFiles({ name: "Traseu Tâmpa.gpx", mimeType: "application/gpx+xml", buffer: TRACK });
    await expect(links.getByTestId("route-gpx-current")).toContainText("Traseu Tâmpa.gpx", { timeout: 20_000 });
    // A row of kind GPX offers the same upload.
    await links.getByRole("combobox", { name: "Tip" }).first().click();
    await page.getByRole("option", { name: "Traseul (GPX)" }).click();
    await expect(links.getByTestId("link-row-upload-gpx")).toBeVisible();
    await links.getByRole("combobox", { name: "Tip" }).first().click();
    await page.getByRole("option", { name: "Link", exact: true }).click();
    await expect(links.getByTestId("link-row-upload-gpx")).toHaveCount(0);

    const excerpt = async (locale: "ro" | "en", text: string) => {
      const panel = languagePanel(page, "title", locale);
      await openFold(panel.locator(`[data-rich-text-fold="translations.${locale}.excerptBody"]`));
      await panel.locator(`[data-rich-text="translations.${locale}.excerptBody"] [data-field]`).click();
      await page.keyboard.type(text);
    };
    await openEditorBox(page, "Titlu și rezumat");
    await excerpt("ro", "Alergare pe Tâmpa, cu harta traseului.");
    await languageTab(page, "title", "en").click();
    await excerpt("en", "A run on the Tâmpa, with the route's map.");

    await page.getByRole("button", { name: "Salvează", exact: true }).click();
    await page.waitForURL(/saved=event/);
    // The closed card names what is set, and the box gives back the stored map, never other markup.
    await expect(page.locator("#box-course")).toContainText("Garmin");
    await expect(page.locator("#box-links")).toContainText("GPX încărcat");
    await openEditorBox(page, "Traseul");
    await expect(field("event.routeGarmin")).toHaveValue(GARMIN_LINK);
    await expect(field("event.routeStrava")).toHaveValue(new RegExp(`data-embed-id="${STRAVA_ID}"[\\s\\S]*data-token="${TOKEN}"`));
    await expect(field("event.routeStrava")).not.toHaveValue(/script/);

    await page.getByRole("button", { name: "Trimite spre verificare" }).click();
    await page.waitForURL(/saved=IN_REVIEW/);
    await page.getByRole("button", { name: "Publică" }).click();
    await confirmDialog(page);
    await page.waitForURL(/saved=PUBLISHED/);
  });

  test("ask nothing of Strava or Garmin until pressed; a press loads that one map, in its own tab", async ({ page }) => {
    const seen = await watchProviders(page);
    await page.goto(`/ro/evenimente/${slug}`);
    await hydrated(page);
    const section = page.locator("section#route");
    await expect(section.getByRole("heading", { name: "Traseul", exact: true })).toBeVisible();

    // Garmin first, chosen; Strava beside it. Both links are there, built from the ids.
    const tabs = section.getByRole("tab");
    await expect(tabs).toHaveText(["Garmin Connect", "Strava"]);
    await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
    for (const tab of await tabs.all()) expect(await heightOf(tab)).toBeGreaterThanOrEqual(44);
    const garmin = section.getByTestId("route-map-garmin");
    const strava = section.getByTestId("route-map-strava");
    await expect(garmin).toBeVisible();
    await expect(strava).toBeHidden();
    await expect(garmin.getByRole("link", { name: /Deschide în Garmin Connect/ })).toHaveAttribute("href", GARMIN_LINK);
    await expect(garmin).toContainText("Harta se încarcă de la Garmin când apeși; Garmin vede adresa ta IP.");

    // Scrolled through, waited on: nothing has been asked of either service, and no script of theirs is on the page.
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(1_000);
    expect(seen.map((request) => request.url())).toEqual([]);
    expect(await page.locator("script[src*='strava'], script[src*='garmin']").count()).toBe(0);

    // To the Strava tab with the keyboard: still nothing loads.
    await tabs.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(strava).toBeVisible();
    await expect(garmin).toBeHidden();
    await page.waitForTimeout(500);
    expect(seen).toHaveLength(0);

    // The press: Strava's map, from Strava's embed host, and nothing from Garmin.
    const press = strava.getByTestId("route-map-show-strava");
    expect(await heightOf(press)).toBeGreaterThanOrEqual(44);
    const loaded = page.waitForRequest((request) => new URL(request.url()).hostname === "strava-embeds.com");
    await press.click();
    const request = await loaded;
    expect(new URL(request.url()).pathname).toBe(`/route/${STRAVA_ID}`);
    expect(new URL(request.url()).searchParams.get("token")).toBe(TOKEN);
    await expect(strava.getByTestId("route-map-frame-strava")).toBeVisible();
    expect(seen.every((made) => new URL(made.url()).hostname === "strava-embeds.com")).toBe(true);
    expect(seen.some((made) => /garmin/.test(new URL(made.url()).hostname))).toBe(false);

    // A 320-pixel phone never scrolls sideways for it.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("downloads the GPX under the maps, as a file, in either language", async ({ page }) => {
    const seen = await watchProviders(page);
    await page.goto(`/en/events/${slugEn}`);
    const section = page.locator("section#route");
    await expect(section.getByRole("heading", { name: "The route", exact: true })).toBeVisible();
    await expect(section.getByRole("tab")).toHaveText(["Garmin Connect", "Strava"]);
    await expect(section.getByTestId("route-map-garmin")).toContainText("The map loads from Garmin when you press; Garmin sees your IP address.");

    const download = section.getByTestId("route-gpx-download");
    await expect(download).toContainText("Download the route (GPX)");
    await expect(download).toContainText("Traseu Tâmpa.gpx");
    await expect(download).toHaveAttribute("download", "traseu-tampa.gpx");
    expect(await heightOf(download)).toBeGreaterThanOrEqual(44);
    // Below the tabs, as the owner placed it.
    const tabsBox = await section.getByTestId("route-map-tabs").boundingBox();
    const fileBox = await download.boundingBox();
    expect((fileBox?.y ?? 0) > (tabsBox?.y ?? 0)).toBe(true);

    const answer = await page.request.get((await download.getAttribute("href")) ?? "");
    expect(answer.status()).toBe(200);
    expect(answer.headers()["content-type"]).toBe("application/gpx+xml");
    expect(answer.headers()["content-disposition"]).toBe('attachment; filename="traseu-tampa.gpx"');
    expect(Buffer.from(await answer.body()).equals(TRACK)).toBe(true);
    expect(seen).toHaveLength(0);
  });
});
