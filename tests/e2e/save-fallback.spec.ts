import { expect, type Locator, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN — a backoffice save survives a network that blocks Server Action calls, and says so; the
 * network check names what to allow.
 *
 * The proxy is played by the page's own router: every request carrying a `Next-Action` header —
 * the scripted save, and nothing else — is answered with a 403 HTML page, the way Zscaler answered
 * Amalia's saves. Page loads, client-side navigations and plain form posts pass.
 *
 * The save is "Termene" on `/admin/emails`, pressed with the numbers it shows: it lands, and it
 * changes nothing, so both projects may run it against the one `platform_settings` row. Twice:
 * once on a page the server drew (its form carries React's no-JavaScript fields) and once reached
 * by a client-side navigation (its form has none, and the fallback takes them from the page's HTML).
 */

/** The proxy: Server Action calls get a block page; everything else goes through. */
async function blockServerActions(page: Page): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      await route.fulfill({
        status: 403,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><title>Blocked</title><h1>This request was blocked by your organization's security policy.</h1>",
      });
      return;
    }
    await route.fallback();
  });
}

async function saveDeadlinesAsTheyAre(page: Page, panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Salvează termenele" }).click();
  await confirmDialog(page, "Salvezi termenele?");
  await expect(page).toHaveURL(/saved=deadlines/, { timeout: 30_000 });
  // The notice the replay left, above the page, with the way to the network check.
  const notice = page.getByTestId("save-fallback");
  await expect(notice).toContainText("Rețeaua de la birou a blocat cererea de salvare; am trimis-o pe calea simplă.");
  await expect(notice.getByRole("link", { name: "Verifică rețeaua" })).toBeVisible();
  // The save itself: the banner the redirect carries, and the toast its flash cookie carries (§384).
  await expect(page.locator("#main").getByText("Termenele au fost salvate", { exact: false })).toBeVisible();
  await expect(page.getByTestId("toast")).toBeVisible();
  // Shown once: the cookie is gone, and a refresh says nothing more.
  await page.reload();
  await hydrated(page);
  await expect(page.getByTestId("save-fallback")).toHaveCount(0);
}

test.describe("§NNN a save the network blocked goes the simple way", () => {
  test("on a page the server drew, the form's own no-JavaScript fields carry it", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await blockServerActions(page);
    await page.goto("/ro/admin/emails");
    await hydrated(page);
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.locator('input[name^="$ACTION_"]').first()).toBeAttached();
    await saveDeadlinesAsTheyAre(page, panel);
  });

  test("after a client-side navigation, the fields come from the page's own HTML", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await blockServerActions(page);
    await page.goto("/ro/admin/guide");
    await hydrated(page);
    // The guide's link is next-intl's `Link`: the emails page is drawn by the browser.
    await page.getByRole("link", { name: "Vezi emailurile pe care le primesc participanții" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/emails/);
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    await expect(panel.getByRole("button", { name: "Salvează termenele" })).toBeVisible();
    await expect(panel.locator('input[name^="$ACTION_"]')).toHaveCount(0);
    await saveDeadlinesAsTheyAre(page, panel);
  });

  test("a refusal sent the simple way comes back with the boxes as typed", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await blockServerActions(page);
    await page.goto("/ro/admin/guide");
    await hydrated(page);
    await page.getByRole("link", { name: "Vezi emailurile pe care le primesc participanții" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/emails/);
    const panel = page.locator("#main").getByTestId("deadlines");
    await openFold(panel);
    // Out of bounds, past the browser's own check: the server refuses it and nothing is saved.
    const hold = panel.locator('input[name="holdMinutes"]');
    await hold.fill("5");
    await hold.evaluate((input: HTMLInputElement) => input.removeAttribute("min"));
    await panel.getByRole("button", { name: "Salvează termenele" }).click();
    await confirmDialog(page, "Salvezi termenele?");
    // The page the plain POST rendered: the refusal, naming the box, and the box as typed (§315).
    await expect(page.getByTestId("save-fallback")).toBeVisible({ timeout: 30_000 });
    const refused = page.locator("#main").getByTestId("deadlines");
    await expect(refused.getByTestId("form-refusal")).toContainText("Locul e ținut pentru semnarea declarației (minute)");
    await expect(refused.locator('input[name="holdMinutes"]')).toHaveValue("5");
    await expect(refused.locator(":scope > summary")).toContainText("loc ținut 30 de minute");
  });
});

test.describe("§NNN a plain form goes the simple way too", () => {
  test("the person lookup — a bare form with no island of its own — lands through the admin boundary", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    await blockServerActions(page);
    await page.goto("/ro/admin/registrations/person");
    await hydrated(page);
    await page.locator('input[name="email"]').fill("nobody-e2e-network@example.test");
    await page.getByRole("button", { name: "Caută" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/registrations\/person\?q=/, { timeout: 30_000 });
    await expect(page.getByTestId("save-fallback")).toBeVisible();
  });
});

test.describe("§NNN the network check", () => {
  test("every staff role reads the four rows; saves are green, and red when the network blocks them", async ({ page }) => {
    // The desk's role — the lowest there is — reaches it from the guide.
    await signIn(page, "Dev Contributor");
    await page.goto("/ro/admin/guide");
    await hydrated(page);
    await page.getByTestId("guide-network").getByRole("link", { name: "Verifică rețeaua" }).click();
    await expect(page).toHaveURL(/\/ro\/admin\/network$/);
    await expect(page.getByRole("heading", { name: "Verificarea rețelei" })).toBeVisible();

    for (const id of ["saves", "post", "pictures", "botCheck"]) await expect(page.getByTestId(`network-row-${id}`)).toBeVisible();
    await expect(page.getByTestId("network-row-saves")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await expect(page.getByTestId("network-row-post")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    // The line for IT names this site's host, from configuration.
    const host = new URL(page.url()).host;
    await expect(page.getByTestId("network-row-saves")).toContainText(`Permite: cererile POST către ${host} cu antetul Next-Action`);

    await blockServerActions(page);
    await page.reload();
    await expect(page.getByTestId("network-row-saves")).toHaveAttribute("data-state", "blocked", { timeout: 20_000 });
    await expect(page.getByTestId("network-row-saves")).toContainText("Blocat");
    // The simple path still passes — which is why the saves still land.
    await expect(page.getByTestId("network-row-post")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    // The report says it, without anything about the person.
    await expect(page.getByTestId("network-report")).toHaveValue(/Salvările: Blocat — Permite:/, { timeout: 20_000 });
  });
});
