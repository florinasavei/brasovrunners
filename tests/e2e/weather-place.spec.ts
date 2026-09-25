import { existsSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import pg from "pg";
import { hydrated, signIn } from "./support/featured-event";

/**
 * BR-REQ-011-01 and BR-REQ-041-01 (§NNN, amending §402) — the weather at the event's own place, with
 * more of it. The owner, 2026-09-25: "aș vrea să văd vremea și pe cardul principal" and "la vreme aș
 * vrea să văd exact pe locația selectată, să văd mai multe date".
 *
 * The suite's server answers every forecast with the same fixed hour at every place
 * (`E2E_WEATHER_STUB`): partly cloudy, 14 °C, 20% rain, 11 km/h — and the page's details, feels like
 * 12 °C, 0.4 mm, gusts of 24 km/h, 72% humidity, UV 3. So a spec reads the words, and which place was
 * asked is read from what the page says about it («Pentru locul evenimentului» / «Pentru Brașov»)
 * and from the editor's line under «Coordonate».
 *
 * The events whose block is read are drafts this spec writes straight to the database and removes
 * after, read through the preview (which draws the public page's facts and reads the forecast the
 * same way): a draft is on no public listing, so no other spec's count moves while this one runs,
 * and a start two days out is inside the seven days whatever today is. The listing's small card is
 * read on the seed: the interval session (Wednesday, one to seven days out) or the Tâmpa run
 * (Saturday, two to eight days out) is always inside the window, whatever the weekday.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

async function withDatabase<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const DAY = 86_400_000;

/** A draft group run two days from now, with its place as given; returns its id. */
async function insertDraft(place: { mapUrl?: string; latitude?: number; longitude?: number }, tag: string): Promise<string> {
  return withDatabase(async (client) => {
    const startsAt = new Date(Math.floor((Date.now() + 2 * DAY) / 3_600_000) * 3_600_000);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO events (type, surface, starts_at, location_name, map_url, latitude, longitude)
       VALUES ('GROUP_RUN', 'TRAIL', $1, 'Stația de telecabină Tâmpa', $2, $3, $4) RETURNING id`,
      [startsAt, place.mapUrl ?? null, place.latitude ?? null, place.longitude ?? null],
    );
    const id = rows[0].id;
    const suffix = `${tag}-${Date.now().toString(36)}`;
    await client.query(
      `INSERT INTO event_translations (event_id, locale, slug, title, excerpt) VALUES
       ($1, 'ro', $2, 'Vremea la locul evenimentului', 'Un test.'), ($1, 'en', $3, 'Weather at the place', 'A test.')`,
      [id, `vremea-${suffix}`, `weather-${suffix}`],
    );
    return id;
  });
}

async function remove(id: string): Promise<void> {
  await withDatabase(async (client) => {
    await client.query("DELETE FROM event_translations WHERE event_id = $1", [id]);
    await client.query("DELETE FROM events WHERE id = $1", [id]);
  });
}

/** The facts' «Vremea» / «Weather» row: its `<dd>`. */
const weatherRow = (page: Page, label: string) =>
  page.locator('[data-testid="event-facts"] dt').filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("BR-REQ-011-01 the weather block at the event's own place (§NNN)", () => {
  test("a map link with a pin: the start and the two hours after it, the start's details, «Pentru locul evenimentului»", async ({ page }) => {
    const id = await insertDraft({ mapUrl: "https://www.google.com/maps?q=45.6384,25.5921" }, "pin");
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/preview/events/${id}`);
      const weather = weatherRow(page, "Vremea");
      await expect(weather).toBeVisible();
      await expect(weather).toContainText("Parțial noros");

      // Three hours, each its time, its glyph, its degrees and its chance of rain.
      const hours = weather.getByTestId("weather-hours");
      await expect(hours).toHaveAttribute("aria-label", "Pe ore, de la start");
      const cells = hours.getByTestId("weather-hour");
      await expect(cells).toHaveCount(3);
      for (const cell of await cells.all()) {
        await expect(cell).toContainText(/\d\d:\d\d/);
        await expect(cell).toContainText("14 °C");
        await expect(cell).toContainText("20% ploaie");
        await expect(cell.locator("svg")).toHaveCount(1);
      }
      // One row of three on a 320-pixel phone: the cells share a top edge.
      const tops = await Promise.all((await cells.all()).map(async (cell) => Math.round((await cell.boundingBox())?.y ?? -1)));
      expect(new Set(tops).size).toBe(1);

      // The start hour's details, in one line under the first.
      const details = weather.getByTestId("weather-details");
      await expect(details).toContainText("se simte ca 12 °C");
      await expect(details).toContainText("0,4 mm precipitații");
      await expect(details).toContainText("rafale 24 km/h");
      await expect(details).toContainText("umiditate 72%");
      await expect(details).toContainText("indice UV 3");

      // Where it was read, before the credit — which stays a 44-pixel link.
      const credit = weather.getByTestId("weather-credit");
      await expect(credit).toContainText("Pentru locul evenimentului");
      const link = credit.getByRole("link", { name: "Prognoză: Open-Meteo" });
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await noSidewaysScroll(page);

      // The same in English.
      await page.goto(`/en/preview/events/${id}`);
      const english = weatherRow(page, "Weather");
      await expect(english.getByTestId("weather-details")).toContainText("feels like 12 °C");
      await expect(english.getByTestId("weather-details")).toContainText("gusts 24 km/h");
      await expect(english.getByTestId("weather-hour").first()).toContainText("20% rain");
      await expect(english.getByTestId("weather-credit")).toContainText("For the event's place");

      // The editor's «Coordonate» box stays empty, and the line under it says the link's pin is read.
      await page.goto(`/ro/admin/events/${id}`);
      await hydrated(page);
      await expect(page.getByTestId("weather-place")).toContainText("punctul din linkul hărții (45.6384, 25.5921)");
    } finally {
      await remove(id);
    }
  });

  test("a short link with typed «Coordonate»: read at the pair; neither: read at the club's place, and said so", async ({ page }) => {
    const typed = await insertDraft({ mapUrl: "https://maps.app.goo.gl/AbCdEf123", latitude: 45.6384, longitude: 25.5921 }, "typed");
    const none = await insertDraft({ mapUrl: "https://maps.app.goo.gl/AbCdEf123" }, "club");
    try {
      await signIn(page, "Dev Administrator");
      await page.goto(`/ro/preview/events/${typed}`);
      await expect(weatherRow(page, "Vremea").getByTestId("weather-credit")).toContainText("Pentru locul evenimentului");
      await page.goto(`/ro/admin/events/${typed}`);
      await hydrated(page);
      await expect(page.locator('input[name="event.coordinates"]')).toHaveValue("45.6384, 25.5921");
      await expect(page.getByTestId("weather-place")).toContainText("aceste coordonate (45.6384, 25.5921)");

      await page.goto(`/ro/preview/events/${none}`);
      await expect(weatherRow(page, "Vremea").getByTestId("weather-credit")).toContainText("Pentru Brașov");
      await page.goto(`/ro/admin/events/${none}`);
      await hydrated(page);
      await expect(page.locator('input[name="event.coordinates"]')).toHaveValue("");
      await expect(page.getByTestId("weather-place")).toContainText("linkul hărții nu conține coordonate");
    } finally {
      await remove(typed);
      await remove(none);
    }
  });
});

