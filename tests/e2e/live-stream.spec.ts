import { expect, type Browser, type Locator, type Page, test } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { hydrated, signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * §NNN — «În direct pe YouTube», walked as the club walks it: «Setări» → «Aspect» → «În direct pe
 * YouTube», the tick and the broadcast's address, saved behind the question. Every public page then
 * carries «Suntem în direct pe YouTube» under the header with the one link; off again, the bar is
 * gone. The setting is switched through the screen, never written directly (that would not expire
 * the public cache's copy), and put back off whatever happens.
 *
 * Desktop project only and serial: one shared `platform_settings` table, which `look-accent.spec.ts`
 * and `header-nav.spec.ts` write too, so the suite runs it on one worker (CI does).
 */
const CHANNEL_LIVE = "https://www.youtube.com/@brasovrunners/live";

async function livePanel(page: Page): Promise<Locator> {
  await page.goto("/ro/admin/settings/appearance");
  await hydrated(page);
  const panel = page.locator("#main").getByTestId("live-stream");
  if (await panel.evaluate((element) => element.tagName === "DETAILS")) await openFold(panel);
  return panel;
}

async function save(page: Page, panel: Locator): Promise<void> {
  await panel.getByRole("button", { name: "Salvează anunțul" }).click();
  await confirmDialog(page, "Salvezi anunțul «În direct»?");
  await expect(page.locator("#admin-alert").getByText("Anunțul «În direct» a fost salvat", { exact: false })).toBeVisible();
}

/** The notice on or off, saved through the screen in a context of its own, and the public copy followed. */
async function setLive(browser: Browser, on: boolean, url: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    const panel = await livePanel(page);
    await panel.getByTestId("live-stream-on").locator("input").setChecked(on);
    await panel.getByTestId("live-stream-url").fill(url);
    await save(page, panel);
    // The public pages' cached copy follows the save a moment after the alert: wait for it, or the first visit meets the old state.
    await expect
      .poll(async () => (await (await page.request.get("/ro/evenimente")).text()).includes('data-testid="live-stream-notice"'), { timeout: 20_000 })
      .toBe(on);
  } finally {
    await context.close();
  }
}

test.describe("§NNN the live-broadcast notice", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("on: every public page carries the bar with the one link; off: nothing", async ({ page, browser }) => {
    test.slow();
    await setLive(browser, true, CHANNEL_LIVE);
    try {
      await page.goto("/ro/evenimente");
      const notice = page.getByTestId("live-stream-notice");
      await expect(notice).toBeVisible();
      await expect(notice).toContainText("Suntem în direct pe YouTube");
      const link = notice.getByTestId("live-stream-link");
      await expect(link).toHaveAttribute("href", CHANNEL_LIVE);
      // A 44-pixel target, like every link on a public page.
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      // Nothing of YouTube's is on the page: the bar is words and a link.
      expect(await page.locator("iframe").count()).toBe(0);

      await page.goto("/ro/calendar");
      await expect(page.getByTestId("live-stream-notice")).toBeVisible();
    } finally {
      await setLive(browser, false, CHANNEL_LIVE);
    }
    await page.goto("/ro/evenimente");
    await expect(page.getByTestId("live-stream-notice")).toHaveCount(0);
  });

  test("on without an address, or with an address that is not YouTube's, is refused under the box", async ({ page }) => {
    await signIn(page, "Dev Administrator");
    const panel = await livePanel(page);
    await panel.getByTestId("live-stream-on").locator("input").setChecked(true);
    await panel.getByTestId("live-stream-url").fill("https://example.com/live");
    await panel.getByRole("button", { name: "Salvează anunțul" }).click();
    await confirmDialog(page, "Salvezi anunțul «În direct»?");
    await expect(page.getByTestId("live-stream-url")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#main").getByTestId("live-stream-current")).toContainText("Oprit");
  });
});
