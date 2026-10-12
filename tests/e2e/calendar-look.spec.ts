import { expect, test, type Browser } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * The facelift's phase 4 — the calendar under «Aspectul nou» (`docs/REDESIGN.md`, BR-REQ-041-01,
 * BR-REQ-070-02). The gate the plan names: at 320 px the first calendar week is above the fold, the
 * filters work with scripts off, one `h1`, 44-pixel targets, both languages. And off, nothing new is
 * drawn: no chip, no legend, no next event, no subscribe box, today's «Adaugă în calendarul tău».
 *
 * The setting is switched through «Setări» → «Aspect», as `header-nav.spec.ts` does (a direct write
 * would not expire the public cache's copy), serially, on the desktop project only — one shared
 * `platform_settings` row — with this spec's own viewports, and put back off whatever happens.
 */
async function setLook(browser: Browser, choice: "on" | "off"): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, "Dev Administrator");
    await page.goto("/ro/admin/settings/appearance");
    const panel = page.locator("#main").getByTestId("site-look");
    if (await panel.evaluate((element) => element.tagName === "DETAILS")) await openFold(panel);
    await panel.getByTestId(`site-look-option-${choice}`).click();
    await panel.getByRole("button", { name: "Salvează aspectul" }).click();
    await confirmDialog(page, "Schimbi aspectul site-ului?");
    await expect(page.locator("#admin-alert").getByText("Aspectul site-ului a fost salvat", { exact: false })).toBeVisible();
  } finally {
    await context.close();
  }
}