test.describe("BR-REQ-041-01 the weather on a listing card (§NNN)", () => {
  test("a card within seven days of its start wears the glyph and the degrees; the listing credits Open-Meteo once", async ({ page }) => {
    await page.goto("/ro/evenimente");
    const main = page.locator("#main");
    await expect(main.locator("ul > li h2").first()).toBeAttached();
    // A phone folds a long list (§78): open every fold before measuring.
    await page.evaluate(() => document.querySelectorAll("details").forEach((details) => (details.open = true)));

    const pills = main.locator('ul > li [data-testid="card-weather"]');
    expect(await pills.count()).toBeGreaterThanOrEqual(1);
    const pill = pills.first();
    await expect(pill).toBeVisible();
    await expect(pill).toContainText("14 °C");
    await expect(pill.locator("svg")).toHaveCount(1);
    // The word is for a screen reader; the rain and the wind are the page's.
    await expect(pill).toContainText("Vremea la start: Parțial noros");
    await expect(pill).not.toContainText("ploaie");
    // As tall as the card's other chips (24 px), inside its card.
    const box = await pill.boundingBox();
    expect(Math.round(box?.height ?? 0)).toBe(24);
    const card = main.locator("ul > li").filter({ has: pill }).first();
    const cardBox = await card.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((cardBox?.x ?? 0) + (cardBox?.width ?? 0) + 0.5);

    const credit = main.getByTestId("listing-weather-credit").getByRole("link", { name: "Prognoză: Open-Meteo" });
    await expect(credit).toHaveCount(1);
    expect((await credit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
  });

  test("the anniversary race, three weeks out, carries no weather on the hero", async ({ page }) => {
    await page.goto("/ro/evenimente");
    await expect(page.locator("#main ul > li h2").first()).toBeAttached();
    await expect(page.getByTestId("hero-weather")).toHaveCount(0);
  });
});
