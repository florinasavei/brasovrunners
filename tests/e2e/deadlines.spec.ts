import { existsSync } from "node:fs";
import { expect, test, type Browser, type Locator } from "@playwright/test";
import pg from "pg";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §377 — "Termene": the club's deadlines, one box each, the Administrator's — «Setări» → «Termene»
 * since §516, one tab over from the messages whose when-lines state them.
 *
 * One round trip that ends where it began: the defaults are read, one deadline is changed and read
 * back in the panel's line and in the reminder's when-line under it. The defaults come back in an
 * `afterEach`, whatever happened in the test — a failure halfway must not leave every later spec
 * on this database reading three-day reminders. Desktop only, like the Mailgun plan beside it: one
 * `platform_settings` row, two projects, one database.
 *
 * The thirteen boxes sit in seven named folds, closed on arrival (§377 amended, 2026-10-18): a spec
 * that types into a box opens the fold that holds it first, the way a person does. The one save and
 * the fill button are under the folds, outside them.
 */

/** The seven folds of «Termene» (`DEADLINE_GROUPS`), in the order the screen draws them. */
const GROUPS = ["confirmation", "hold", "beforeStart", "afterEvent", "series", "family", "outage"] as const;

/** One fold of the seven, by its group. */
const group = (panel: Locator, key: (typeof GROUPS)[number]) => panel.getByTestId(`deadline-group-${key}`);

/** Every fold of the seven opened, the way a person does it (`openFold`). */
async function openGroups(panel: Locator): Promise<void> {
  for (const key of GROUPS) await openFold(group(panel, key));
}

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
    await page.goto("/ro/admin/settings/deadlines");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await openGroups(panel);
    for (const [name, value] of Object.entries(defaults)) await panel.locator(`input[name="${name}"]`).fill(value);
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await confirmDialog(page, "Salvezi termenele?");
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
test.describe("§377 the club's deadlines on «Setări» → «Termene»", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  const DEFAULTS = {
    confirmationHours: "48",
    holdMinutes: "30",
    offerHours: "24",
    reminderHours: "48",
    // The last call to sign before a window's deadline (§665).
    lastCallHours: "48",
    selfCheckinHours: "24",
    raceWeekDays: "7",
    seriesHorizonDays: "56",
    // How long a public participant list stays up after the event (§421).
    publicListDays: "30",
    // The longest stretch one outage moves the running deadlines by (§657).
    outageGraceMaxHours: "48",
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
    await page.goto("/ro/admin/settings/deadlines");
    const main = page.locator("#main");
    const panel = main.getByTestId("deadlines");

    // The tab is this card alone, so it arrives open (§516); its line says the four a participant meets most.
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator(":scope > summary")).toContainText("Link 48 de ore · loc ținut 30 de minute · ofertă 24 de ore · reminder 2 zile");
    await openFold(panel);

    // Seven named folds, all closed, each with its closed line in words; the one save and the fill
    // button are under them, outside them, and so in view with every fold shut.
    for (const key of GROUPS) await expect(group(panel, key), key).not.toHaveAttribute("open", "");
    await expect(group(panel, "confirmation").locator(":scope > summary")).toContainText("Confirmarea adresei");
    await expect(group(panel, "confirmation").locator(":scope > summary")).toContainText("link 48 de ore · retrimis după 20 de ore · retrimiteri: o dată");
    await expect(group(panel, "hold").locator(":scope > summary")).toContainText("loc ținut 30 de minute · ofertă 24 de ore");
    await expect(group(panel, "beforeStart").locator(":scope > summary")).toContainText("reminder 2 zile");
    await expect(group(panel, "outage").locator(":scope > summary")).toContainText("mutare cel mult 48 de ore");
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Completează valorile recomandate" })).toBeVisible();
    // A fold opens on its own and leaves the others shut.
    await openFold(group(panel, "hold"));
    await expect(group(panel, "beforeStart")).not.toHaveAttribute("open", "");

    await openGroups(panel);
    for (const [name, value] of Object.entries(DEFAULTS)) await expect(panel.locator(`input[name="${name}"]`)).toHaveValue(value);

    // Three days for the reminder.
    changed = true;
    await panel.locator('input[name="reminderHours"]').fill("72");
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    // It asks first (§384), naming what changes and what does not.
    await expect(page.getByRole("dialog", { name: "Salvezi termenele?" })).toContainText("Nimic din ce s-a dat deja nu se schimbă");
    await confirmDialog(page, "Salvezi termenele?");
    await expect(main.getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
    await expect(panel).toHaveAttribute("open", "");
    await expect(panel.locator(":scope > summary")).toContainText("reminder 3 zile");
    // Its fold stays shut after the save, and says the new lead on its closed line, with the count of what differs.
    await expect(group(panel, "beforeStart")).not.toHaveAttribute("open", "");
    await expect(group(panel, "beforeStart").locator(":scope > summary")).toContainText("reminder 3 zile");
    await expect(group(panel, "beforeStart").locator(":scope > summary")).toContainText("1 diferit de recomandat");
    // The reminder's card, one tab over on «Emailuri», says the new lead before it is opened.
    await main.getByRole("navigation", { name: "Setări" }).getByRole("link", { name: "Emailuri" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/emails/);
    await expect(main.locator("#email-EVENT_REMINDER > summary")).toContainText("cu 3 zile înainte de start");
    await main.getByRole("navigation", { name: "Setări" }).getByRole("link", { name: "Termene" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/settings\/deadlines/);

    // A number outside its bounds is refused, naming the box, and nothing is saved.
    const hold = group(panel, "hold");
    await openFold(hold);
    await panel.locator('input[name="holdMinutes"]').fill("5");
    await panel.locator('input[name="holdMinutes"]').evaluate((input: HTMLInputElement) => input.removeAttribute("min"));
    // The fold shut again before the save: the refusal opens the fold around the box it names (`revealField`).
    await hold.locator(":scope > summary").press("Enter");
    await expect(hold).not.toHaveAttribute("open", "");
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await confirmDialog(page, "Salvezi termenele?");
    await expect(panel.getByTestId("form-refusal")).toContainText("Locul e ținut pentru semnarea declarației (minute)");
    await expect(hold).toHaveAttribute("open", "");
    // The box comes back as typed (§315); the saved line still says thirty minutes.
    await expect(panel.locator('input[name="holdMinutes"]')).toHaveValue("5");
    await expect(panel.locator(":scope > summary")).toContainText("loc ținut 30 de minute");
    await expect(hold.locator(":scope > summary")).toContainText("loc ținut 30 de minute");

    // «Completează valorile recomandate» fills the boxes — saving nothing — and opens the folds around
    // what it changed (the reminder is 72 now), leaving the others shut.
    await page.goto("/ro/admin/settings/deadlines");
    await hydrated(page);
    const again = page.locator("#main").getByTestId("deadlines");
    await openFold(again);
    await expect(group(again, "beforeStart")).not.toHaveAttribute("open", "");
    await again.getByRole("button", { name: "Completează valorile recomandate" }).click();
    await expect(group(again, "beforeStart")).toHaveAttribute("open", "");
    await expect(again.locator('input[name="reminderHours"]')).toHaveValue("48");
    await expect(group(again, "hold")).not.toHaveAttribute("open", "");
  });

  test("an Organizer reads the numbers in force and is offered no form", async ({ page }) => {
    await signIn(page, "Dev Moderator");
    await page.goto("/ro/admin/settings/deadlines");
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByText("Termenele le schimbă Administratorul", { exact: false })).toBeVisible();
    // The same seven folds, with the values in them and no box.
    for (const key of GROUPS) await expect(group(panel, key), key).toHaveCount(1);
    await openFold(group(panel, "hold"));
    await expect(panel.getByTestId("deadline-holdMinutes")).toHaveText("30");
    await expect(group(panel, "hold").locator(":scope > summary")).toContainText("loc ținut 30 de minute");
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toHaveCount(0);
    await expect(panel.locator("input")).toHaveCount(0);
  });
});

