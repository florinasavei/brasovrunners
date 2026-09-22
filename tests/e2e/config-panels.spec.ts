import { expect, test } from "@playwright/test";
import { signIn } from "./support/featured-event";

/**
 * BR-REQ-090-04, BR-REQ-090-05, `DECISIONS.md` §265 — the configuration screens are panels.
 *
 * The owner: "partea de configurare ar trebui să aibă subtaburi, pt status, general, mailuri,
 * captcha, etc". Both screens had grown to seven panels on one scroll, so the anti-bot switch —
 * the one control the club may need on the day it refuses real people — was below the price of
 * every service the club uses.
 *
 * What this walk protects is the part a unit test cannot: that each panel actually renders its
 * own sections and *not* the others, that a bare URL opens on the first one, and that a
 * nonsense panel falls back rather than showing an empty page.
 */
test.describe("§265 the configuration panels", () => {
  test.skip(() => test.info().project.name !== "desktop", "one viewport is enough");

  test("divides the club's to-do screen into what is owed, the anti-bot switch and the costs", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");

    // The first panel, from a bare URL: the checklist, and no cost table.
    await page.goto("/ro/admin/tasks");
    await expect(main.getByRole("heading", { name: "Cât costă" })).toHaveCount(0);
    await expect(main.getByRole("navigation").getByRole("link", { name: "De făcut" })).toHaveAttribute("aria-current", "page");

    // The switch, one press away rather than seven hundred lines down.
    await main.getByRole("link", { name: "Anti-robot" }).click();
    await expect(page).toHaveURL(/panel=botCheck/);
    await expect(main.getByRole("heading", { name: /anti-bot/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Cât costă" })).toHaveCount(0);

    // And the prices.
    await main.getByRole("link", { name: "Costuri" }).click();
    await expect(page).toHaveURL(/panel=costs/);
    await expect(main.getByRole("heading", { name: "Cât costă" })).toBeVisible();

    // A panel nobody offered reads as the first one, never as an empty screen.
    await page.goto("/ro/admin/tasks?panel=nonsense");
    await expect(main.getByRole("navigation").getByRole("link", { name: "De făcut" })).toHaveAttribute("aria-current", "page");
  });

  test("divides the system screen into status, general and email", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const main = page.locator("#main");

    await page.goto("/ro/devs");
    // Status: the database's month. Not the variables — those are the general panel's.
    await expect(main.getByRole("heading", { name: /Baza de date/i })).toBeVisible();
    await expect(main.getByRole("heading", { name: "Configurație" })).toHaveCount(0);

    await main.getByRole("link", { name: "General" }).click();
    await expect(page).toHaveURL(/panel=general/);
    await expect(main.getByRole("heading", { name: "Configurație" })).toBeVisible();
    await expect(main.getByRole("heading", { name: /Roluri/i })).toBeVisible();

    await main.getByRole("link", { name: "Emailuri" }).click();
    await expect(page).toHaveURL(/panel=email/);
    await expect(main.getByRole("heading", { name: /e-?mail/i }).first()).toBeVisible();
    await expect(main.getByRole("heading", { name: "Configurație" })).toHaveCount(0);

    // The anti-bot switch is the club's, on the other screen, and the sub-nav says so.
    await main.getByRole("link", { name: "Anti-robot" }).click();
    await expect(page).toHaveURL(/\/admin\/tasks\?panel=botCheck/);
  });
});
