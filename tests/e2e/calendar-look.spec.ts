import { expect, test, type Browser } from "@playwright/test";
import { confirmDialog } from "./support/confirm";
import { signIn } from "./support/featured-event";
import { openFold } from "./support/fold";

/**
 * The facelift's phase 4 — the calendar under «Tema v2» (`docs/REDESIGN.md`, BR-REQ-041-01,
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
    await panel.getByRole("button", { name: "Salvează tema" }).click();
    await confirmDialog(page, "Schimbi tema site-ului?");
    await expect(page.locator("#admin-alert").getByText("Tema site-ului a fost salvată", { exact: false })).toBeVisible();
    // The public pages' cached copy follows the save a moment after the alert: wait for it, or the first visit meets the old theme.
    await expect
      .poll(async () => /<html[^>]*data-look="2026"/.test(await (await page.request.get("/ro/evenimente")).text()), { timeout: 20_000 })
      .toBe(choice === "on");
  } finally {
    await context.close();
  }
}

/** The page's `h1` is clipped to a pixel: kept for assistive technology, not drawn. */
const hiddenHeading = (page: import("@playwright/test").Page) =>
  page.locator("#main h1").evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width <= 1 && rect.height <= 1 && getComputedStyle(el).position === "absolute";
  });

/** Every visible element above the chips' line that says only «Calendar»: the title and the wordmark's band. */
const visibleCalendarWords = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const line = document.querySelector("[data-testid=calendar-chips-line]")!.getBoundingClientRect().top;
    return Array.from(document.querySelectorAll("#main *"))
      .filter((el) => el.children.length === 0 && /^calendar$/i.test((el.textContent ?? "").trim()))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2 && rect.bottom <= line + 1;
      }).length;
  });

