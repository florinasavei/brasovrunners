import { expect, test, type Page } from "@playwright/test";

/**
 * §569 (amending §292) — the compact page head, measured on the built pages. The owner,
 * 2026-09-29, on `/ro/calendar`: «Textul ăsta de „Evenimente” e mult prea mare, pe mobil ia prea
 * mult spațiu, la fel și la „Calendar”».
 *
 * On a phone (the mobile project, at 320 and at 360 pixels):
 *   - the kit-face wordmark is not drawn — the header's lockup is the one brand on the screen;
 *   - the page's H1 is still the one `<h1>`, with its words, at 24 pixels;
 *   - what the page is for starts inside the first screen: the listing's first card, and the
 *     calendar grid's first week row. The screens are the small common phones, 320 × 568 and
 *     360 × 640, not the project's taller 720; the bound is the viewport's height — the first
 *     card's top at least one tap target (44px) above the bottom edge, the grid's first row whole.
 *     Measured on a production build with the sample data (2026-09-29): the first card's top at
 *     397.6px of 568 at 320 and 374.6px of 640 at 360;
 *     the calendar's first week row ends at 504.1px at both widths.
 *
 * On a desktop (the desktop project): the wordmark stands above the title at 16 pixels (half its
 * old 32), and the title is 28 pixels (was 32).
 *
 * `tests/unit/theme/compact-page-head.test.ts` pins the same rules in the markup `yarn check` renders.
 */

const isPhone = () => test.info().project.name === "mobile";

/** The small common phones: an iPhone SE's 320 × 568 and the usual Android 360 × 640. */
const PHONES = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
] as const;

async function fontSizeOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
}

test.describe("§569 the compact page head", () => {
  for (const phone of PHONES) {
    test(`at ${phone.width} px the listing's first card starts in the first screen, under a 24-pixel title and no wordmark`, async ({ page }) => {
      test.skip(!isPhone(), "a phone's first screen");
      await page.setViewportSize(phone);
      await page.goto("/ro/evenimente");
      const title = page.getByRole("heading", { level: 1, name: "Alergări" });
      await expect(title).toBeVisible();
      await expect(page.locator("#main h1")).toHaveCount(1);
      expect(await fontSizeOf(page, "#main h1"), "the H1 at the phone's size").toBe(24);
      // In the HTML — one page for every width, served from the CDN (§549) — and not drawn.
      await expect(page.getByTestId("wordmark")).toHaveCount(1);
      await expect(page.getByTestId("wordmark")).toBeHidden();

      const card = page.getByTestId("listing-cards").locator(":scope > li").first();
      await expect(card).toBeVisible();
      const top = await card.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      test.info().annotations.push({ type: "first card top", description: `${Math.round(top * 10) / 10}px of ${phone.height}` });
      expect(top, `the first card starts ${top}px from the top, inside a ${phone.height}px screen`).toBeLessThanOrEqual(phone.height - 44);
    });

    test(`at ${phone.width} px the calendar's first week row is in the first screen, under a 24-pixel title and no wordmark`, async ({ page }) => {
      test.skip(!isPhone(), "a phone's first screen");
      await page.setViewportSize(phone);
      await page.goto("/ro/calendar");
      await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
      await expect(page.locator("#main h1")).toHaveCount(1);
      expect(await fontSizeOf(page, "#main h1"), "the H1 at the phone's size").toBe(24);
      await expect(page.getByTestId("wordmark")).toBeHidden();

      const grid = page.locator("#main").getByRole("table");
      await expect(grid).toBeVisible();
      const firstRowBottom = await grid.getByRole("cell").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
      test.info().annotations.push({ type: "first week row bottom", description: `${Math.round(firstRowBottom * 10) / 10}px of ${phone.height}` });
      expect(firstRowBottom, `the grid's first week row ends ${firstRowBottom}px from the top, inside a ${phone.height}px screen`).toBeLessThanOrEqual(phone.height);
    });
  }

  test("on a desktop the wordmark stands above the title at 16 pixels, and the title is 28", async ({ page }) => {
    test.skip(isPhone(), "the desktop's head");
    for (const [path, name] of [
      ["/ro/evenimente", "Alergări"],
      ["/ro/calendar", "Calendar"],
      ["/ro/contact", "Scrie-ne"],
    ] as const) {
      await page.goto(path);
      const title = page.getByRole("heading", { level: 1, name });
      await expect(title, path).toBeVisible();
      const wordmark = page.getByTestId("wordmark");
      await expect(wordmark, path).toBeVisible();
      expect(await fontSizeOf(page, "[data-testid='wordmark']"), `${path}: the wordmark`).toBe(16);
      expect(await fontSizeOf(page, "#main h1"), `${path}: the H1`).toBe(28);
      const [markBox, titleBox] = [await wordmark.boundingBox(), await title.boundingBox()];
      expect((markBox?.y ?? Number.NaN) < (titleBox?.y ?? Number.NaN), `${path}: the wordmark above the title`).toBe(true);
    }
  });
});