test.describe("phase 4: the calendar under «Aspectul nou»", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "one shared platform_settings row");
  });

  test("off: no chips, legend, next event or subscribe box; today's subscribe row", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "off");
    await page.goto("/ro/calendar");
    await expect(page.locator("html")).not.toHaveAttribute("data-look", /.*/);
    await expect(page.getByTestId("calendar-kind-chips")).toBeHidden();
    await expect(page.getByTestId("calendar-legend")).toBeHidden();
    await expect(page.getByTestId("calendar-aside")).toBeHidden();
    await expect(page.getByTestId("calendar-next-event")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Adaugă în calendarul tău" })).toBeVisible();
  });

  test("on: the first week above the fold at 320 × 568, one h1, chips in one row of 44-pixel links", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto("/ro/calendar");
      await expect(page.locator("html")).toHaveAttribute("data-look", "2026");
      await expect(page.locator("#main h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();

      const chips = page.getByTestId("calendar-kind-chips");
      await expect(chips).toBeVisible();
      for (const name of ["Toate evenimentele", "Alergări săptămânale", "Evenimente speciale"]) await expect(chips.getByRole("link", { name })).toHaveCount(1);
      const row = await chips.boundingBox();
      expect(row?.height ?? 0, "one row of chips").toBeLessThanOrEqual(60);
      for (const link of await chips.getByRole("link").all()) {
        const box = await link.boundingBox();
        expect(box?.height ?? 0, "a chip is a thumb's target").toBeGreaterThanOrEqual(44);
        // On a phone the pill is smaller than ChipLink's own 24 pixels (§734, amending §733), inside the same 44-pixel link.
        const pill = (await link.locator(".MuiChip-root").boundingBox())?.height ?? 0;
        expect(pill, "the pill is small on a phone").toBeGreaterThanOrEqual(18);
        expect(pill, "the pill is small on a phone").toBeLessThanOrEqual(22);
      }
      // The row shows that it scrolls: a drawn scrollbar always in sight (a phone's own shows only mid-scroll), and an edge cue.
      await expect(chips, "the edge cue is on while it can scroll").toHaveAttribute("data-more-end", "");
      const scroller = await chips.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth }));
      expect(scroller.over, "at 320 pixels the chips overflow").toBe(true);
      const bar = page.getByTestId("calendar-kind-chips-bar");
      await expect(bar, "the drawn scrollbar is in sight").toBeVisible();
      const barWidth = (await bar.boundingBox())?.width ?? 0;
      const thumbWidth = (await bar.locator("span").boundingBox())?.width ?? 0;
      expect(thumbWidth, "the thumb is the share on screen").toBeGreaterThan(0);
      expect(thumbWidth, "the thumb is the share on screen").toBeLessThan(barWidth);
      await chips.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await expect(chips).toHaveAttribute("data-more-start", "");
      await expect(chips).not.toHaveAttribute("data-more-end", "");
      await chips.evaluate((el) => {
        el.scrollLeft = 0;
      });

      // A laptop: everything fits, so nothing fades and no bar is drawn (the polling negation waits for the resize).
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(chips).not.toHaveAttribute("data-more-end", "");
      await expect(chips).not.toHaveAttribute("data-more-start", "");
      await expect(bar).toBeHidden();
      const desktopPill = (await chips.getByRole("link").first().locator(".MuiChip-root").boundingBox())?.height ?? 0;
      expect(desktopPill, "ChipLink's own small pill from sm").toBeGreaterThanOrEqual(22);
      expect(desktopPill, "ChipLink's own small pill from sm").toBeLessThanOrEqual(26);
      await page.setViewportSize({ width: 320, height: 568 });

      const grid = page.locator("#main").getByRole("table");
      await expect(grid).toBeVisible();
      const firstRowBottom = await grid.getByRole("cell").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
      test.info().annotations.push({ type: "first week row bottom (look on)", description: `${Math.round(firstRowBottom * 10) / 10}px of 568` });
      expect(firstRowBottom, "the first week row ends inside the screen").toBeLessThanOrEqual(568);

      await expect(page.getByTestId("calendar-legend")).toBeVisible();
      for (const word of ["Alergări săptămânale", "Evenimente speciale", "Alte evenimente"]) await expect(page.getByTestId("calendar-legend")).toContainText(word);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "nothing wider than the page").toBeLessThanOrEqual(0);
    } finally {
      await setLook(browser, "off");
    }
  });

  test("on: the chips filter with scripts off, every other filter kept", async ({ browser }) => {
    test.slow();
    await setLook(browser, "on");
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto("/ro/calendar");
      const chips = page.getByTestId("calendar-kind-chips");
      await expect(chips).toBeVisible();
      await chips.getByRole("link", { name: "Evenimente speciale" }).click();
      await expect(page).toHaveURL(/\/ro\/calendar\/\d{4}-\d{2}\?kind=special$/);
      await expect(page.getByTestId("calendar-kind-chips").getByRole("link", { name: "Evenimente speciale" })).toHaveAttribute("aria-current", "page");

      // A surface chip, if the month offers one, keeps the kind.
      const surface = page.getByTestId("calendar-kind-chips").getByRole("link", { name: /^(Asfalt|Trail|Mixt)$/ }).first();
      if ((await surface.count()) > 0) {
        await surface.click();
        await expect(page).toHaveURL(/\?kind=special&surface=[A-Z]+$/);
      }
      // «Toate evenimentele» drops the kind and keeps the rest.
      await page.getByTestId("calendar-kind-chips").getByRole("link", { name: "Toate evenimentele" }).click();
      await expect(page).not.toHaveURL(/kind=/);
    } finally {
      await context.close();
      await setLook(browser, "off");
    }
  });

  test("on: the next event and the subscribe box beside the month on a desktop, in both languages", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/ro/calendar");
      const grid = page.locator("#main").getByRole("table");
      const aside = page.getByTestId("calendar-aside");
      await expect(aside).toBeVisible();
      const [gridBox, asideBox] = [await grid.boundingBox(), await aside.boundingBox()];
      expect((asideBox?.x ?? 0) > (gridBox?.x ?? 0) + (gridBox?.width ?? 0) - 1, "the second column, right of the month").toBe(true);

      const next = page.getByTestId("calendar-next-event");
      if ((await next.count()) > 0) {
        await expect(next).toContainText("Următorul eveniment");
        await expect(next.getByTestId("calendar-next-details")).toHaveAttribute("href", /^\/ro\/evenimente\//);
      }
      const box = page.getByTestId("calendar-subscribe");
      await expect(box.getByRole("heading", { name: "Vrei să nu ratezi alergările?" })).toBeVisible();
      await expect(box.getByTestId("subscribe-outlook")).toHaveAttribute("href", /^https:\/\/outlook\.live\.com\/calendar\/0\/addfromweb\/\?url=webcal%3A%2F%2F/);
      await expect(box.getByTestId("subscribe-outlook-work")).toHaveAttribute("href", /^https:\/\/outlook\.office\.com\/calendar\/0\/addfromweb\/\?url=webcal%3A%2F%2F/);
      await expect(box.getByTestId("subscribe-apple")).toHaveAttribute("href", /^webcal:\/\//);
      await expect(box.getByTestId("subscribe-ics")).toHaveAttribute("href", "/ro/events/calendar.ics");
      for (const row of ["subscribe-google", "subscribe-apple", "subscribe-outlook", "subscribe-outlook-work", "subscribe-ics"]) {
        expect((await box.getByTestId(row).boundingBox())?.height ?? 0, row).toBeGreaterThanOrEqual(44);
      }
      // Today's row gives way to the box under the look.
      await expect(page.getByRole("heading", { name: "Adaugă în calendarul tău" })).toBeHidden();

      await page.goto("/en/calendar");
      await expect(page.getByTestId("calendar-kind-chips").getByRole("link", { name: "All events" })).toBeVisible();
      await expect(page.getByTestId("calendar-legend")).toContainText("Other events");
      await expect(page.getByTestId("calendar-subscribe").getByRole("heading", { name: "Don't want to miss a run?" })).toBeVisible();
    } finally {
      await setLook(browser, "off");
    }
  });
});
