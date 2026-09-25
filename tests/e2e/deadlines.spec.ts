import { existsSync } from "node:fs";
import { expect, test, type Browser } from "@playwright/test";
import pg from "pg";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §377 — "Termene" on `/admin/emails`: the club's deadlines, one box each, the Administrator's.
 *
 * One round trip that ends where it began: the defaults are read, one deadline is changed and read
 * back in the panel's line and in the reminder's when-line under it. The defaults come back in an
 * `afterEach`, whatever happened in the test — a failure halfway must not leave every later spec
 * on this database reading three-day reminders. Desktop only, like the Mailgun plan beside it: one
 * `platform_settings` row, two projects, one database.
 */

function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: this spec needs the database the server uses");
  return url;
}

/**
 * The defaults back, through the panel — the save drops the server's copy and expires the public
 * pages' cached one, which a bare `DELETE` would not. In a browser context of its own, signed in
 * afresh, whatever the test's page was left doing. Should the page itself be what broke, the row
 * goes anyway (no row reads as the defaults), so the database is right even if a cache lags a minute.
 */
async function restoreDefaults(browser: Browser, defaults: Record<string, string>): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    for (const [name, value] of Object.entries(defaults)) await panel.locator(`input[name="${name}"]`).fill(value);
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await expect(page.locator("#main").getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
  } catch {
    const client = new pg.Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      await client.query("DELETE FROM platform_settings WHERE key = 'deadlines'");
    } finally {
      await client.end();
    }
  } finally {
    await context.close();
  }
}
test.describe("§377 the club's deadlines on /admin/emails", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  const DEFAULTS = {
    confirmationHours: "48",
    holdMinutes: "30",
    offerHours: "24",
    reminderHours: "48",
    selfCheckinHours: "24",
    raceWeekDays: "7",
    seriesHorizonDays: "56",
  };

  // Set by a test that is about to save; the restore runs only then, with time of its own.
  let changed = false;
  test.afterEach(async ({ browser }) => {
    if (!changed) return;
    changed = false;
    test.setTimeout(test.info().timeout + 60_000);
    await restoreDefaults(browser, DEFAULTS);
  });

  test("an Administrator changes a deadline, and the page says it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/emails");
    const main = page.locator("#main");
    const panel = main.getByTestId("deadlines");

    // A closed fold, whose line already says the four a participant meets most.
    await expect(panel).not.toHaveAttribute("open");
    await expect(panel.locator(":scope > summary")).toContainText("Link 48 de ore · loc ținut 30 de minute · ofertă 24 de ore · reminder 2 zile");
    await openFold(panel);
    for (const [name, value] of Object.entries(DEFAULTS)) await expect(panel.locator(`input[name="${name}"]`)).toHaveValue(value);

    // Three days for the reminder.
    changed = true;
    await panel.locator('input[name="reminderHours"]').fill("72");
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await expect(main.getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator(":scope > summary")).toContainText("reminder 3 zile");
    // The reminder's card under it says the new lead before it is opened.
    await expect(main.locator("#email-EVENT_REMINDER > summary")).toContainText("cu 3 zile înainte de start");

    // A number outside its bounds is refused, naming the box, and nothing is saved.
    await panel.locator('input[name="holdMinutes"]').fill("5");
    await panel.locator('input[name="holdMinutes"]').evaluate((input: HTMLInputElement) => input.removeAttribute("min"));
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await expect(panel.getByTestId("form-refusal")).toContainText("Locul e ținut pentru semnarea declarației (minute)");
    // The box comes back as typed (§315); the saved line still says three days.
    await expect(panel.locator('input[name="holdMinutes"]')).toHaveValue("5");
    await expect(panel.locator(":scope > summary")).toContainText("loc ținut 30 de minute");
  });

  test("an Organizer reads the numbers in force and is offered no form", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/emails");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByText("Termenele le schimbă Administratorul", { exact: false })).toBeVisible();
    await expect(panel.getByTestId("deadline-holdMinutes")).toHaveText("30");
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toHaveCount(0);
    await expect(panel.locator("input")).toHaveCount(0);
  });
});
