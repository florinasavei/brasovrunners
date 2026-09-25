import { expect, type Page, test } from "@playwright/test";

/**
 * BR-REQ-011-01 (§NNN) — «Vremea» / «Weather» on the event page, within seven days of the start.
 * A new criterion of that requirement, as the partner marker and the headlamp pill each got theirs
 * (criteria 18–19, 23); `docs:land` adds it alongside `DECISIONS.md` §NNN.
 *
 * The suite's server answers every forecast with one fixed hour (`E2E_WEATHER_STUB`, set by
 * `playwright.config.ts`): partly cloudy, 14 °C, a 20% chance of rain, an 11 km/h wind — and never
 * reaches Open-Meteo. The seed's runs are dated from today (`db/seeds/sample-dates.ts`): the
 * interval session is the next Wednesday one to seven days ahead, the Tâmpa run the next Saturday
 * two to eight days ahead, and the anniversary cross three weeks and more away. So the spec reads
 * the interval session — or, on a Wednesday, when that one is a whole week out, the Tâmpa run —
 * and the cross for the absent row.
 */

/** Today's weekday in Brașov, 0 = Sunday — the seed's own clock. */
function weekdayInBrasov(): number {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", weekday: "short" }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

const SOON =
  weekdayInBrasov() === 3
    ? { ro: "/ro/evenimente/tura-pe-tampa", en: "/en/events/tampa-trail" }
    : { ro: "/ro/evenimente/antrenament-de-intervale-olimpia", en: "/en/events/interval-session-olimpia" };

/** The facts' row with this label: its `<dd>`. */
const row = (page: Page, label: string) =>
  page.locator('[data-testid="event-facts"] dt').filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

test.describe("BR-REQ-011-01 the weather at the start (§NNN)", () => {
  test("the Romanian page says the forecast for a start within seven days, and credits Open-Meteo", async ({ page }) => {
    await page.goto(SOON.ro);
    const weather = row(page, "Vremea");
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("Parțial noros");
    await expect(weather).toContainText("14 °C");
    await expect(weather).toContainText("20% șanse de ploaie");
    await expect(weather).toContainText("vânt 11 km/h");

    // The credit the data's licence asks for, a thumb's target like every link on the page.
    const credit = weather.getByRole("link", { name: "Prognoză: Open-Meteo" });
    await expect(credit).toHaveAttribute("href", /open-meteo\.com/);
    expect((await credit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The row's glyph is the forecast's own, drawn at the row glyph's size.
    const glyph = page.locator('[data-testid="event-facts"] dt').filter({ hasText: /^Vremea$/ }).locator("svg");
    expect(Math.round((await glyph.boundingBox())?.width ?? 0)).toBe(20);

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the English page says it in English", async ({ page }) => {
    await page.goto(SOON.en);
    const weather = row(page, "Weather");
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("Partly cloudy");
    await expect(weather).toContainText("14 °C");
    await expect(weather).toContainText("20% chance of rain");
    await expect(weather).toContainText("wind 11 km/h");
    await expect(weather.getByRole("link", { name: "Forecast: Open-Meteo" })).toBeVisible();
  });

  test("a start more than seven days away has no weather row", async ({ page }) => {
    await page.goto("/ro/evenimente/crosul-aniversar-brasov-runners");
    await expect(page.locator('[data-testid="event-facts"]')).toBeVisible();
    await expect(page.locator('[data-testid="event-facts"] dt').filter({ hasText: /^Vremea$/ })).toHaveCount(0);
    await expect(page.getByText("Open-Meteo")).toHaveCount(0);
  });
});