test.describe("phase 4: the calendar under «Tema v2»", () => {
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
      // One `h1`, «Calendar», kept for the page's name and not drawn (§745).
      await expect(page.locator("#main h1")).toHaveCount(1);
      await expect(page.locator("#main h1")).toHaveText("Calendar");
      expect(await hiddenHeading(page), "the h1 is visually hidden").toBe(true);

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

  test("on: no visible «Calendar» above the chips, the wordmark without its band, one h1 (§745)", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/ro/calendar");
        await expect(page.locator("html")).toHaveAttribute("data-look", "2026");
        await expect(page.locator("#main h1")).toHaveCount(1);
        expect(await hiddenHeading(page), `the h1 is not drawn at ${viewport.width}`).toBe(true);
        expect(await visibleCalendarWords(page), `no «Calendar» word above the chips at ${viewport.width}`).toBe(0);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/ro/calendar");
      // The wordmark stays, and says only the club's name: no band under it.
      const wordmark = page.getByTestId("wordmark");
      await expect(wordmark).toBeVisible();
      await expect(wordmark).toHaveText("BRASOV RUNNERS");
      // Tema v1: today's title and sentence are back, drawn.
      await setLook(browser, "off");
      await page.goto("/ro/calendar");
      await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
      expect(await hiddenHeading(page)).toBe(false);
      await expect(page.locator("#main").getByText("Luna clubului:", { exact: false }).filter({ visible: true })).toHaveCount(1);
    } finally {
      await setLook(browser, "off");
    }
  });

  test("on: the «?» sits under the controls at the row's end and opens there, with scripts off too", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/ro/calendar");
        const fold = page.getByTestId("calendar-intro-help");
        await expect(fold).toHaveCount(1);
        const summary = fold.locator("summary");
        const [chipRow, summaryBox, card] = [await page.getByTestId("calendar-chip-row").boundingBox(), await summary.boundingBox(), await page.getByTestId("calendar-month-card").boundingBox()];
        expect(summaryBox?.width ?? 0, "44 px wide").toBeGreaterThanOrEqual(44);
        expect(summaryBox?.height ?? 0, "44 px tall").toBeGreaterThanOrEqual(44);
        expect(summaryBox?.y ?? 0, `under the controls at ${viewport.width}`).toBeGreaterThanOrEqual((chipRow?.y ?? 0) + (chipRow?.height ?? 0) - 1);
        expect((summaryBox?.x ?? 0) + (summaryBox?.width ?? 0), "at the row's end").toBeGreaterThanOrEqual((card?.x ?? 0) + (card?.width ?? 0) - 20);
        await summary.click();
        await expect(fold).toHaveAttribute("open", "");
        const panel = fold.getByText("Luna clubului:", { exact: false });
        await expect(panel).toBeVisible();
        expect((await panel.boundingBox())?.y ?? 0, "the panel opens from the «?», over the month").toBeGreaterThanOrEqual((summaryBox?.y ?? 0) + (summaryBox?.height ?? 0) - 1);
        await expect(fold.getByRole("link", { name: "Google Calendar" })).toBeVisible();
        await summary.click();
        await expect(fold).not.toHaveAttribute("open", "");
      }
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, viewport: { width: 320, height: 568 } });
      try {
        const bare = await context.newPage();
        await bare.goto("/ro/calendar");
        await bare.getByTestId("calendar-intro-help").locator("summary").click();
        await expect(bare.getByTestId("calendar-intro-help").getByRole("link", { name: "Google Calendar" })).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await setLook(browser, "off");
    }
  });

  test("on: «Filtre» ends the chips' line outside the scroller, its panel opens under the whole line", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/ro/calendar");
        const line = page.getByTestId("calendar-chips-line");
        const chips = page.getByTestId("calendar-kind-chips");
        const filters = page.getByTestId("listing-filters");
        const summary = filters.locator("summary");
        await expect(summary, "the month offers something to narrow").toBeVisible();
        const [lineBox, chipsBox, summaryBox] = [await line.boundingBox(), await chips.boundingBox(), await summary.boundingBox()];
        expect(lineBox?.height ?? 0, `one 44-pixel line at ${viewport.width}`).toBeLessThanOrEqual(56);
        expect(summaryBox?.height ?? 0, "a thumb's target").toBeGreaterThanOrEqual(44);
        expect(Math.abs((summaryBox?.y ?? 0) - (chipsBox?.y ?? 99)), "on the chips' line").toBeLessThanOrEqual(2);
        expect(summaryBox?.x ?? 0, "outside the scroller, at the line's end").toBeGreaterThanOrEqual((chipsBox?.x ?? 0) + (chipsBox?.width ?? 0) - 1);
        expect((summaryBox?.x ?? 0) + (summaryBox?.width ?? 0), "inside the page").toBeLessThanOrEqual(viewport.width);
        // On a phone the chips scroll and «Filtre» stays in sight.
        if (viewport.width === 320) {
          await chips.evaluate((el) => {
            el.scrollLeft = el.scrollWidth;
          });
          expect((await summary.boundingBox())?.x ?? 0).toBe(summaryBox?.x);
          await chips.evaluate((el) => {
            el.scrollLeft = 0;
          });
        }
        await summary.click();
        await expect(filters).toHaveAttribute("open", "");
        const form = filters.locator("form");
        await expect(form).toBeVisible();
        const formBox = await form.boundingBox();
        expect(formBox?.y ?? 0, "the panel opens under the whole line").toBeGreaterThanOrEqual((lineBox?.y ?? 0) + (lineBox?.height ?? 0) - 1);
        expect(formBox?.width ?? 0, "full width").toBeGreaterThanOrEqual((lineBox?.width ?? 0) - 2);
        await summary.click();
        await expect(filters).not.toHaveAttribute("open", "");
      }
    } finally {
      await setLook(browser, "off");
    }
  });

  test("on: the panel under «Filtre» submits with scripts off; off the look «Filtre» is on a line of its own as before", async ({ browser }) => {
    test.slow();
    await setLook(browser, "on");
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto("/ro/calendar");
      const filters = page.getByTestId("listing-filters");
      await filters.locator("summary").click({ timeout: 10000 });
      // Under the look the surface is the chips', so the first box the panel shows is another group's.
      const box = filters.locator("form input[type=checkbox]:visible").first();
      const name = await box.getAttribute("name", { timeout: 10000 });
      await box.check({ timeout: 15000 });
      await filters.getByRole("button", { name: "Aplică" }).click({ timeout: 10000 });
      await expect(page).toHaveURL(new RegExp(`${name}=`));
      await expect(page.getByTestId("listing-filters").locator(`input[name="${name}"]:checked`)).toHaveCount(1);
    } finally {
      await context.close();
      await setLook(browser, "off");
    }
    const off = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1280, height: 900 } });
    try {
      const page = await off.newPage();
      await page.goto("/ro/calendar");
      const [kinds, summary] = [await page.getByTestId("calendar-kind-chips").boundingBox(), await page.getByTestId("listing-filters").locator("summary").boundingBox()];
      expect(kinds, "the chips are not drawn off the look").toBeNull();
      expect(summary?.x ?? 99, "«Filtre» starts the line, as before").toBeLessThan(80);
    } finally {
      await off.close();
    }
  });

  test("on: a date on a day gone is faded and says it; off, nothing is marked (§745)", async ({ page, browser }) => {
    test.slow();
    // The seed's weekly run stands on the last Sunday: one to seven days ago, so on that day's month.
    const day = new Date(Date.now() - (((new Date().getUTCDay() + 7) % 7) || 7) * 86_400_000);
    const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit" }).format(day).replace("/", "-");
    await setLook(browser, "on");
    try {
      for (const layout of ["", "/list"]) {
        await page.goto(`/ro/calendar/${month}${layout}`);
        const past = page.locator("#main a[aria-label*='a trecut'] > [data-past]").first();
        await expect(past, `a past date is marked${layout ? " in the list" : ""}`).toBeVisible();
        await expect(page.locator("#main a[aria-label*='a trecut']").first()).toHaveAttribute("href", /\/ro\/evenimente\//);
        const faded = await past.evaluate((el) => {
          const style = getComputedStyle(el);
          return { filter: style.filter, background: style.backgroundColor, color: style.color };
        });
        test.info().annotations.push({ type: `past entry${layout}`, description: JSON.stringify(faded) });
        expect(faded.filter, "never blurred").toBe("none");
        expect(faded.background, "a light fill").toMatch(/0\.0\d/);
      }
      await setLook(browser, "off");
      await page.goto(`/ro/calendar/${month}`);
      await expect(page.locator("#main [data-past]")).toHaveCount(0);
      await expect(page.locator("#main a[aria-label*='a trecut']")).toHaveCount(0);
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

  /** The picker's outline box, the segmented «Lună | An» group and «Azi»: height and radius as the page computes them. */
  const headMeasures = (page: import("@playwright/test").Page) =>
    page.evaluate(() => {
      const root = document.querySelector("[data-testid=calendar-period-row] .MuiOutlinedInput-root") as HTMLElement;
      const group = document.querySelector("[data-testid=calendar-chip-row] [role=group]") as HTMLElement;
      const today = Array.from(document.querySelectorAll("[data-testid=calendar-period-row] a")).find((a) => !a.getAttribute("aria-label")) as HTMLElement;
      const label = document.querySelector("[data-testid=calendar-period-row] label") as HTMLElement;
      const of = (el: HTMLElement) => ({ height: Math.round(el.getBoundingClientRect().height), radius: getComputedStyle(el).borderTopLeftRadius });
      return { select: of(root), group: of(group), today: of(today), labelWidth: Math.round(label.getBoundingClientRect().width), head: Math.round(document.querySelector("[data-testid=calendar-period-row]")!.getBoundingClientRect().height) };
    });

  test("on: «Luna» and «Anul» are the segmented group's and «Azi»'s height and radius, the label hidden but the name kept; at 320 px the row is no taller", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "on");
    try {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 320, height: 568 }]) {
        await page.setViewportSize(viewport);
        await page.goto("/ro/calendar");
        const m = await headMeasures(page);
        expect(m.select.height, `the selects stand as high as the group at ${viewport.width}`).toBe(m.group.height);
        expect(m.select.height, "a thumb's target").toBeGreaterThanOrEqual(44);
        expect(m.select.radius, "the group's radius").toBe(m.group.radius);
        expect(m.today.radius, "Azi's radius").toBe(m.group.radius);
        expect(m.labelWidth, "the label is visually hidden").toBeLessThanOrEqual(2);
        await expect(page.getByRole("combobox", { name: "Luna" })).toBeVisible();
        await expect(page.getByRole("combobox", { name: "Anul" })).toBeVisible();
        if (viewport.width === 320) expect(m.head, "the period row stays one 44-pixel row").toBeLessThanOrEqual(48);
      }
    } finally {
      await setLook(browser, "off");
    }
  });

  test("off: the head is today's — outlined selects with their floating labels, 34 pixels from sm", async ({ page, browser }) => {
    test.slow();
    await setLook(browser, "off");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/ro/calendar");
    const m = await headMeasures(page);
    expect(m.labelWidth, "the label is drawn").toBeGreaterThan(8);
    expect(m.select.height).toBeLessThanOrEqual(36);
    expect(m.select.radius).not.toBe(m.group.radius);
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