/**
 * §377 (amended) at 320 px, the narrowest viewport BR-REQ-041-01 names: «Setări»' row of six tabs,
 * each now with its glyph, scrolls sideways inside itself and never widens the page; the seven
 * folds, opened, fit the width and keep a thumb's 44 px; the one save is in view. Reads and opens
 * only — nothing is saved, so it needs no restore.
 */
test.describe("§377 «Termene» at 320 px", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "mobile", "the 320 px viewport is the mobile project's");
  });

  test("the tab row scrolls inside itself, the folds fit, and the page does not overflow", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/settings/deadlines");
    const main = page.locator("#main");
    const panel = main.getByTestId("deadlines");
    await openFold(panel);

    // Six tabs, each with a glyph before its words; the current one is in view (`SubNavCurrent`).
    const row = main.getByRole("navigation", { name: "Setări" });
    const tabs = row.getByRole("link");
    await expect(tabs).toHaveText(["Emailuri", "Termene", "Aspect", "Costuri", "Anti-robot", "Configurație"]);
    for (let index = 0; index < 6; index += 1) await expect(tabs.nth(index).locator("svg")).toHaveCount(1);
    await expect(row.getByRole("link", { name: "Termene" })).toHaveAttribute("aria-current", "page");
    await expect(row.getByRole("link", { name: "Termene" })).toBeInViewport();
    // The row is wider than the screen by design (§731), and scrolls in its own box.
    const geometry = await row.evaluate((nav) => ({ client: nav.clientWidth, scroll: nav.scrollWidth, page: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
    expect(geometry.client).toBeLessThanOrEqual(geometry.view);
    expect(geometry.page).toBeLessThanOrEqual(geometry.view);

    // The seven folds, shut: each a full-width bar a thumb can press.
    for (const key of GROUPS) {
      const box = await group(panel, key).locator(":scope > summary").boundingBox();
      expect(box?.height ?? 0, key).toBeGreaterThanOrEqual(44);
      expect((box?.x ?? 0) + (box?.width ?? 0), key).toBeLessThanOrEqual(320);
    }
    await openGroups(panel);
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
